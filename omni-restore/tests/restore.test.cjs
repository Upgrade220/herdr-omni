const test = require("node:test");
const assert = require("node:assert/strict");
const { load } = require("./load.cjs");

const R = load(["restore.js"]);
// vm objects come from another realm: compare their JSON shape.
const same = (actual, expected, msg) => assert.deepEqual(JSON.parse(JSON.stringify(actual)), expected, msg);

// A terminal as `hc get --json` gives it: shell pid `pid`, and what runs in it now.
const term = (address, pid, fg, labels = { "herdr.space": "s1", "herdr.tab": "tb1" }) => ({
  address, pid, state: "live", labels,
  foreground: fg === undefined ? { argv: ["/bin/zsh", "-l"], cwd: "/w/app", name: "zsh", pid } : fg,
});
const claude = (pid, argv = ["claude", "--dangerously-skip-permissions"], cwd = "/w/app") => ({ argv, cwd, name: "claude", pid });

test("isClaude: the claude program, by name or argv", () => {
  assert.equal(R.isClaude(claude(5)), true);
  assert.equal(R.isClaude({ argv: ["/opt/bin/claude"], name: "node", pid: 1 }), true);
  assert.equal(R.isClaude({ argv: ["zsh"], name: "zsh", pid: 1 }), false);
  assert.equal(R.isClaude(null), false);
});

test("looksClaude: a Herdr terminal whose agent reports claude-code", () => {
  const labels = { "herdr.tab": "tb1" };
  assert.equal(R.looksClaude({ labels, report: { app: "claude-code" } }), true);
  assert.equal(R.looksClaude({ labels, status: { app: "claude-code", state: "idle" } }), true);
  assert.equal(R.looksClaude({ labels, agent: "claude-code" }), true);
  assert.equal(R.looksClaude({ labels, program: { key: "claude" } }), true);
  assert.equal(R.looksClaude({ labels, agent: "zsh" }), false);
  assert.equal(R.looksClaude({ labels: {}, agent: "claude-code" }), false, "not Herdr's");
});

test("resumeArgv: same flags, old resume/continue dropped, --resume <id> added", () => {
  same(R.resumeArgv(["claude", "--dangerously-skip-permissions"], "abc"),
    ["claude", "--dangerously-skip-permissions", "--resume", "abc"]);
  same(R.resumeArgv(["claude", "--resume", "old", "-c", "--model", "opus", "--continue", "-r", "x", "--resume=y", "--session-id", "z", "--fork-session"], "new"),
    ["claude", "--model", "opus", "--resume", "new"]);
});

test("resumeArgv: a prompt given on the command line is not sent again", () => {
  same(R.resumeArgv(["claude", "--model", "opus", "fix the login bug"], "id"), ["claude", "--model", "opus", "--resume", "id"]);
});

test("shellLine: cd to the folder, then the command, single-quoted where needed", () => {
  assert.equal(R.shellLine("/w/my app", ["claude", "--resume", "a-1"]), "cd '/w/my app' && claude --resume a-1");
  assert.equal(R.shellLine("/w/it's", ["claude"]), "cd '/w/it'\\''s' && claude");
});

test("step: a running claude is recorded with its session, shell pid and place", () => {
  const seen = new Map([["t9", { t: term("t9", 100, claude(200)), sessionId: "S1" }]]);
  const { records, resume } = R.step({}, seen, 1000);
  same(resume, []);
  same(records.t9, {
    address: "t9", space: "s1", tab: "tb1", cwd: "/w/app",
    argv: ["claude", "--dangerously-skip-permissions"], sessionId: "S1", shellPid: 100, savedAt: 1000,
  });
});

test("step: no session file yet keeps the session already known; none known records nothing", () => {
  const known = { t9: { address: "t9", space: "s1", tab: "tb1", cwd: "/w/app", argv: ["claude"], sessionId: "OLD", shellPid: 100, savedAt: 1 } };
  const seen = new Map([["t9", { t: term("t9", 100, claude(200)), sessionId: null }]]);
  assert.equal(R.step(known, seen, 2).records.t9.sessionId, "OLD");
  same(R.step({}, seen, 2).records, {});
});

