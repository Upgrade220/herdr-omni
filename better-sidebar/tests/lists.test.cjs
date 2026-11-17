// The lists view: spaces and agents in one block, under tabs or one above the other.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const runtime = path.join(__dirname, "../mods/better-sidebar");

function element() {
  const node = { nodes: [], handlers: {}, attributes: {} };
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
        target.attributes[key] = args;
        return proxy;
      };
    },
  });
  return proxy;
}

async function harness({ settings = {}, tab = null, panes = [], sharedValues = {}, spaces: given, focusedTab = null, git = {}, stored: saved = {} } = {}) {
  const pending = [];
  const stored = { "lists.tab": tab, ...saved };
  const live = { order: [] };
  const tabOf = (id) => ({ id, name: id });
  const spaces = given ?? [
    { id: "shop", name: "shop", folder: "/shop", status: "blocked", tabs: [tabOf("a"), tabOf("b"), tabOf("d")] },
    { id: "docs", name: "docs", folder: "/docs", status: "done", tabs: [tabOf("c")] },
  ];
  const agent = (address, space, tab, status) => ({
    address,
    space,
    space_name: space,
    tab,
    tab_name: { a: "1", b: "2", c: "1" }[tab],
    program: { name: "Claude Code" },
    status,
    pane: `p-${address}`,
    seq: 1,
  });
  const agents = [agent("t1", "shop", "a", "idle"), agent("t2", "docs", "c", "done"), agent("t3", "shop", "b", "blocked"), agent("t4", "wt", "e", "blocked")]
    .filter((a) => spaces.some((s) => s.id === a.space));
  const cx = { notify() {}, stop_propagation() {}, timer: { every() {} }, focus_handle: () => ({}), spawn: (fn) => pending.push(fn(cx)) };
  const context = {
    Date, JSON, Map, Set, Math, console,
    View: class {},
    div: element, svg: (p) => element().child(`svg:${p}`), image: element, v_flex: element, h_flex: element,
    Popover: { new: element },
    spaces: () => spaces,
    agents: () => agents,
    terminals: () => [],
    panes: () => panes,
    focused: () => (focusedTab ? { tab: focusedTab } : null),
    machines: () => [],
    theme: () => new Proxy({}, { get: (_t, k) => String(k) }),
    layout: () => ({ id: "sidebar", size: { px: 268 } }),
    window: () => ({ active: true, platform: "macos" }),
    props: () => ({ view: "lists" }),
    shared: (k) => sharedValues[k],
    setShared() {},
    setAgentOrder: (list) => (live.order = [...list]),
    run() {},
    openOverlay() {},
    hc: async () => ({ code: 0, stdout: '{"machines":[]}' }),
    watchFolder: async () => { throw Error("No watcher in tests"); },
    exec: async () => ({ code: 1, stdout: "" }),
    appHome: () => "/app",
    readTextFile: async () => JSON.stringify({ settings }),
    localStorage: { getItem: (k) => stored[k] ?? null, setItem: (k, v) => (stored[k] = v) },
  };
  vm.createContext(context);
  // Each file in its own scope, as a module is; its exports become globals for the next.
  for (const file of ["settings.js", "git/pr-status.js", "git/checkouts.js", "views/find-node.js", "views/ui.js", "views/folds.js", "views/spaces.js", "views/agents.js", "views/lists.js"]) {
    const source = fs.readFileSync(path.join(runtime, file), "utf8").replace(/^import\s+[\s\S]*?;\n/gm, "");
    const names = [...source.matchAll(/^export (?:async )?(?:class|function|const) (\w+)/gm)].map((m) => m[1]);
    vm.runInContext(`Object.assign(globalThis, (() => { ${source.replaceAll("export ", "")}\nreturn { ${names.join(", ")} }; })());`, context);
  }
  const mod = new context.Lists();
  mod.init({}, cx);
  while (pending.length) await Promise.all(pending.splice(0));
  for (const [folder, info] of Object.entries(git)) mod.spaces.git[JSON.stringify([null, folder])] = info;
  return { mod, live, stored, cx };
}

// herdr-omni: spaces start folded; upstream's expectations hold with them opened.
const OPEN = { "spaces.folds": JSON.stringify({ shop: true, docs: true }) };

const find = (node, id) => (node?.id === id ? node : node?.nodes?.map((n) => find(n, id)).find(Boolean));
const ids = (node, out = []) => (node?.id && out.push(node.id), (node?.nodes ?? []).forEach((n) => ids(n, out)), out);
const text = (node) => (typeof node === "string" ? node : (node?.nodes ?? []).map(text).join(" "));

