// MrPage: load, stale answers, polling, tab label, discussion filtering, with herdr stubbed.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { load } = require("./load.cjs");
const plain = (x) => JSON.parse(JSON.stringify(x)); // objects from the vm context have another prototype

function fakeState() {
  let v = "";
  const handlers = {};
  return { on(n, f) { handlers[n] = f; }, value: () => v, set_value(x) { v = x; }, fire(n, cx) { handlers[n]?.({}, cx); }, type(x, cx) { v = x; handlers.change?.({}, cx); } };
}

function setup({ detail, opened = [], results = [], provider = {}, capabilities = {}, me = undefined } = {}) {
  const env = { opened, notified: [], labels: [], calls: [] };
  const mod = load(["ci/poller.js", "forge/model.js", "views/runs.js", "views/mrs.js", "views/ui.js", "views/people.js", "code/syntax.js", "views/mr-page.js"], {
    InputState: { new: fakeState },
    TextareaState: { new: () => Object.assign(fakeState(), { set_auto_grow() {} }) },
    notify: (n) => env.notified.push(n),
    openMrFile: async (a) => { env.opened.push(a); return results.shift() ?? { ok: true }; },
  });
  const owner = {
    repo: { kind: "gitlab", host: "git.example.org", path: "group/app", url: "u" },
    loc: { cwd: "/w", machine: null },
    gen: 1,
    mrList: { me },
    provider: { capabilities, ...Object.fromEntries(["approve", "unapprove", "comment", "reply", "resolve", "update", "setDraft", "setReviewers", "setAssignees", "close", "reopen"].map((m) => [m, async (...a) => { env.calls.push([m, ...a]); }])), ...provider, mrDetail: detail ?? (async (n) => ({ mr: { number: n, title: "Fix totals", url: "https://git.example.org/group/app/-/merge_requests/7" }, description: "d", threads: [], files: [] })) },
    tabs: { setMr: (x) => env.labels.push(x) },
    mrPages: new Map(),
  };
  const page = new mod.MrPage(owner, "7");
  owner.mrPages.set("7", page);
  const pending = [];
  const cx = { notify() {}, spawn(fn) { const p = fn(cx); pending.push(p); return p; } };
  const settle = async () => { while (pending.length) await pending.shift(); };
  return { mod, owner, page, cx, settle, env };
}

test("load fills the page, relabels the tab and schedules the next poll in 15 s", async () => {
  const { page, cx, settle, env } = setup();
  const before = Date.now();
  page.load(cx);
  assert.equal(page.loading, true);
  await settle();
  assert.equal(page.loading, false);
  assert.equal(page.data.mr.title, "Fix totals");
  assert.deepEqual(plain(env.labels), [{ number: "7", label: "!7 Fix totals" }]);
  assert.ok(page.nextAt >= before + 15000 && page.nextAt <= Date.now() + 15000);
});

test("a late reply for another repo is dropped", async () => {
  let release;
  const { page, owner, cx, settle, env } = setup({ detail: () => new Promise((r) => { release = r; }) });
  page.load(cx);
  owner.gen = 2; // the repo changed meanwhile
  release({ mr: { number: 7, title: "Other repo's MR" }, description: "", threads: [], files: [] });
  await settle();
  assert.equal(page.data, null);
  assert.deepEqual(env.labels, []);
  assert.equal(page.loading, false);
});

test("a failed fetch keeps the error and backs off", async () => {
  const { page, cx, settle } = setup({ detail: async () => { throw new Error("fatal: could not read"); } });
  page.load(cx);
  await settle();
  assert.match(page.error.message, /could not read/);
  assert.equal(page.data, null);
  assert.equal(page.errors, 1);
  assert.ok(page.nextAt > Date.now());
});

test("a refresh failure after a good load keeps the data", async () => {
  let fail = false;
  const { page, cx, settle } = setup({ detail: async (n) => { if (fail) throw new Error("boom"); return { mr: { number: n, title: "T" }, description: "", threads: [], files: [] }; } });
  page.load(cx); await settle();
  fail = true;
  page.load(cx); await settle();
  assert.equal(page.data.mr.title, "T");
  assert.equal(page.error.message, "boom");
});

