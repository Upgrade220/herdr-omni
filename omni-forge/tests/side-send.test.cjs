// SideView's click and polling gate, and SendView's delivery, with herdr stubbed.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { load } = require("./load.cjs");

const plain = (v) => JSON.parse(JSON.stringify(v));
const spaces = [{ id: "s1", machine: null, folder: "/home/u", tabs: [{ id: "A" }, { id: "F" }, { id: "B" }] }];
const term = { pane: "pa", terminal: "t1", tab: "A", cwd: "/w/repo-a", branch: "main" };
const full = { pane: "pf", terminal: null, mod: "omni-forge", tab: "F", cwd: null, branch: null };
const panelTree = (active) => ({ id: "root", type: "row", children: [
  { id: "main", type: "block", content: { tab: "active" } },
  { id: "panel-body", type: "stack", active, children: [
    { id: "files", type: "block", content: { mod: "better-files" } },
    { id: "ci", type: "block", content: { mod: "omni-forge" } },
  ] },
] });

function sideSetup({ panes = [term, full], focus = { space: "s1", tab: "A", pane: "pa", terminal: "t1", cwd: "/w/repo-a" } } = {}) {
  const env = { panes, focus, shared: {}, runs: [], lists: 0, tree: panelTree("ci") };
  const { SideView } = load(["ci/poller.js", "ci/watch.js", "forge/model.js", "views/runs.js", "views/locate.js", "views/ui.js", "views/repo.js", "views/side.js"], {
    InputState: { new: () => ({ on() {}, value: () => "", set_value() {} }) },
    exec: () => {},
    focused: () => env.focus,
    panes: () => env.panes,
    spaces: () => spaces,
    layout: () => env.tree,
    shared: (k) => env.shared[k],
    setShared: (k, v) => { env.shared[k] = v; },
    notify: () => {},
    checking: () => false,
    runCommand: (name, args) => env.runs.push([name, args]),
    detectRepo: async () => ({ kind: "gitlab", host: "gl.test", path: "g/p" }),
    providerFor: (repo) => ({ repo, capabilities: {}, listRuns: async () => { env.lists++; return []; }, runDetail: async () => { throw new Error("no"); } }),
  });
  const pending = [];
  const cx = { timer: { every() {} }, notify() {}, spawn(fn) { const p = fn(cx); pending.push(p); return p; } };
  const view = new SideView();
  view.init({}, cx);
  const settle = async () => { while (pending.length) await pending.shift(); };
  return { view, env, cx, settle };
}

test("side click: selects the space's full tab and leaves {tab, key} for it", () => {
  const { view, env } = sideSetup();
  view.repo = { kind: "gitlab", host: "gl.test", path: "g/p" };
  view.openInFull({ id: "42" });
  assert.deepEqual(plain(env.shared["omni-forge.open"]), { tab: "F", key: '["gitlab","gl.test","g/p","42"]' });
  assert.deepEqual(plain(env.runs), [["tab.select", { id: "F" }], ["layout.hide", { id: "panel-body" }]]);
});

test("side click: the focused full tab wins over the first one", () => {
  const g = { pane: "pg", terminal: null, mod: "omni-forge", tab: "B" };
  const { view, env } = sideSetup({ panes: [term, full, g], focus: { space: "s1", tab: "B", pane: "pg", terminal: null, cwd: null } });
  view.repo = { kind: "gitlab", host: "gl.test", path: "g/p" };
  view.openInFull({ id: "1" });
  assert.equal(env.shared["omni-forge.open"].tab, "B");
  assert.deepEqual(plain(env.runs), [["tab.select", { id: "B" }], ["layout.hide", { id: "panel-body" }]]);
});

test("side click: no full tab in the space opens a new one on the run, no shared request", () => {
  const { view, env } = sideSetup({ panes: [term] });
  view.repo = { kind: "github", host: "github.com", path: "o/r" };
  view.openInFull({ id: "7" });
  assert.equal(env.shared["omni-forge.open"], undefined);
  assert.deepEqual(plain(env.runs), [["tab.new", { mod: "omni-forge", props: { view: "full", open: '["github","github.com","o/r","7"]' } }], ["layout.hide", { id: "panel-body" }]]);
});

test("side tick: the list polls only while the layout shows the side block; watches always run", async () => {
  const { view, env, cx, settle } = sideSetup();
  env.tree = panelTree("files"); // panel shows Files
  view.tick(cx);
  await settle();
  assert.equal(view.repo.path, "g/p"); // follow and detection still run
  assert.equal(env.lists, 0);
  assert.equal(env.shared["omni-forge.watch-owner"].id, view.id); // the watch tick ran
  view.tick(cx);
  await settle();
  assert.equal(env.lists, 0);
  env.tree = panelTree("ci");
  view.tick(cx);
  await settle();
  assert.equal(env.lists, 1);
});

// ---- send dialog ----------------------------------------------------------------

