// MrSideView: opening MRs in the full tab, and a tick that lists MRs only, with herdr stubbed.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { load } = require("./load.cjs");

const plain = (v) => JSON.parse(JSON.stringify(v));
const spaces = [{ id: "s1", machine: null, folder: "/home/u", tabs: [{ id: "A" }, { id: "F" }] }];
const term = { pane: "pa", terminal: "t1", tab: "A", cwd: "/w/repo-a", branch: "main" };
const full = { pane: "pf", terminal: null, mod: "omni-forge", tab: "F", cwd: null, branch: null };
const panelTree = (active) => ({ id: "root", type: "row", children: [
  { id: "main", type: "block", content: { tab: "active" } },
  { id: "panel-body", type: "stack", active, children: [
    { id: "files", type: "block", content: { mod: "better-files" } },
    { id: "mrs", type: "block", content: { mod: "omni-forge", props: { view: "mrs" } } },
  ] },
] });

function setup({ panes = [term, full] } = {}) {
  const env = { panes, shared: {}, runs: [], mrLists: 0, runLists: 0, tree: panelTree("mrs") };
  const { MrSideView } = load(["ci/poller.js", "ci/watch.js", "forge/model.js", "views/runs.js", "views/mrs.js", "views/locate.js", "views/ui.js", "views/mr-list.js", "views/repo.js", "views/mr-side.js"], {
    InputState: { new: () => ({ on() {}, value: () => "", set_value() {} }) },
    exec: () => {},
    focused: () => ({ space: "s1", tab: "A", pane: "pa", terminal: "t1", cwd: "/w/repo-a" }),
    panes: () => env.panes,
    spaces: () => spaces,
    layout: () => env.tree,
    shared: (k) => env.shared[k],
    setShared: (k, v) => { env.shared[k] = v; },
    notify: () => {},
    checking: () => false,
    runCommand: (name, args) => env.runs.push([name, args]),
    detectRepo: async () => ({ kind: "gitlab", host: "git.example.org", path: "group/app" }),
    providerFor: (repo) => ({ repo, listRuns: async () => { env.runLists++; return []; }, listMrs: async () => { env.mrLists++; return { me: "me", mrs: [] }; } }),
  });
  const pending = [];
  const cx = { timer: { every() {} }, notify() {}, spawn(fn) { const p = fn(cx); pending.push(p); return p; } };
  const view = new MrSideView();
  view.init({}, cx);
  const settle = async () => { while (pending.length) await pending.shift(); };
  return { view, env, cx, settle };
}

const repo = { kind: "gitlab", host: "git.example.org", path: "group/app" };

test("a row click selects the full tab and leaves {tab, mrKey} for it", () => {
  const { view, env } = setup();
  view.repo = repo;
  view.openInFull({ number: 42 });
  assert.deepEqual(plain(env.shared["omni-forge.open"]), { tab: "F", key: '{"kind":"gitlab","host":"git.example.org","path":"group/app","mr":42}' });
  assert.deepEqual(plain(env.runs), [["tab.select", { id: "F" }], ["layout.hide", { id: "panel-body" }]]);
});

test("Full opens the MRs tab; without a full tab a new one named MRs opens", () => {
  const a = setup();
  a.view.repo = repo;
  a.view.openFull();
  assert.deepEqual(plain(a.env.shared["omni-forge.open"]), { tab: "F", key: "mrs" });
  const b = setup({ panes: [term] });
  b.view.repo = repo;
  b.view.openInFull({ number: 7 });
  assert.equal(b.env.shared["omni-forge.open"], undefined);
  assert.deepEqual(plain(b.env.runs), [
    ["tab.new", { name: "MRs", mod: "omni-forge", props: { view: "full", open: '{"kind":"gitlab","host":"git.example.org","path":"group/app","mr":7}' } }],
    ["layout.hide", { id: "panel-body" }],
  ]);
});

test("tick lists MRs only while the mrs block shows, never runs, never the watch tick", async () => {
  const { view, env, cx, settle } = setup();
  env.tree = panelTree("files");
  view.tick(cx);
  await settle();
  assert.equal(view.repo.path, "group/app");
  assert.equal(env.mrLists, 0);
  env.tree = panelTree("mrs");
  view.tick(cx);
  await settle();
  assert.equal(env.mrLists, 1);
  assert.equal(env.runLists, 0);
  assert.equal(env.shared["omni-forge.watch-owner"], undefined);
});