test("system notes: only approvals and added-commit notes stay, dimmed", () => {
  const { mod } = setup();
  const note = (id, body, system) => ({ id, author: "a", body, createdAt: "", system });
  const threads = [
    { id: "1", notes: [note("1", "approved this merge request", true)] },
    { id: "2", notes: [note("2", "added 3 commits\n\n- abc", true)] },
    { id: "3", notes: [note("3", "added 1 commit", true)] },
    { id: "4", notes: [note("4", "changed the description", true)] },
    { id: "5", notes: [note("5", "marked this merge request as draft", true)] },
    { id: "6", notes: [note("6", "looks good", false), note("7", "assigned to @bob", true)] },
  ];
  const shown = mod.discussion(threads);
  assert.deepEqual(plain(shown.map((t) => t.id)), ["1", "2", "3", "6"]);
  assert.deepEqual(plain(shown.map((t) => t.notes.map((n) => [n.id, n.dim]))), [[["1", true]], [["2", true]], [["3", true]], [["6", false]]]);
});

test("mrWebUrl: the MR's url, else built from the repo", () => {
  const { mod } = setup();
  assert.equal(mod.mrWebUrl({ kind: "gitlab", host: "git.example.org", path: "group/app" }, "7"), "https://git.example.org/group/app/-/merge_requests/7");
  assert.equal(mod.mrWebUrl({ kind: "github", host: "github.com", path: "o/r" }, "7"), "https://github.com/o/r/pull/7");
  assert.equal(mod.mrWebUrl({ kind: "github", host: "github.com", path: "o/r" }, "7", { url: "https://x/y" }), "https://x/y");
});

test("openFile hands the path to openMrFile", async () => {
  const { page, cx, settle, env, owner } = setup();
  page.load(cx); await settle();
  page.openFile(cx, "src/cart.js");
  await settle();
  assert.equal(env.opened.length, 1);
  assert.equal(env.opened[0].path, "src/cart.js");
  assert.equal(env.opened[0].mr.number, 7);
  assert.equal(env.opened[0].repo, owner.repo);
});

test("a failed file open is kept on the page, not toasted; the next success clears it", async () => {
  const { page, cx, settle, env } = setup({ results: [{ ok: false, error: "fatal: could not resolve host" }, { ok: true }] });
  page.load(cx); await settle();
  page.openFile(cx, "a.js"); await settle();
  assert.deepEqual(plain(page.fileError), { path: "a.js", error: "fatal: could not resolve host" });
  assert.deepEqual(env.notified, []);
  page.openFile(cx, "b.js"); await settle();
  assert.equal(page.fileError, null);
});

test("dismissing the file error clears it", async () => {
  const { page, cx, settle } = setup({ results: [{ ok: false, error: "x" }] });
  page.load(cx); await settle();
  page.openFile(cx, "a.js"); await settle();
  page.dismissFileError(cx);
  assert.equal(page.fileError, null);
});

// ---- Task 8: actions ---------------------------------------------------------

const withMr = (mr, threads = []) => async (n) => ({ mr: { number: n, title: "Fix totals", state: "open", draft: false, reviewers: ["ann"], assignees: ["bob"], approvedBy: [], ...mr }, description: "old", threads, files: [] });
const thread = (id, extra = {}) => ({ id, resolvable: true, resolved: false, notes: [{ id: "n1", author: "a", body: "x", createdAt: "" }], ...extra });
const ready = async (opts) => { const s = setup(opts); s.page.load(s.cx); await s.settle(); return s; };
const click = (page, id, cx) => page.actions(page.data.mr).find((a) => a.id === id).onClick(cx);