function sendSetup({ hcResult = { code: 0, stdout: "", stderr: "" }, agents = [], known = [], last = null, extra = {} } = {}) {
  const env = { hc: [], runs: [], notes: [], closed: [], shared: { ...(last ? { "omni-forge.send.agent": last } : {}) } };
  const given = { view: "send", overlay: "o1", kind: "gitlab", host: "gl.test", path: "g/p", run: { id: "2", number: 2, title: "Fix", branch: "main", request: null }, job: { id: "9", name: "unit" }, url: "https://gl.test/j/9", folder: "/w/p", machine: null, space: "s1", ...extra };
  const { SendView } = load(["actions/agent.js", "ci/log.js", "views/locate.js", "views/ui.js", "views/send.js"], {
    TextareaState: { new: () => { let v = ""; return { value: () => v, set_value: (x) => { v = x; } }; } },
    props: () => given,
    agents: () => agents,
    knownAgents: async () => known,
    hc: async (args) => { env.hc.push(args); return hcResult; },
    notify: (n) => env.notes.push(n),
    openOverlay: () => "o",
    closeOverlay: (id) => env.closed.push(id),
    checking: () => false,
    shared: (k) => env.shared[k],
    setShared: (k, v) => { env.shared[k] = v; },
    runCommand: (name, args) => env.runs.push([name, args]),
    providerFor: () => ({ jobLog: async () => ({ text: "\x1b[31merror: boom\x1b[0m\n", available: true }) }),
  });
  const pending = [];
  const cx = { notify() {}, spawn(fn) { const p = fn(cx); pending.push(p); return p; } };
  const view = new SendView();
  view.init(given, cx);
  const settle = async () => { while (pending.length) await pending.shift(); };
  return { view, env, cx, settle };
}

const running = [{ address: "t5", space: "s1", tab_name: "api", program: { name: "Claude Code" } }, { address: "t9", space: "s2", tab_name: "other", program: { name: "Codex" } }];
const installed = [{ key: "claude", name: "Claude Code", run: ["claude"], installed: true }];

test("send: the prompt holds the cleaned log tail once fetched", async () => {
  const { view, settle } = sendSetup({ agents: running });
  assert.equal(view.logLoading, true);
  await settle();
  assert.equal(view.logLoading, false);
  assert.ok(view.prompt.value().includes("```text\nerror: boom\n```"), view.prompt.value());
});

test("send to a running agent: hc send argv, then remember and close", async () => {
  const { view, env, cx, settle } = sendSetup({ agents: running, known: installed });
  await settle();
  assert.deepEqual(plain(view.choices().map((c) => c.key)), ["running:t5", "new:claude"]); // other space left out
  view.send(cx);
  await settle();
  assert.equal(env.hc.length, 1);
  // "--" ends options, so a prompt that starts with "-" is never read as a flag.
  assert.deepEqual(plain(env.hc[0]), ["send", "t5", "--", view.prompt.value().trim()]);
  assert.equal(env.shared["omni-forge.send.agent"], "running:t5");
  assert.deepEqual(plain(env.closed), ["o1"]);
  assert.deepEqual(env.notes, []);
});

test("send: a failed hc notifies and keeps the dialog open, not remembered", async () => {
  const { view, env, cx, settle } = sendSetup({ agents: running, hcResult: { code: 1, stdout: "", stderr: "no such terminal t5\n" } });
  await settle();
  view.send(cx);
  await settle();
  assert.equal(env.notes.length, 1);
  assert.equal(env.notes[0].level, "error");
  assert.ok(env.notes[0].body.includes("no such terminal t5"));
  assert.deepEqual(env.closed, []);
  assert.equal(env.shared["omni-forge.send.agent"], undefined);
  assert.equal(view.sending, false);
});

test("send to a new agent: tab.new with argv, task, folder and space; remember and close", async () => {
  const { view, env, cx, settle } = sendSetup({ known: installed });
  await settle();
  view.send(cx);
  assert.equal(env.runs.length, 1);
  const [name, args] = env.runs[0];
  assert.equal(name, "tab.new");
  assert.deepEqual(plain(args.argv), ["claude"]);
  assert.equal(args.task, view.prompt.value().trim());
  assert.equal(args.folder, "/w/p");
  assert.equal(args.space, "s1");
  assert.deepEqual(env.hc, []);
  assert.equal(env.shared["omni-forge.send.agent"], "new:claude");
  assert.deepEqual(plain(env.closed), ["o1"]);
});

test("send: the remembered choice is read from shared and preselected", async () => {
  const { view, env, cx, settle } = sendSetup({ agents: running, known: installed, last: "new:claude" });
  await settle();
  assert.equal(view.current(view.choices()).key, "new:claude");
  view.send(cx);
  assert.equal(env.runs[0][0], "tab.new");
});

test("send: nothing goes while the log is loading", () => {
  const { view, env, cx } = sendSetup({ agents: running });
  view.send(cx);
  assert.deepEqual(env.hc, []);
  assert.deepEqual(env.runs, []);
});

test("Full button: selects the space's full tab on Runs and closes the panel", () => {
  const { view, env } = sideSetup();
  view.repo = { kind: "gitlab", host: "gl.test", path: "g/p" };
  view.openFull();
  assert.deepEqual(plain(env.shared["omni-forge.open"]), { tab: "F", key: "runs" });
  assert.deepEqual(plain(env.runs), [["tab.select", { id: "F" }], ["layout.hide", { id: "panel-body" }]]);
});

test("Full button: no full tab opens a new one (on Runs) and closes the panel", () => {
  const { view, env } = sideSetup({ panes: [term] });
  view.openFull();
  assert.equal(env.shared["omni-forge.open"], undefined);
  assert.deepEqual(plain(env.runs), [["tab.new", { mod: "omni-forge", props: { view: "full" } }], ["layout.hide", { id: "panel-body" }]]);
});
