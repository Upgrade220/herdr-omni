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
  const mod = load(["ci/poller.js", "forge/model.js", "views/runs.js", "views/mrs.js", "views/ui.js", "views/people.js", "views/mr-page.js"], {
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