test("Approve calls approve(n), disables the page's actions while it runs, then reloads", async () => {
  let release, loads = 0;
  const { page, cx, settle, env } = await ready({ detail: async (n) => { loads++; return withMr({})(n); }, provider: { approve: (n) => new Promise((r) => { release = r; env.calls.push(["approve", n]); }) } });
  click(page, "mr-approve", cx);
  assert.equal(page.acting.has("mr-approve"), true);
  assert.equal(page.busy(), true);
  release(); await settle();
  assert.deepEqual(plain(env.calls), [["approve", 7]]);
  assert.equal(page.busy(), false);
  assert.equal(loads, 2);
});

test("a failed action shows its error on the page, not as a toast, and does not reload", async () => {
  let loads = 0;
  const { page, cx, settle, env } = await ready({ detail: async (n) => { loads++; return withMr({})(n); }, provider: { approve: async () => { throw new Error("403 forbidden"); } } });
  click(page, "mr-approve", cx); await settle();
  assert.match(page.actionError.error.message, /403/);
  assert.deepEqual(env.notified, []);
  assert.equal(loads, 1);
  assert.equal(page.busy(), false);
  page.dismissActionError(cx);
  assert.equal(page.actionError, null);
});

test("Approve vs Revoke: Revoke only when me approved and the provider can revoke", async () => {
  const ids = (s) => s.page.actions(s.page.data.mr).map((a) => a.id);
  let s = await ready({ detail: withMr({ approvedBy: ["me"] }), me: "me", capabilities: { mr: { revoke: true } } });
  assert.ok(ids(s).includes("mr-revoke") && !ids(s).includes("mr-approve"));
  click(s.page, "mr-revoke", s.cx); await s.settle();
  assert.deepEqual(plain(s.env.calls), [["unapprove", 7]]);
  s = await ready({ detail: withMr({ approvedBy: ["me"] }), me: "me", capabilities: { mr: { revoke: false } } }); // GitHub
  assert.ok(!ids(s).includes("mr-revoke") && !ids(s).includes("mr-approve"));
  s = await ready({ detail: withMr({ approvedBy: ["me"] }), me: undefined, capabilities: { mr: { revoke: true } } }); // me unknown
  assert.ok(ids(s).includes("mr-approve") && !ids(s).includes("mr-revoke"));
  s = await ready({ detail: withMr({ approvedBy: ["other"] }), me: "me", capabilities: { mr: { revoke: true } } });
  assert.ok(ids(s).includes("mr-approve"));
});

test("a new comment: blank or whitespace does nothing, text calls comment(n, body) and clears the box", async () => {
  const { page, cx, settle, env } = await ready();
  page.commentBox.set_value("   \n ");
  page.submitComment(cx); await settle();
  assert.deepEqual(env.calls, []);
  page.commentBox.set_value("Looks good");
  page.submitComment(cx); await settle();
  assert.deepEqual(plain(env.calls), [["comment", 7, "Looks good"]]);
  assert.equal(page.commentBox.value(), "");
});

test("reply boxes exist for resolvable threads and GitHub comment threads; blank reply is a no-op", async () => {
  const { page, cx, settle, env } = await ready({ detail: withMr({}, [thread("d1"), thread("c:5", { resolvable: false }), thread("d2", { resolvable: false })]) });
  assert.ok(page.replyBoxes.has("d1") && page.replyBoxes.has("c:5") && !page.replyBoxes.has("d2"));
  page.replyBoxes.get("d1").set_value("  ");
  page.submitReply(cx, page.data.threads[0]); await settle();
  assert.deepEqual(env.calls, []);
  page.replyBoxes.get("d1").set_value("Fixed");
  page.submitReply(cx, page.data.threads[0]); await settle();
  page.replyBoxes.get("c:5").set_value("Thanks");
  page.submitReply(cx, page.data.threads[1]); await settle();
  assert.deepEqual(plain(env.calls), [["reply", 7, "d1", "Fixed"], ["reply", 7, "c:5", "Thanks"]]);
  assert.equal(page.replyBoxes.get("d1").value(), "");
});

test("Resolve / Unresolve flip the thread's state", async () => {
  const { page, cx, settle, env } = await ready({ detail: withMr({}, [thread("d1"), thread("d2", { resolved: true })]) });
  page.toggleResolve(cx, page.data.threads[0]); await settle();
  page.toggleResolve(cx, page.data.threads[1]); await settle();
  assert.deepEqual(plain(env.calls), [["resolve", 7, "d1", true], ["resolve", 7, "d2", false]]);
});

