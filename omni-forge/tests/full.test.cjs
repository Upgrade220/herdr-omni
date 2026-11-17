// FullView's repo source order and Try again, with herdr and the forge layer stubbed.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { load } = require("./load.cjs");

const spaces = [{ id: "s1", machine: null, folder: "/home/u", tabs: [{ id: "A" }, { id: "F" }] }];
const panes = [
  { pane: "pa", terminal: "t1", tab: "A", cwd: "/w/repo-a", branch: "main" },
  { pane: "pb", terminal: "t2", tab: "A", cwd: "/w/repo-b", branch: "dev" },
  { pane: "pf", terminal: null, mod: "omni-forge", tab: "F", cwd: null, branch: null },
];
const focusOn = (pane, tab) => ({ space: "s1", tab, pane, terminal: panes.find((p) => p.pane === pane)?.terminal ?? null, cwd: panes.find((p) => p.pane === pane)?.cwd ?? null });

function setup({ given = {}, focus = focusOn("pf", "F"), shared = {}, detect } = {}) {
  const env = { focus, shared: { ...shared }, detects: [], opened: [] };
  const repoOf = (cwd) => ({ kind: "github", host: "github.com", path: `o/${cwd.split("/").pop()}`, url: "" });
  class Detail {
    constructor(owner, runId) { this.runId = runId; env.opened.push(runId); }
    load() {}
  }
  const { FullView } = load(["ci/poller.js", "ci/watch.js", "forge/model.js", "views/runs.js", "views/locate.js", "views/full.js"], {
    InputState: { new: () => ({ on() {}, value: () => "", set_value() {} }) },
    exec: () => {},
    focused: () => env.focus,
    panes: () => panes,
    spaces: () => spaces,
    props: () => given,
    shared: (k) => env.shared[k],
    setShared: (k, v) => { env.shared[k] = v; },
    notify: () => {},
    checking: () => false,
    appWindow: () => ({ active: true }),
    detectRepo: async (cwd) => { env.detects.push(cwd); return detect ? detect(cwd) : repoOf(cwd); },
    providerFor: (repo) => ({ repo, capabilities: {}, listRuns: async () => [] }),
    Detail,
    WATCHABLE: new Set(["running", "pending", "manual"]),
  });
  const pending = [];
  const cx = { timer: { every() {} }, notify() {}, spawn(fn) { const p = fn(cx); pending.push(p); return p; } };
  const view = new FullView();
  view.init(given, cx);
  const settle = async () => { while (pending.length) await pending.shift(); };
  return { view, env, cx, settle };
}

test("props.open wins: repo and run detail come from it, no detection", async () => {
  const { view, env, cx, settle } = setup({ given: { view: "full", open: '["gitlab","gl.test","g/p","12"]' }, focus: focusOn("pa", "A"), shared: { "omni-forge.last-loc": { cwd: "/w/repo-b", machine: null } } });
  assert.deepEqual({ ...view.repo }, { kind: "gitlab", host: "gl.test", path: "g/p" });
  assert.deepEqual(env.opened, ["12"]);
  view.follow(cx);
  await settle();
  assert.deepEqual(env.detects, []);
  assert.equal(view.repo.path, "g/p");
});

test("last-loc seeds a new tab", async () => {
  const { view, env, cx, settle } = setup({ shared: { "omni-forge.last-loc": { cwd: "/w/repo-b", machine: null, branch: "dev" } } });
  view.follow(cx);
  await settle();
  assert.deepEqual(env.detects, ["/w/repo-b"]);
  assert.equal(view.repo.path, "o/repo-b");
  assert.equal(view.branch, "dev");
});

test("a non-terminal focus keeps the location; a terminal focus records last-loc", async () => {
  const { view, env, cx, settle } = setup({ focus: focusOn("pa", "A") });
  view.follow(cx);
  await settle();
  assert.equal(env.shared["omni-forge.last-loc"].cwd, "/w/repo-a");
  env.focus = focusOn("pf", "F");
  view.follow(cx);
  await settle();
  assert.deepEqual(env.detects, ["/w/repo-a"]);
  assert.equal(view.repo.path, "o/repo-a");
});

test("Try again re-detects the same location", async () => {
  let fail = true;
  const { view, env, cx, settle } = setup({
    focus: focusOn("pa", "A"),
    detect: (cwd) => (fail ? { error: "Cannot reach machine", hint: "x" } : { kind: "github", host: "github.com", path: `o/${cwd.split("/").pop()}` }),
  });
  view.follow(cx);
  await settle();
  assert.equal(view.repo, null);
  assert.equal(view.repoError.error, "Cannot reach machine");
  env.focus = focusOn("pb", "A"); // focus elsewhere has not been followed yet
  fail = false;
  view.refresh(cx);
  await settle();
  assert.deepEqual(env.detects, ["/w/repo-a", "/w/repo-a"]);
  assert.equal(view.repo.path, "o/repo-a");
});

test("visible for its own tab, not for another tab", () => {
  const { view, env } = setup();
  assert.equal(view.visible(), true);
  env.focus = focusOn("pa", "A");
  assert.equal(view.visible(), false);
});