test("an open space shows its tabs beneath it, as their agents where they have any, and next-agent keys follow that order", async () => {
  const { mod, live } = await harness({ stored: OPEN });
  const drawn = ids(mod.render()).filter((id) => /^(space-(shop|docs)|ag-t\d|tab-\w)$/.test(id));
  assert.deepEqual(drawn, ["space-shop", "ag-t1", "ag-t3", "tab-d", "space-docs", "ag-t2"]);
  // Its tab's title, then its program, quietly.
  assert.match(text(find(mod.render(), "ag-t1")), /^\s*1\s+Claude Code/);
  assert.deepEqual(live.order, ["t1", "t3", "t2"]);
});

test("the Agents tab counts agents, and picking a tab keeps it", async () => {
  const { mod, stored, cx } = await harness();
  const root = mod.render();
  assert.match(text(find(root, "lists-tab-agents")), /Agents 3/);
  assert.equal(find(root, "lists-tab-unread"), undefined);
  find(root, "lists-tab-agents").handlers.click({}, cx);
  assert.equal(stored["lists.tab"], "agents");
});

test("the tab picked last comes back, and an old Unread one falls back to Spaces", async () => {
  assert.ok(find((await harness({ tab: "unread" })).mod.render(), "space-shop"));
  const { mod } = await harness({ tab: "agents" });
  const root = mod.render();
  assert.ok(find(root, "ag-list"));
  assert.equal(find(root, "space-shop"), undefined);
});

test("combined off puts spaces above agents, without tabs", async () => {
  const { mod } = await harness({ settings: { combined: false } });
  const root = mod.render();
  assert.equal(find(root, "lists-tab-spaces"), undefined);
  assert.ok(find(root, "space-shop"));
  assert.ok(find(root, "ag-list"));
  assert.equal(find(root, "space-agents-shop"), undefined);
});

test("in Spaces a pinned agent sits above every space", async () => {
  const { mod } = await harness({ stored: OPEN });
  mod.agents.setPins(["t3"]);
  const drawn = ids(mod.render()).filter((id) => /^ag-t\d$/.test(id));
  assert.deepEqual(drawn, ["ag-t3", "ag-t1", "ag-t2"]);
  const order = ids(mod.render()).filter((id) => /^(space-(shop|docs)|ag-t\d)$/.test(id));
  assert.deepEqual(order, ["ag-t3", "space-shop", "ag-t1", "space-docs", "ag-t2"]);

});

test("an Agents row reads its tab's title, then its space", async () => {
  const { mod } = await harness({ tab: "agents" });
  assert.match(text(find(mod.render(), "ag-t1")), /^\s*1\s+shop/);
});

test("a mod's tab shows the icon the mod publishes, and a tab with neither keeps the gap", async () => {
  const { mod } = await harness({
    panes: [{ pane: "pd", tab: "d", mod: "better-files" }],
    sharedValues: { "mod-icons": { "better-files": "mods/better-files/icons/file.svg" } },
    stored: OPEN,
  });
  assert.match(text(find(mod.render(), "tab-d")), /svg:mods\/better-files\/icons\/file\.svg/);
  const { mod: bare } = await harness({ stored: OPEN });
  assert.doesNotMatch(text(find(bare.render(), "tab-d")), /svg:/);
});

// ── herdr-omni: folding ─────────────────────────────────────────────────────

const drawnRows = (root) => ids(root).filter((id) => /^(space-(?!new$)[\w:-]+|ag-t\d|tab-\w)$/.test(id));
const stopper = () => {
  const cx = { stopped: false, notify() {}, stop_propagation: () => (cx.stopped = true) };
  return cx;
};

test("spaces start folded, and next-agent keys still reach the agents inside", async () => {
  const { mod, live } = await harness();
  assert.deepEqual(drawnRows(mod.render()), ["space-shop", "space-docs"]);
  assert.deepEqual(live.order, ["t1", "t3", "t2"]);
});

test("clicking a space's chevron shows its tabs, and that is kept after a restart", async () => {
  const { mod, stored } = await harness();
  find(mod.render(), "fold-shop").handlers.click({}, stopper());
  const expected = ["space-shop", "ag-t1", "ag-t3", "tab-d", "space-docs"];
  assert.deepEqual(drawnRows(mod.render()), expected);
  assert.equal(JSON.parse(stored["spaces.folds"]).shop, true);
  const { mod: again } = await harness({ stored: { "spaces.folds": stored["spaces.folds"] } });
  assert.deepEqual(drawnRows(again.render()), expected);
});