test("Edit: Save sends title and description; a blank title does nothing; Cancel closes", async () => {
  const { page, cx, settle, env } = await ready({ detail: withMr({}) });
  click(page, "mr-edit", cx);
  assert.equal(page.editing, true);
  assert.equal(page.editTitle.value(), "Fix totals");
  assert.equal(page.editBody.value(), "old");
  page.editTitle.set_value("  ");
  page.saveEdit(cx); await settle();
  assert.deepEqual(env.calls, []);
  assert.equal(page.editing, true);
  page.editTitle.set_value("Fix cart totals");
  page.editBody.set_value("new text");
  page.saveEdit(cx); await settle();
  assert.deepEqual(plain(env.calls), [["update", 7, { title: "Fix cart totals", description: "new text" }]]);
  assert.equal(page.editing, false);
  click(page, "mr-edit", cx);
  page.cancelEdit(cx);
  assert.equal(page.editing, false);
  assert.equal(env.calls.length, 1);
});

test("draft toggle: Mark as ready when draft, Mark as draft when not", async () => {
  let s = await ready({ detail: withMr({ draft: true }) });
  assert.equal(s.page.actions(s.page.data.mr).find((a) => a.id === "mr-draft").label, "Mark as ready");
  click(s.page, "mr-draft", s.cx); await s.settle();
  assert.deepEqual(plain(s.env.calls), [["setDraft", 7, false]]);
  s = await ready({ detail: withMr({ draft: false }) });
  assert.equal(s.page.actions(s.page.data.mr).find((a) => a.id === "mr-draft").label, "Mark as draft");
  click(s.page, "mr-draft", s.cx); await s.settle();
  assert.deepEqual(plain(s.env.calls), [["setDraft", 7, true]]);
});

