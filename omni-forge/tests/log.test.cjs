const { test } = require("node:test");
const assert = require("node:assert/strict");
const { load } = require("./load.cjs");
const { cleanLog } = load(["ci/log.js"]);
const plain = (line) => line.spans.map((s) => s.text).join("");

test("GitLab sections are stripped and SGR green becomes a span", () => {
  const raw = "section_start:1700000000:step_script\r\x1b[0K\x1b[36;1mRunning\x1b[0;m\n\x1b[32mok\x1b[0m done\nsection_end:1700000001:step_script\r\x1b[0K\n";
  const { lines, firstError } = cleanLog(raw);
  const all = lines.map(plain).join("\n");
  assert.ok(!all.includes("section_"));
  assert.ok(!all.includes("\x1b"));
  const ok = lines.find((l) => plain(l) === "ok done");
  assert.ok(ok);
  assert.equal(ok.spans[0].text, "ok");
  assert.equal(ok.spans[0].fg, 2);
  assert.equal(ok.spans[1].fg, undefined);
  assert.equal(firstError, null);
});

test("carriage return keeps text after the last overwrite", () => {
  assert.equal(plain(cleanLog("foo\rbar").lines[0]), "bar");
});

test("GitHub timestamp is stripped and firstError found", () => {
  const raw = "2026-01-01T00:00:00.0000000Z hello\n2026-01-01T00:00:01.0000000Z ##[error]boom\n";
  const { lines, firstError } = cleanLog(raw);
  assert.equal(plain(lines[1]), "##[error]boom");
  assert.equal(firstError, 1);
});

test("plain log has no firstError", () => {
  assert.equal(cleanLog("all good\nstill fine\n").firstError, null);
});

test("bold and bright colours, other escapes dropped", () => {
  const { lines } = cleanLog("\x1b[1m\x1b[91mbad\x1b[0m\x1b[2K x");
  assert.equal(lines[0].spans[0].bold, true);
  assert.equal(lines[0].spans[0].fg, 9);
  assert.equal(plain(lines[0]), "bad x");
});

test("findJob matches numeric and gid ids", () => {
  const { findJob } = load(["ci/log.js"]);
  const detail = { groups: [{ name: "build", jobs: [{ id: "gid://gitlab/Ci::Build/123", url: "u1" }] }, { name: "t", jobs: [{ id: "456", url: "u2" }] }] };
  assert.equal(findJob(detail, 123).url, "u1");
  assert.equal(findJob(detail, "gid://gitlab/Ci::Build/123").url, "u1");
  assert.equal(findJob(detail, "456").url, "u2");
  assert.equal(findJob(detail, 999), null);
});

// Live, Herdr hands a pane's init an empty object and the props come from props().
test("LogView reads props() when init is given an empty object", async () => {
  const given = { view: "log", kind: "gitlab", host: "gl.test", path: "g/p", runId: "5", jobId: "gid://gitlab/Ci::Build/9", name: "unit" };
  const asked = [];
  const { LogView } = load(["ci/log.js", "views/log.js"], {
    checking: () => false,
    props: () => given,
    VirtualListScrollHandle: { new: () => ({ scroll_to_item() {} }) },
    providerFor: (p) => ({
      capabilities: { liveLog: true },
      jobLog: async (id) => { asked.push(["log", p.host, id]); return { text: "hi\n", truncated: false, available: true }; },
      runDetail: async () => ({ run: {}, groups: [] }),
    }),
  });
  const pending = [];
  const cx = { timer: { every() {} }, notify() {}, spawn(fn) { pending.push(fn(cx)); } };
  const view = new LogView();
  view.init({}, cx);
  await Promise.all(pending);
  assert.equal(view.props.name, "unit");
  assert.deepEqual(asked, [["log", "gl.test", "gid://gitlab/Ci::Build/9"]]);
});

// GitLab runner 18+ timestamped logs: "<ts> <stream><O|E>[+]"; "+" continues the line before.
test("GitLab timestamped log: prefix stripped, + lines joined, sections still cleaned", () => {
  const raw = [
    "2026-01-01T00:00:00.000001Z 00O \x1b[0KRunning with gitlab-runner\x1b[0;m",
    "2026-01-01T00:00:00.000002Z 00O section_start:1:prepare\r\x1b[0K",
    "2026-01-01T00:00:00.000003Z 00O+\x1b[0K\x1b[36;1mPreparing\x1b[0;m",
    "2026-01-01T00:00:00.000004Z 01E npm ERR! oops",
    "2026-01-01T00:00:00.000005Z 01O part one",
    "2026-01-01T00:00:00.000006Z 01O+ and two",
    "",
  ].join("\n");
  const { lines } = cleanLog(raw);
  assert.deepEqual([...lines.map(plain)], ["Running with gitlab-runner", "Preparing", "npm ERR! oops", "part one and two"]);
  assert.equal(lines[1].spans[0].fg, 6);
});

