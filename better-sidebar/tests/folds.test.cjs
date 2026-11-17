// Folding in the lists view: saved state, defaults, following the shown tab, status dots.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const runtime = path.join(__dirname, "../mods/better-sidebar");

function element() {
  const node = { nodes: [], handlers: {} };
  const proxy = new Proxy(node, {
    get(target, key) {
      if (key in target) return target[key];
      if (key === "child") return (c) => (target.nodes.push(c), proxy);
      if (key === "children") return (c) => (target.nodes.push(...c), proxy);
      if (key === "when") return (c, build) => (c && build(proxy), proxy);
      return (...args) => {
        if (key === "id") target.id = args[0];
        if (key === "on_click") target.handlers.click = args.at(-1);
        if (key === "on_mouse_down" || key === "on_mouse_up")
          target.handlers[`${key.slice(3)}_${args[0]}`] = args.at(-1);
        return proxy;
      };
    },
  });
  return proxy;
}

function load() {
  const context = {
    JSON, Set, Object, console,
    div: element, svg: element, h_flex: element, v_flex: element, Popover: { new: element },
    theme: () => new Proxy({}, { get: (_t, k) => String(k) }),
    localStorage: { getItem: () => null, setItem() {} },
  };
  vm.createContext(context);
  for (const file of ["views/ui.js", "views/folds.js"]) {
    const source = fs.readFileSync(path.join(runtime, file), "utf8").replace(/^import\s+[\s\S]*?;\n/gm, "");
    const names = [...source.matchAll(/^export (?:async )?(?:class|function|const) (\w+)/gm)].map((m) => m[1]);
    vm.runInContext(`Object.assign(globalThis, (() => { ${source.replaceAll("export ", "")}\nreturn { ${names.join(", ")} }; })());`, context);
  }
  return context;
}

const storage = (values = {}) => ({
  values,
  getItem: (k) => values[k] ?? null,
  setItem: (k, v) => (values[k] = v),
});

test("mostUrgent picks blocked, then done, then working, and ignores idle", () => {
  const { mostUrgent } = load();
  assert.equal(mostUrgent(["idle", "working", "done"]), "done");
  assert.equal(mostUrgent(["working", "blocked"]), "blocked");
  assert.equal(mostUrgent(["idle", null]), null);
  assert.equal(mostUrgent([]), null);
});

test("mainNodeId names a space's main-checkout node", () => {
  assert.equal(load().mainNodeId("sp1"), "sp1:main");
});

test("isOpen falls back to the default and toggle persists the opposite", () => {
  const { Folds } = load();
  const store = storage();
  const folds = new Folds(store);
  assert.equal(folds.isOpen("s", false), false);
  assert.equal(folds.isOpen("s", true), true);
  folds.toggle("s", false);
  assert.equal(folds.isOpen("s", false), true);
  assert.equal(JSON.parse(store.values["spaces.folds"]).s, true);
  assert.equal(new Folds(store).isOpen("s", false), true);
});

test("follow opens the path only when the shown tab changes", () => {
  const { Folds } = load();
  const folds = new Folds(storage());
  folds.follow("t1", ["s", "s:main"]);
  assert.equal(folds.isOpen("s", false), true);
  assert.equal(folds.isOpen("s:main", false), true);
  folds.toggle("s", false);
  folds.follow("t1", ["s", "s:main"]);
  assert.equal(folds.isOpen("s", false), false);
  folds.follow("t2", ["s"]);
  assert.equal(folds.isOpen("s", false), true);
});

test("bad saved fold state is ignored", () => {
  const { Folds } = load();
  const folds = new Folds(storage({ "spaces.folds": "{not json" }));
  assert.equal(folds.isOpen("s", false), false);
});

test("Chevron stops the press and click, but lets a drag end over it", () => {
  const { Chevron } = load();
  let toggled = 0;
  const chevron = Chevron({ id: "fold-s", open: false, onToggle: () => toggled++ });
  assert.equal(chevron.id, "fold-s");
  const press = (name) => {
    let stopped = false;
    chevron.handlers[name]?.({}, { stop_propagation: () => (stopped = true) });
    return stopped;
  };
  assert.ok(press("mouse_down_left"), "the press never reaches the row");
  assert.ok(press("click"));
  // A drag released over it must still reach the row and the list.
  assert.equal(press("mouse_up_left"), false);
  assert.equal(toggled, 1);
});

test("StatusDot shows nothing for idle or no status", () => {
  const { StatusDot } = load();
  assert.equal(StatusDot("idle"), null);
  assert.equal(StatusDot(null), null);
  assert.ok(StatusDot("blocked"));
});

test("follow opens rows that appear later for the same tab, and keeps earlier folds", () => {
  const { Folds } = load();
  const folds = new Folds(storage());
  folds.follow("t1", []);
  folds.follow("t1", ["s"]);
  assert.equal(folds.isOpen("s", false), true);
  folds.toggle("s", false);
  folds.follow("t1", ["s", "s:main"]);
  assert.equal(folds.isOpen("s", false), false);
  assert.equal(folds.isOpen("s:main", false), true);
});