test("Close when open, Reopen when closed, only Open in browser when merged; never a Merge control", async () => {
  const labels = async (state) => { const s = await ready({ detail: withMr({ state }) }); return { s, ids: s.page.actions(s.page.data.mr).map((a) => a.id) }; };
  let { s, ids } = await labels("open");
  assert.ok(ids.includes("mr-close") && !ids.includes("mr-reopen"));
  click(s.page, "mr-close", s.cx); await s.settle();
  assert.deepEqual(plain(s.env.calls), [["close", 7]]);
  ({ s, ids } = await labels("closed"));
  assert.ok(ids.includes("mr-reopen") && !ids.includes("mr-close"));
  click(s.page, "mr-reopen", s.cx); await s.settle();
  assert.deepEqual(plain(s.env.calls), [["reopen", 7]]);
  ({ ids } = await labels("merged"));
  assert.deepEqual(plain(ids), []);
  const src = require("node:fs").readFileSync(require("node:path").join(__dirname, "../mods/omni-forge/views/mr-page.js"), "utf8");
  assert.doesNotMatch(src, /id\(\s*[`"][^`"]*merge/i);
  assert.doesNotMatch(src, /button\(t,\s*[`"][^`"]*merge/i);
  for (const id of ids) assert.doesNotMatch(id, /merge/i);
});

test("Reviewers: the picker starts from the current list; Save sends the full list; Cancel discards", async () => {
  const { page, cx, settle, env } = await ready({ detail: withMr({}), provider: { searchUsers: async () => [] } });
  click(page, "mr-reviewers", cx);
  assert.deepEqual(plain(page.people.picker.list), ["ann"]);
  page.people.picker.add("cat", cx);
  page.people.picker.remove("ann", cx);
  page.people.onSave([...page.people.picker.list], cx); await settle();
  assert.deepEqual(plain(env.calls), [["setReviewers", 7, ["cat"]]]);
  assert.equal(page.people, null);
  click(page, "mr-assignees", cx);
  assert.deepEqual(plain(page.people.picker.list), ["bob"]);
  page.people.picker.add("dan", cx);
  page.people.onSave([...page.people.picker.list], cx); await settle();
  assert.deepEqual(plain(env.calls[1]), ["setAssignees", 7, ["bob", "dan"]]);
  click(page, "mr-reviewers", cx);
  page.people.picker.add("zed", cx);
  page.people.onCancel(cx);
  assert.equal(page.people, null);
  assert.equal(env.calls.length, 2);
});

// ---- the people picker ---------------------------------------------------------

function pickerSetup(search) {
  const mod = load(["views/ui.js", "views/people.js"], { InputState: { new: fakeState } });
  const timers = [];
  const pending = [];
  const cx = { notify() {}, timer: { after: (ms, fn) => { const t = { ms, fn, cancelled: false, cancel() { t.cancelled = true; } }; timers.push(t); return t; } }, spawn(fn) { const p = fn(cx); pending.push(p); return p; } };
  const picker = new mod.PeoplePicker({ initial: ["ann"], search, onSave() {}, onCancel() {} });
  const settle = async () => { while (pending.length) await pending.shift(); };
  return { picker, cx, timers, settle };
}

test("picker search is debounced to 300 ms and only the last keystroke asks", async () => {
  const asked = [];
  const { picker, cx, timers, settle } = pickerSetup(async (q) => { asked.push(q); return [{ username: "bob", name: "Bob" }, { username: "ann", name: "Ann" }]; });
  picker.input.type("b", cx); picker.input.type("bo", cx); picker.input.type("bob", cx);
  assert.deepEqual(asked, []);
  assert.ok(timers.every((t) => t.ms === 300));
  assert.equal(timers.filter((t) => !t.cancelled).length, 1);
  for (const t of timers) if (!t.cancelled) t.fn(cx);
  await settle();
  assert.deepEqual(asked, ["bob"]);
  assert.deepEqual(plain(picker.matches.map((m) => m.username)), ["bob", "ann"]);
});

test("picker: a blank query asks nothing; a stale answer is dropped; add/remove edit the list", async () => {
  let release;
  const { picker, cx, timers, settle } = pickerSetup(() => new Promise((r) => { release = r; }));
  picker.input.type("  ", cx);
  assert.equal(timers.length, 0);
  picker.input.type("bo", cx);
  timers[0].fn(cx);
  picker.input.type("bob", cx); // newer keystroke while the first search is out
  release([{ username: "late", name: "" }]);
  await settle();
  assert.deepEqual(plain(picker.matches), []);
  picker.add("cat", cx); picker.add("cat", cx);
  assert.deepEqual(plain(picker.list), ["ann", "cat"]);
  picker.remove("ann", cx);
  assert.deepEqual(plain(picker.list), ["cat"]);
});

// ---- review fixes ----------------------------------------------------------------

test("Cancel (and every other way the picker goes away) cancels its pending search", async () => {
  const asked = [];
  const { page, cx, env } = await ready({ detail: withMr({}), provider: { searchUsers: async (q) => { asked.push(q); return []; } } });
  const timers = [];
  cx.timer = { after: (ms, fn) => { const t = { fn, cancelled: false, cancel() { t.cancelled = true; } }; timers.push(t); return t; } };
  click(page, "mr-reviewers", cx);
  const first = page.people.picker;
  first.input.type("bo", cx);
  page.people.onCancel(cx);
  assert.equal(timers[0].cancelled, true);
  timers[0].fn(cx); // even a timer that still fires asks nothing
  assert.deepEqual(asked, []);
  click(page, "mr-reviewers", cx);
  page.people.picker.input.type("x", cx);
  click(page, "mr-assignees", cx); // replaces the picker
  assert.equal(timers[1].cancelled, true);
  page.people.picker.input.type("y", cx);
  page.dispose(); // the tab closed
  assert.equal(timers[2].cancelled, true);
  assert.equal(page.people, null);
  assert.deepEqual(asked, []);
  assert.deepEqual(env.calls, []);
});

test("a comment or reply typed while the request is out is kept", async () => {
  let release;
  const { page, cx, settle } = await ready({ detail: withMr({}, [thread("d1")]), provider: { comment: () => new Promise((r) => { release = r; }), reply: () => new Promise((r) => { release = r; }) } });
  page.commentBox.set_value("first");
  page.submitComment(cx);
  page.commentBox.set_value("first and more");
  release(); await settle();
  assert.equal(page.commentBox.value(), "first and more");
  page.replyBoxes.get("d1").set_value("r1");
  page.submitReply(cx, page.data.threads[0]);
  page.replyBoxes.get("d1").set_value("r1 plus");
  release(); await settle();
  assert.equal(page.replyBoxes.get("d1").value(), "r1 plus");
});

test("Edit while editing keeps the unsaved edits", async () => {
  const { page, cx } = await ready({ detail: withMr({}) });
  click(page, "mr-edit", cx);
  page.editTitle.set_value("Half typed");
  click(page, "mr-edit", cx);
  assert.equal(page.editTitle.value(), "Half typed");
});

// ---- final review fixes -------------------------------------------------------

test("me comes from the detail first, so Revoke shows when the list never loaded", async () => {
  const ids = (s) => s.page.actions(s.page.data.mr).map((a) => a.id);
  const detail = (me, mr) => async (n) => ({ ...(await withMr(mr)(n)), me });
  let s = await ready({ detail: detail("me", { approvedBy: ["me"] }), me: undefined, capabilities: { mr: { revoke: true } } });
  assert.ok(ids(s).includes("mr-revoke") && !ids(s).includes("mr-approve"));
  s = await ready({ detail: detail("", { approvedBy: ["me"] }), me: "me", capabilities: { mr: { revoke: true } } }); // falls back to the list's me
  assert.ok(ids(s).includes("mr-revoke"));
});

test("no Approve on your own MR", async () => {
  const s = await ready({ detail: async (n) => ({ ...(await withMr({ author: "me" })(n)), me: "me" }), capabilities: { mr: { revoke: true } } });
  assert.ok(!s.page.actions(s.page.data.mr).some((a) => a.id === "mr-approve"));
  assert.ok(!s.page.actions(s.page.data.mr).some((a) => a.id === "mr-revoke"), "no Revoke on your own unapproved MR");
});

test("a pipeline pill without a run opens the MR in the browser; with a run it opens the run", async () => {
  const s = await ready();
  const opened = [];
  const cx = { open_url: (u) => opened.push(u) };
  const runs = [];
  s.owner.openRun = (r) => runs.push(r.id);
  s.page.openPipeline({ number: 7, url: "https://github.com/o/r/pull/7", pipeline: "running", pipelineRunId: null }, cx);
  assert.deepEqual(opened, ["https://github.com/o/r/pull/7"]);
  s.page.openPipeline({ number: 7, pipeline: "running", pipelineRunId: "9" }, cx);
  assert.deepEqual(runs, ["9"]);
  assert.equal(opened.length, 1);
});

test("resolved threads start folded, open ones unfolded; a click flips either", async () => {
  const { page, cx } = await ready({ detail: withMr({}, [thread("d1"), thread("d2", { resolved: true })]) });
  const [open, done] = page.data.threads;
  assert.equal(page.folded(open), false);
  assert.equal(page.folded(done), true);
  page.toggleFold(cx, done);
  page.toggleFold(cx, open);
  assert.equal(page.folded(done), false);
  assert.equal(page.folded(open), true);
});

test("noteMarkdown: links to the forge become absolute, images become links", () => {
  const { mod } = setup();
  const gl = { kind: "gitlab", host: "git.example.org", path: "group/app" };
  assert.equal(mod.noteMarkdown("see [log](/uploads/ab/x.txt)", gl), "see [log](https://git.example.org/group/app/uploads/ab/x.txt)");
  assert.equal(mod.noteMarkdown("[i](/group/other/-/issues/1)", gl), "[i](https://git.example.org/group/other/-/issues/1)");
  assert.equal(mod.noteMarkdown("![shot](/uploads/ab/s.png)", gl), "[🖼 shot](https://git.example.org/group/app/uploads/ab/s.png)");
  assert.equal(mod.noteMarkdown("![](https://e.org/a.png) and [x](https://e.org)", gl), "[🖼 image](https://e.org/a.png) and [x](https://e.org)");
  assert.equal(mod.noteMarkdown("", gl), "");
});

test("systemEvent: a system note's first line and its commits; a plain note is no event", () => {
  const { mod } = setup();
  const body = "added 2 commits\n\n<ul><li>8791b672 - Fix totals</li><li>e3fee07a - Round <b>sums</b></li></ul>\n\n[Compare with previous version](/group/app/-/merge_requests/7/diffs?diff_id=1)";
  assert.deepEqual(plain(mod.systemEvent({ system: true, body })), { text: "added 2 commits", commits: ["8791b672 Fix totals", "e3fee07a Round sums"] });
  assert.deepEqual(plain(mod.systemEvent({ system: true, body: "approved this merge request" })), { text: "approved this merge request", commits: [] });
  assert.equal(mod.systemEvent({ system: false, body: "looks good" }), null);
});

test("threadLabel: a line thread's file:line, a thread with replies, a lone comment; an all-system thread is an event", () => {
  const { mod } = setup();
  const n = (system = false) => ({ id: "n", author: "a", body: "x", createdAt: "", system });
  assert.equal(mod.threadLabel({ path: "a.js", line: 3, notes: [n()] }), "a.js:3");
  assert.equal(mod.threadLabel({ path: "a.js", line: null, notes: [n()] }), "a.js");
  assert.equal(mod.threadLabel({ notes: [n(), n()] }), "Thread");
  assert.equal(mod.threadLabel({ notes: [n()] }), "Comment");
  assert.equal(mod.threadLabel({ notes: [n(true)] }), null);
});

test("snippetFromHunk: the last rows of a diff hunk with their line numbers", () => {
  const { mod } = setup();
  const rows = plain(mod.snippetFromHunk("@@ -5,3 +5,4 @@ fn x\n a\n-b\n+c\n+d\n e", 4));
  assert.deepEqual(rows, [
    { no: 6, mark: "-", text: "b" },
    { no: 6, mark: "+", text: "c" },
    { no: 7, mark: "+", text: "d" },
    { no: 8, mark: " ", text: "e" },
  ]);
  assert.deepEqual(plain(mod.snippetFromHunk("", 4)), []);
});

test("snippetFromFile: the n lines ending at the commented one, which carries the mark", () => {
  const { mod } = setup();
  const text = "l1\nl2\nl3\nl4\nl5\n";
  assert.deepEqual(plain(mod.snippetFromFile(text, 4, "+", 3)), [
    { no: 2, mark: " ", text: "l2" },
    { no: 3, mark: " ", text: "l3" },
    { no: 4, mark: "+", text: "l4" },
  ]);
  assert.deepEqual(plain(mod.snippetFromFile(text, 1, " ", 3)), [{ no: 1, mark: " ", text: "l1" }]);
  assert.deepEqual(plain(mod.snippetFromFile(text, 99, " ", 3)), []);
});

test("snippets: a GitLab line thread's file is read once per commit and path; folded threads wait", async () => {
  const reads = [];
  const at = (line) => ({ sha: "h1", path: "a.js", line, mark: "+" });
  const { page, cx, settle } = await ready({
    detail: withMr({}, [thread("d1", { path: "a.js", line: 2, at: at(2) }), thread("d2", { path: "a.js", line: 3, at: at(3) }), thread("d3", { path: "b.js", line: 1, resolved: true, at: { sha: "h1", path: "b.js", line: 1, mark: " " } })]),
    provider: { fileAt: async (sha, path) => { reads.push([sha, path]); return "x1\ny2\nz3\n"; } },
  });
  await settle();
  assert.deepEqual(reads, [["h1", "a.js"]]);
  assert.deepEqual(plain(page.snippet(page.data.threads[0]).rows.map((r) => r.text)), ["x1", "y2"]);
  assert.equal(page.snippet(page.data.threads[2]), null); // folded: not read yet
  page.toggleFold(cx, page.data.threads[2]); await settle();
  assert.deepEqual(reads, [["h1", "a.js"], ["h1", "b.js"]]);
  page.load(cx); await settle();
  assert.equal(reads.length, 2);
});

test("snippets: a failed read shows its error; GitHub threads use their hunk with no read", async () => {
  const { page, settle } = await ready({
    detail: withMr({}, [thread("d1", { path: "a.js", line: 2, at: { sha: "h1", path: "a.js", line: 2, mark: "+" } }), thread("t|1", { path: "c.js", line: 6, hunk: "@@ -5,1 +5,2 @@\n a\n+b" })]),
    provider: { fileAt: async () => { throw new Error("404 File Not Found"); } },
  });
  await settle();
  assert.match(page.snippet(page.data.threads[0]).error, /404/);
  assert.deepEqual(plain(page.snippet(page.data.threads[1]).rows.map(({ no, mark, text }) => ({ no, mark, text }))), [{ no: 5, mark: " ", text: "a" }, { no: 6, mark: "+", text: "b" }]);
});

test("the files list folds and unfolds", async () => {
  const { page, cx } = await ready({ detail: withMr({}) });
  assert.equal(page.filesOpen, true);
  page.toggleFiles(cx);
  assert.equal(page.filesOpen, false);
  page.toggleFiles(cx);
  assert.equal(page.filesOpen, true);
});

test("snippet rows carry syntax runs: a JS keyword, a string; a comment opened above the window stays a comment", async () => {
  const at = (line) => ({ sha: "h1", path: "a.js", line, mark: "+" });
  const { page, settle } = await ready({
    detail: withMr({}, [thread("d1", { path: "a.js", line: 7, at: at(7) }), thread("t|1", { path: "c.py", line: 6, hunk: "@@ -5,1 +5,2 @@\n def f():\n+    return 'x'" })]),
    provider: { fileAt: async () => "/*\n1\n2\n3\n4\nstill comment */\nconst s = 'x';\n" },
  });
  await settle();
  const rows = page.snippet(page.data.threads[0]).rows;
  const last = plain(rows[rows.length - 1].runs);
  assert.deepEqual(last.find((r) => r.text === "const"), { text: "const", kind: "keyword" });
  assert.equal(last.find((r) => r.text.includes("'x'")).kind, "string");
  assert.equal(plain(rows[rows.length - 2].runs)[0].kind, "comment");
  const py = page.snippet(page.data.threads[1]).rows;
  assert.equal(plain(py[0].runs).find((r) => r.text === "def").kind, "keyword");
});

test("code rows are worked out when data and files arrive, so render only reads them", async () => {
  const { page, settle } = await ready({
    detail: withMr({}, [thread("t|1", { path: "c.js", line: 6, hunk: "@@ -5,1 +5,2 @@\n a\n+b" }), thread("d1", { path: "a.js", line: 1, at: { sha: "h", path: "a.js", line: 1, mark: " " } })]),
    provider: { fileAt: async () => "x\n" },
  });
  await settle();
  assert.equal(page.snippetRows.size, 2);
});

test("personColor: the same name always gets the same theme colour; names spread over the palette", () => {
  const { mod } = setup();
  const t = Object.fromEntries([...Array(16).keys()].map((i) => [`ansi${i}`, `#0000${String(i).padStart(2, "0")}`]));
  const palette = new Set(mod.PERSON_COLORS.map((k) => t[k]));
  assert.equal(mod.personColor("ann", t), mod.personColor("ann", t));
  const names = ["ann", "bob", "carol", "dave", "erin", "frank", "grace", "heidi"];
  const got = names.map((n) => mod.personColor(n, t));
  assert.ok(got.every((c) => palette.has(c)));
  assert.ok(new Set(got).size >= 5, `spread: ${new Set(got).size}`);
  assert.equal(mod.tint("#11223344", "40"), "#11223340");
  assert.equal(mod.tint("#112233", "40"), "#11223340");
});