test("firstError: an exception name beats the runner's later 'failed job' line", () => {
  const raw = "ok\nReferenceError: isCI is not defined\n    at x\nUploading artifacts for failed job\n";
  assert.equal(cleanLog(raw).firstError, 1);
});

// The list only exists from the frame after the log arrives, so the jump waits for a timer.
test("LogView jumps to the first error once, after the list has been drawn", async () => {
  const scrolls = [];
  const afters = [];
  const { LogView } = load(["ci/log.js", "views/log.js"], {
    checking: () => false,
    props: () => ({}),
    VirtualListScrollHandle: { new: () => ({ scroll_to_item: (i, how) => scrolls.push([i, how]) }) },
    providerFor: () => ({
      capabilities: { liveLog: true },
      jobLog: async () => ({ text: "a\nb\nTypeError: x\n", truncated: false, available: true }),
      runDetail: async () => ({ run: {}, groups: [] }),
    }),
  });
  const pending = [];
  const cx = { timer: { every() {}, after: (ms, fn) => afters.push(fn) }, notify() {}, spawn(fn) { pending.push(fn(cx)); } };
  const view = new LogView();
  view.init({ jobId: "1", name: "j" }, cx);
  await Promise.all(pending.splice(0));
  assert.equal(scrolls.length, 0);
  afters.splice(0).forEach((fn) => fn(cx));
  assert.deepEqual(scrolls, [[2, "center"]]);
  view.refresh(cx);
  await Promise.all(pending.splice(0));
  afters.splice(0).forEach((fn) => fn(cx));
  assert.equal(scrolls.length, 1);
});

test("LogView runs no CLI and starts no timer during herdr-app check", () => {
  const asked = [];
  const { LogView } = load(["ci/log.js", "views/log.js"], {
    checking: () => true,
    props: () => ({}),
    VirtualListScrollHandle: { new: () => ({ scroll_to_item() {} }) },
    providerFor: () => ({ capabilities: { liveLog: true }, jobLog: async () => asked.push("log"), runDetail: async () => asked.push("detail") }),
  });
  let timers = 0;
  const cx = { timer: { every: () => timers++, after: () => timers++ }, notify() {}, spawn: (fn) => asked.push("spawn") };
  new LogView().init({ jobId: "1", name: "j" }, cx);
  assert.deepEqual(asked, []);
  assert.equal(timers, 0);
});

test("LogView keeps the ForgeError hint for the error note", async () => {
  const fail = (message, hint) => Object.assign(new Error(message), { name: "ForgeError", hint });
  let logFails = true;
  const { LogView } = load(["ci/log.js", "views/log.js"], {
    checking: () => false,
    props: () => ({}),
    VirtualListScrollHandle: { new: () => ({ scroll_to_item() {} }) },
    providerFor: () => ({
      capabilities: { liveLog: true },
      jobLog: async () => { if (logFails) throw fail("Not logged in to gl.test", "glab auth login --hostname gl.test"); return { text: "ok\n", truncated: false, available: true }; },
      runDetail: async () => { throw fail("Forbidden", "Access denied. Check the token's scopes (glab auth login --hostname gl.test)"); },
    }),
  });
  const pending = [];
  const cx = { timer: { every() {}, after() {} }, notify() {}, spawn(fn) { pending.push(fn(cx)); } };
  const view = new LogView();
  view.init({ jobId: "1", name: "j" }, cx);
  await Promise.all(pending.splice(0));
  assert.equal(view.error.message, "Not logged in to gl.test");
  assert.equal(view.error.hint, "glab auth login --hostname gl.test");
  logFails = false;
  view.refresh(cx);
  await Promise.all(pending.splice(0));
  assert.equal(view.error.message, "Could not check job status: Forbidden");
  assert.match(view.error.hint, /glab auth login --hostname gl\.test/);
});

