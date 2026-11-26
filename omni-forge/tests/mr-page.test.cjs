// MrPage: load, stale answers, polling, tab label, discussion filtering, with herdr stubbed.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { load } = require("./load.cjs");
const plain = (x) => JSON.parse(JSON.stringify(x)); // objects from the vm context have another prototype

function setup({ detail, opened = [], results = [] } = {}) {
  const env = { opened, notified: [], labels: [] };
  const mod = load(["ci/poller.js", "forge/model.js", "views/runs.js", "views/mrs.js", "views/ui.js", "views/mr-page.js"], {
    notify: (n) => env.notified.push(n),
    openMrFile: async (a) => { env.opened.push(a); return results.shift() ?? { ok: true }; },
  });
  const owner = {
    repo: { kind: "gitlab", host: "git.example.org", path: "group/app", url: "u" },
    loc: { cwd: "/w", machine: null },
    gen: 1,
    provider: { capabilities: {}, mrDetail: detail ?? (async (n) => ({ mr: { number: n, title: "Fix totals", url: "https://git.example.org/group/app/-/merge_requests/7" }, description: "d", threads: [], files: [] })) },
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