test("step: a session switched inside claude (/resume, /clear) is followed", () => {
  const known = { t9: { address: "t9", space: "s1", tab: "tb1", cwd: "/w/app", argv: ["claude"], sessionId: "OLD", shellPid: 100, savedAt: 1 } };
  const seen = new Map([["t9", { t: term("t9", 100, claude(200)), sessionId: "NEW" }]]);
  assert.equal(R.step(known, seen, 2).records.t9.sessionId, "NEW");
});

const saved = { t9: { address: "t9", space: "s1", tab: "tb1", cwd: "/w/app", argv: ["claude", "--dangerously-skip-permissions"], sessionId: "S1", shellPid: 100, savedAt: 1 } };

test("step: claude quit by the person (same shell, shell in front) is forgotten, not resumed", () => {
  const seen = new Map([["t9", { t: term("t9", 100), sessionId: null }]]);
  const { records, resume } = R.step(saved, seen, 2);
  same(resume, []);
  same(records, {});
});

test("step: a terminal lost and given a new shell (new pid, shell idle) is resumed", () => {
  const seen = new Map([["t9", { t: term("t9", 300), sessionId: null }]]);
  const { records, resume } = R.step(saved, seen, 2);
  same(resume, [{ address: "t9", pid: 300, line: "cd /w/app && claude --dangerously-skip-permissions --resume S1" }]);
  assert.ok(records.t9, "kept until the resume is sent");
});

const busy = (pid) => new Map([["t9", { t: term("t9", pid, { argv: ["git", "status"], cwd: "/w/app", name: "git", pid: pid + 1 }), sessionId: null }]]);

test("step: a new shell briefly running something (the prompt's git) still gets resumed", () => {
  const first = R.step(saved, busy(300), 1000);
  same(first.resume, []);
  assert.equal(first.records.t9.busySince, 1000);
  const later = R.step(first.records, new Map([["t9", { t: term("t9", 300), sessionId: null }]]), 11000);
  assert.equal(later.resume.length, 1);
});

test("step: a new shell running something else for over 30s is left alone and forgotten", () => {
  const first = R.step(saved, busy(300), 1000);
  assert.ok(R.step(first.records, busy(300), 1000 + R.BUSY_MS).records.t9, "kept up to the limit");
  same(R.step(first.records, busy(300), 1001 + R.BUSY_MS).records, {});
});

test("step: a terminal gone (not found or finished) is forgotten", () => {
  same(R.step(saved, new Map([["t9", { t: null, sessionId: null }]]), 2).records, {});
  const done = { ...term("t9", 300), state: "finished", foreground: null };
  same(R.step(saved, new Map([["t9", { t: done, sessionId: null }]]), 2).records, {});
});

test("step: a terminal that couldn't be asked about (core down) keeps its record", () => {
  same(R.step(saved, new Map([["t9", { t: undefined, sessionId: null }]]), 2).records, saved);
  same(R.step(saved, new Map(), 2).records, saved);
});

test("markResumed: the record takes the new shell, so a failed resume isn't retried forever", () => {
  const after = R.markResumed(saved, "t9", 300);
  assert.equal(after.t9.shellPid, 300);
  assert.equal(saved.t9.shellPid, 100, "not mutated");
  // Next look: claude didn't come up, same (new) shell idle -> treated as quit, forgotten.
  same(R.step(after, new Map([["t9", { t: term("t9", 300), sessionId: null }]]), 3).records, {});
});

test("parseRecords: bad or missing file gives no records", () => {
  same(R.parseRecords(null), {});
  same(R.parseRecords("{oops"), {});
  same(R.parseRecords('{"version":1,"terminals":{"t9":{"address":"t9"}}}'), { t9: { address: "t9" } });
});

test("recordsText: stable text for the file", () => {
  assert.equal(R.recordsText({ t9: { address: "t9" } }), '{\n  "version": 1,\n  "terminals": {\n    "t9": {\n      "address": "t9"\n    }\n  }\n}\n');
});