test("an embedded LogView starts no timer; the owner's tick polls it while live and due", async () => {
  const asked = [];
  let status = "running";
  const { LogView } = load(["ci/log.js", "views/log.js"], {
    checking: () => false,
    props: () => ({}),
    VirtualListScrollHandle: { new: () => ({ scroll_to_item() {} }) },
    providerFor: () => ({
      capabilities: { liveLog: true },
      jobLog: async () => { asked.push("log"); return { text: "a\n", truncated: false, available: true }; },
      runDetail: async () => ({ run: {}, groups: [{ name: "b", jobs: [{ id: "1", status, url: "u" }] }] }),
    }),
  });
  let timers = 0;
  const pending = [];
  const cx = { timer: { every: () => timers++, after() {} }, notify() {}, spawn(fn) { pending.push(fn(cx)); } };
  const view = new LogView();
  view.initEmbedded({ kind: "gitlab", host: "gl.test", path: "g/p", runId: "5", jobId: "1", name: "j" }, cx);
  await Promise.all(pending.splice(0));
  assert.equal(timers, 0);
  assert.deepEqual(asked, ["log"]);
  view.tick(cx, view.nextAt - 1); // not due yet
  assert.deepEqual(asked, ["log"]);
  status = "success";
  view.tick(cx, view.nextAt);
  await Promise.all(pending.splice(0));
  assert.deepEqual(asked, ["log", "log"]);
  assert.equal(view.live, false);
  view.tick(cx, view.nextAt + 1e9); // finished: no more polling
  assert.deepEqual(asked, ["log", "log"]);
});

// ---- final-review fixes ----------------------------------------------------------

function el(ids) {
  const node = new Proxy(function () {}, {
    get: (_t, key) => (key === "id" ? (v) => { ids.push(v); return node; } : () => node),
    apply: () => node,
  });
  return node;
}

function embedded({ status = "running", ids = [], notes = { n: 0 } } = {}) {
  const job = { id: "gid://gitlab/Ci::Build/9", status, url: "u" };
  const g = {
    checking: () => false,
    props: () => ({}),
    theme: () => new Proxy({}, { get: () => "#000000" }),
    settings: () => ({}),
    VirtualListScrollHandle: { new: () => ({ scroll_to_item() {} }) },
    providerFor: () => ({
      capabilities: { liveLog: true },
      jobLog: async () => ({ text: "a\n", truncated: false, available: true }),
      runDetail: async () => ({ run: {}, groups: [{ name: "b", jobs: [job] }] }),
    }),
  };
  for (const name of ["div", "v_flex", "h_flex", "v_virtual_list"]) g[name] = () => el(ids);
  g.Scrollbar = { vertical: (id) => { ids.push(id); return el(ids); } };
  const { LogView } = load(["ci/log.js", "views/log.js"], g);
  const pending = [];
  const cx = { timer: { every() {}, after() {} }, notify: () => notes.n++, spawn(fn) { pending.push(fn(cx)); } };
  return { LogView, cx, pending, job, ids, notes };
}

test("each embedded log renders its own element ids, so switching logs re-measures", async () => {
  const { LogView, cx, pending, ids } = embedded();
  const view = new LogView();
  view.initEmbedded({ runId: "5", jobId: "gid://gitlab/Ci::Build/9", name: "j" }, cx);
  await Promise.all(pending.splice(0));
  view.render(cx);
  assert.ok(ids.includes("log-root-9"), JSON.stringify(ids));
  assert.ok(ids.includes("log-lines-9"));
  assert.ok(!ids.includes("log-root"));
});

test("refresh notifies when it starts and when it ends, even with nothing new", async () => {
  const { LogView, cx, pending, notes } = embedded();
  const view = new LogView();
  view.initEmbedded({ runId: "5", jobId: "9", name: "j" }, cx);
  await Promise.all(pending.splice(0));
  notes.n = 0;
  view.refresh(cx);
  assert.equal(view.busy, true);
  assert.equal(notes.n, 1); // the spinner shows at once
  await Promise.all(pending.splice(0));
  assert.equal(view.busy, false);
  assert.equal(notes.n, 2); // and clears though the log didn't change
});

test("an embedded log reports its job's status to the owner", async () => {
  const seen = [];
  const { LogView, cx, pending, job } = embedded({ status: "running" });
  const view = new LogView();
  view.initEmbedded({ runId: "5", jobId: "9", name: "j" }, cx, { onStatus: (s) => seen.push(s) });
  await Promise.all(pending.splice(0));
  job.status = "failed";
  view.refresh(cx);
  await Promise.all(pending.splice(0));
  assert.deepEqual(seen, ["running", "failed"]);
});