test("pressing a chevron neither selects nor drags its space", async () => {
  const { mod } = await harness();
  const chevron = find(mod.render(), "fold-shop");
  for (const name of ["mouse_down_left", "mouse_up_left"]) {
    const cx = stopper();
    chevron.handlers[name]({}, cx);
    assert.ok(cx.stopped, name);
  }
});

test("a folded space shows its most urgent status, and opened it shows none", async () => {
  const { mod } = await harness();
  assert.ok(find(mod.render(), "dot-shop"));
  assert.ok(find(mod.render(), "dot-docs"));
  find(mod.render(), "fold-shop").handlers.click({}, stopper());
  assert.equal(find(mod.render(), "dot-shop"), undefined);
});

test("the shown tab's space opens by itself", async () => {
  const { mod } = await harness({ focusedTab: "b" });
  assert.ok(find(mod.render(), "ag-t3"));
  assert.equal(find(mod.render(), "ag-t2"), undefined);
});

// A main checkout with a worktree open beside it.
const REPO = JSON.stringify([null, "/shop/.git"]);
const withWorktree = ({ drop = [], active = null } = {}) => ({
  spaces: [
    { id: "shop", name: "shop", folder: "/shop", status: "idle", tabs: ["a", "b", "d"].map((id) => ({ id, name: id })) },
    { id: "wt", name: "wt", folder: "/wt", status: "blocked", tabs: [{ id: "e", name: "e" }] },
    { id: "docs", name: "docs", folder: "/docs", status: "done", tabs: [{ id: "c", name: "c" }] },
  ]
    .filter((s) => !drop.includes(s.id))
    .map((s) => ({ ...s, active: s.id === active })),
  git: {
    "/shop": { branch: "main", repo: REPO, linked: false, ahead: 0, behind: 0 },
    "/wt": { branch: "fix", repo: REPO, linked: true, ahead: 0, behind: 0 },
  },
});
const bg = (node) => node?.attributes?.bg?.[0];

test("a space with a worktree puts its own tabs under a node named for its branch", async () => {
  const { mod } = await harness({ ...withWorktree(), stored: { "spaces.folds": JSON.stringify({ "shop:main": true }) } });
  const root = mod.render();
  assert.deepEqual(drawnRows(root).slice(0, 6), ["space-shop", "space-main-shop", "ag-t1", "ag-t3", "tab-d", "space-wt"]);
  assert.match(text(find(root, "space-main-shop")), /main/);
});

test("a space with worktrees starts open, its node and worktrees folded", async () => {
  const { mod } = await harness(withWorktree());
  const root = mod.render();
  assert.deepEqual(drawnRows(root), ["space-shop", "space-main-shop", "space-wt", "space-docs"]);
  assert.ok(find(root, "dot-wt"));
  assert.equal(find(root, "dot-shop"), undefined);
});

test("folding the space hides its node and worktrees, and its dot speaks for them", async () => {
  const { mod } = await harness(withWorktree());
  find(mod.render(), "fold-shop").handlers.click({}, stopper());
  const root = mod.render();
  assert.deepEqual(drawnRows(root), ["space-shop", "space-docs"]);
  assert.ok(find(root, "dot-shop"));
});

test("the shown main-checkout tab opens the space and its node, and only that tab is lit", async () => {
  const { mod } = await harness({ ...withWorktree({ active: "shop" }), focusedTab: "d" });
  const root = mod.render();
  assert.equal(bg(find(root, "tab-d")), "selected");
  assert.notEqual(bg(find(root, "space-shop")), "selected");
});

test("a shown tab folded away leaves the nearest drawn row lit", async () => {
  const { mod } = await harness({ ...withWorktree({ active: "shop" }), focusedTab: "d" });
  find(mod.render(), "space-main-shop").handlers.click({}, stopper());
  const root = mod.render();
  assert.equal(find(root, "tab-d"), undefined);
  assert.equal(bg(find(root, "space-main-shop")), "selected");
  assert.notEqual(bg(find(root, "space-shop")), "selected");
});

test("a worktree folded away inside its space leaves the space lit", async () => {
  const { mod } = await harness({ ...withWorktree({ active: "wt" }), focusedTab: "e" });
  find(mod.render(), "fold-shop").handlers.click({}, stopper());
  assert.equal(bg(find(mod.render(), "space-shop")), "selected");
});

test("an orphan worktree stays top-level with a plain fold", async () => {
  const { mod } = await harness(withWorktree({ drop: ["shop"] }));
  const root = mod.render();
  assert.equal(ids(root).find((id) => String(id).startsWith("space-main-")), undefined);
  assert.ok(find(root, "fold-wt"));
});
