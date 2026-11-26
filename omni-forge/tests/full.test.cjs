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

function setup({ checking = false, given = {}, focus = focusOn("pf", "F"), shared = {}, detect, panes: paneList = panes } = {}) {
  const env = { checking, pages: [], focus, shared: { ...shared }, detects: [], opened: [], panes: paneList, logs: [], logTicks: [], logRefreshes: [] };
  const repoOf = (cwd) => ({ kind: "github", host: "github.com", path: `o/${cwd.split("/").pop()}`, url: "" });
  class Detail {
    constructor(owner, runId) { this.runId = runId; env.opened.push(runId); }
    load() {}
  }
  class MrPage {
    constructor(owner, number) { this.number = number; this.loading = false; env.pages.push(this); }
    load() { this.loaded = (this.loaded ?? 0) + 1; }
    render() { return null; }
  }
  class LogView {
    initEmbedded(props) { this.props = props; env.logs.push(props.jobId); }
    tick() { env.logTicks.push(this.props.jobId); }
    refresh() { env.logRefreshes.push(this.props.jobId); }
  }
  const { FullView } = load(["ci/poller.js", "ci/watch.js", "forge/model.js", "views/runs.js", "views/locate.js", "views/mrs.js", "views/ui.js", "views/mr-list.js", "views/repo.js", "views/tabs.js", "views/full.js"], {
    InputState: { new: () => ({ on() {}, value: () => "", set_value() {} }) },
    exec: () => {},
    focused: () => env.focus,
    panes: () => env.panes,
    spaces: () => spaces,
    props: () => given,
    shared: (k) => env.shared[k],
    setShared: (k, v) => { env.shared[k] = v; },
    notify: () => {},
    checking: () => Boolean(env.checking),
    appWindow: () => ({ active: true }),
    detectRepo: async (cwd) => { env.detects.push(cwd); return detect ? detect(cwd) : repoOf(cwd); },
    providerFor: (repo) => ({ repo, capabilities: {}, listRuns: async () => [] }),
    Detail,
    LogView,
    MrPage,
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
  // Starts on repo-b: the tab/space fallback would give repo-a, so staying proves the keep rule.
  const { view, env, cx, settle } = setup({ focus: focusOn("pb", "A") });
  view.follow(cx);
  await settle();
  assert.equal(env.shared["omni-forge.last-loc"].cwd, "/w/repo-b");
  env.focus = focusOn("pf", "F");
  view.follow(cx);
  await settle();
  assert.deepEqual(env.detects, ["/w/repo-b"]);
  assert.equal(view.repo.path, "o/repo-b");
});

test("first tick: a focused terminal beats a stale last-loc", async () => {
  const { view, env, cx, settle } = setup({ focus: focusOn("pb", "A"), shared: { "omni-forge.last-loc": { cwd: "/w/repo-a", machine: null, branch: "main" } } });
  view.follow(cx);
  await settle();
  assert.deepEqual(env.detects, ["/w/repo-b"]);
  assert.equal(view.repo.path, "o/repo-b");
  assert.equal(env.shared["omni-forge.last-loc"].cwd, "/w/repo-b");
  view.follow(cx); // refocusing B keeps it, with no extra detection
  await settle();
  assert.deepEqual(env.detects, ["/w/repo-b"]);
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

test("shared open: taken (and cleared) in the tick only while visible, never in render", async () => {
  const { view, env, cx, settle } = setup({ focus: focusOn("pb", "A") });
  view.follow(cx);
  await settle();
  assert.equal(view.repo.path, "o/repo-b");
  env.shared["omni-forge.open"] = { tab: "F", key: '["github","github.com","o/repo-b","55"]' };
  view.tick(cx); // focus is on tab A: not visible, the key waits
  assert.equal(env.shared["omni-forge.open"].tab, "F");
  assert.deepEqual(env.opened, []);
  env.focus = focusOn("pf", "F");
  view.tick(cx);
  await settle();
  assert.equal(env.shared["omni-forge.open"], null);
  assert.deepEqual(env.opened, ["55"]);
  assert.equal(view.tabs.selected, "run:55"); // lands in a run tab
  assert.equal(view.loc.cwd, "/w/repo-b"); // same repo: the location stays
  view.tick(cx);
  assert.deepEqual(env.opened, ["55"]);
});

test("shared open for another repo switches to it", async () => {
  const { view, env, cx, settle } = setup({ focus: focusOn("pb", "A") });
  view.follow(cx);
  await settle();
  env.focus = focusOn("pf", "F");
  env.shared["omni-forge.open"] = { tab: "F", key: '["gitlab","gl.test","g/p","9"]' };
  view.tick(cx);
  await settle();
  assert.deepEqual({ ...view.repo }, { kind: "gitlab", host: "gl.test", path: "g/p" });
  assert.deepEqual(env.opened, ["9"]);
  assert.deepEqual(env.detects, ["/w/repo-b"]);
});

test("shared open: with two full tabs, only the copy that learned the asked tab takes it", async () => {
  const two = [...panes, { pane: "pg", terminal: null, mod: "omni-forge", tab: "G" }];
  const mine = setup({ panes: two, focus: focusOn("pf", "F") });
  const other = setup({ panes: two, focus: focusOn("pf", "F") });
  mine.view.laidOut(); // laid out while F is focused: F is its tab
  other.env.focus = { space: "s1", tab: "G", pane: "pg", terminal: null, cwd: null };
  other.view.laidOut(); // laid out while G is focused
  other.env.focus = focusOn("pf", "F");
  assert.equal(mine.view.ownTab, "F");
  assert.equal(other.view.ownTab, "G");
  const asked = { tab: "F", key: '["github","github.com","o/x","3"]' };
  other.env.shared["omni-forge.open"] = asked;
  other.view.tick(other.cx);
  assert.deepEqual(other.env.opened, []);
  assert.equal(other.env.shared["omni-forge.open"], asked);
  assert.equal(other.view.visible(), false);
  mine.env.shared["omni-forge.open"] = asked;
  mine.view.tick(mine.cx);
  await mine.settle();
  assert.deepEqual(mine.env.opened, ["3"]);
  assert.equal(mine.env.shared["omni-forge.open"], null);
});

test("shared open: own tab unknown and two full tabs: nobody guesses", () => {
  const two = [...panes, { pane: "pg", terminal: null, mod: "omni-forge", tab: "G" }];
  const { view, env, cx } = setup({ panes: two });
  env.shared["omni-forge.open"] = { tab: "F", key: '["github","github.com","o/x","3"]' };
  view.tick(cx);
  assert.deepEqual(env.opened, []);
});

test("laidOut ignores a focused tab that isn't a full tab", () => {
  const { view, env } = setup({ focus: focusOn("pa", "A") });
  view.laidOut();
  assert.equal(view.ownTab, null);
  env.focus = focusOn("pf", "F");
  view.laidOut();
  assert.equal(view.ownTab, "F");
});

// ---- tabs inside the view ------------------------------------------------------------

const opened = (given = {}) => setup({ given: { view: "full", open: '["gitlab","gl.test","g/p","12"]', ...given }, focus: focusOn("pf", "F") });
const job = { id: "gid://gitlab/Ci::Build/77", name: "Build", status: "failed" };

test("Log opens a log tab inside the view, and opening it again reuses the tab", () => {
  const { view, env, cx } = opened();
  view.openLog("12", job, cx);
  assert.equal(view.tabs.selected, `log:12:${job.id}`);
  assert.deepEqual(env.logs, [job.id]);
  view.tabs.select("runs");
  view.openLog("12", job, cx);
  assert.equal(view.tabs.selected, `log:12:${job.id}`);
  assert.deepEqual(env.logs, [job.id]); // no second LogView
  assert.equal(view.tabs.list.length, 4); // Runs, MRs, run:12, the log
});

test("only the selected log tab polls; closing it drops its LogView", () => {
  const { view, env, cx } = opened();
  view.openLog("12", job, cx);
  view.tick(cx);
  assert.deepEqual(env.logTicks, [job.id]);
  view.tabs.select("run:12");
  view.tick(cx);
  assert.deepEqual(env.logTicks, [job.id]); // not selected: idle
  view.closeTab(`log:12:${job.id}`, cx);
  assert.equal(view.logs.size, 0);
  view.tick(cx);
  assert.deepEqual(env.logTicks, [job.id]);
});

test("Refresh on a log tab refreshes that log", () => {
  const { view, env, cx } = opened();
  view.openLog("12", job, cx);
  view.refresh(cx);
  assert.deepEqual(env.logRefreshes, [job.id]);
});

test("closing a run tab drops its Detail", () => {
  const { view, cx } = opened();
  assert.ok(view.details.has("12"));
  view.closeTab("run:12", cx);
  assert.equal(view.details.has("12"), false);
  assert.equal(view.tabs.selected, "runs");
});

test("a repo change closes run and log tabs", async () => {
  const { view, env, cx, settle } = opened();
  view.openLog("12", job, cx);
  env.shared["omni-forge.open"] = { tab: "F", key: '["github","github.com","o/other","9"]' };
  view.tick(cx);
  await settle();
  assert.deepEqual(JSON.parse(JSON.stringify(view.tabs.list.map((t) => t.id))), ["runs", "mrs", "run:9"]);
  assert.equal(view.logs.size, 0);
  assert.deepEqual([...view.details.keys()], ["9"]);
});

test("shared open with key runs selects the Runs tab", () => {
  const { view, env, cx } = opened();
  assert.equal(view.tabs.selected, "run:12");
  env.shared["omni-forge.open"] = { tab: "F", key: "runs" };
  view.tick(cx);
  assert.equal(view.tabs.selected, "runs");
  assert.equal(env.shared["omni-forge.open"], null);
  assert.ok(view.details.has("12")); // the run tab stays open
});

test("shared open with key mrs selects the MRs tab", () => {
  const { view, env, cx } = opened();
  env.shared["omni-forge.open"] = { tab: "F", key: "mrs" };
  view.tick(cx);
  assert.equal(view.tabs.selected, "mrs");
  assert.equal(env.shared["omni-forge.open"], null);
});

test("shared open with an MR key opens that MR tab", () => {
  const { view, env, cx } = opened();
  env.shared["omni-forge.open"] = { tab: "F", key: JSON.stringify({ kind: "github", host: "github.com", path: "o/repo-a", mr: 5 }) };
  view.tick(cx);
  assert.equal(view.tabs.selected, "mr:5");
  assert.equal(view.tabs.find("mr:5").kind, "mr");
});

test("props.open mrs starts on the MRs tab; an MR key for another repo switches repo", () => {
  const a = setup({ given: { view: "full", open: "mrs" } });
  assert.equal(a.view.tabs.selected, "mrs");
  const b = setup({ given: { view: "full", open: JSON.stringify({ kind: "gitlab", host: "gl.test", path: "g/p", mr: 3 }) } });
  assert.deepEqual({ ...b.view.repo }, { kind: "gitlab", host: "gl.test", path: "g/p" });
  assert.equal(b.view.tabs.selected, "mr:3");
});

test("a repo change drops MR tabs and resets the MRs list", async () => {
  const { view, env, cx, settle } = opened();
  view.openMr("5", cx);
  const old = view.mrList;
  env.shared["omni-forge.open"] = { tab: "F", key: '["github","github.com","o/other","9"]' };
  view.tick(cx);
  await settle();
  assert.deepEqual(JSON.parse(JSON.stringify(view.tabs.list.map((t) => t.id))), ["runs", "mrs", "run:9"]);
  assert.notEqual(view.mrList, old);
});

test("the MRs list polls only while the MRs tab is selected and visible", async () => {
  const { view, env, cx, settle } = opened();
  let loads = 0;
  view.mrList.load = () => { loads++; };
  view.tick(cx);
  assert.equal(loads, 0); // a run tab is selected
  view.selectTab("mrs", cx);
  view.tick(cx);
  assert.equal(loads, 1);
  env.focus = focusOn("pa", "A"); // another tab: not visible
  view.tick(cx);
  assert.equal(loads, 1);
});

test("props.open mrs survives the first repo detection", async () => {
  const { view, cx, settle } = setup({ given: { view: "full", open: "mrs" }, shared: { "omni-forge.last-loc": { cwd: "/w/repo-b", machine: null, branch: "dev" } } });
  view.tick(cx);
  await settle();
  assert.equal(view.repo.path, "o/repo-b");
  assert.equal(view.tabs.selected, "mrs");
});

test("Refresh on an MR item tab reloads that page, not a list", async () => {
  const { view, env, cx } = opened();
  view.openMr("5", cx);
  let loads = 0;
  view.loadList = () => { loads++; };
  view.mrList.load = () => { loads++; };
  const loaded = env.pages[0].loaded; // opening loads once
  view.refresh(cx);
  assert.equal(loads, 0);
  assert.equal(env.pages[0].loaded, loaded + 1);
});

test("closing an MR tab drops its page; a repo change drops them all", async () => {
  const { view, cx } = opened();
  view.openMr("5", cx);
  view.openMr("6", cx);
  assert.deepEqual([...view.mrPages.keys()], ["5", "6"]);
  view.closeTab("mr:5", cx);
  assert.deepEqual([...view.mrPages.keys()], ["6"]);
  view.repoChanged();
  assert.equal(view.mrPages.size, 0);
});

test("an MR opened from props.open does not load its page while herdr-app checks", () => {
  const key = JSON.stringify({ kind: "gitlab", host: "gl.test", path: "g/p", mr: 3 });
  const checked = setup({ given: { view: "full", open: key }, checking: true });
  assert.equal(checked.env.pages[0].loaded, undefined);
  const live = setup({ given: { view: "full", open: key } });
  assert.equal(live.env.pages[0].loaded, 1);
});
