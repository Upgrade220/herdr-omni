const { test } = require("node:test");
const assert = require("node:assert/strict");
const { load } = require("./load.cjs");
const { filterRuns, chipCounts, ago, dur, anyLive, size } = load(["forge/model.js", "views/runs.js"]);

const run = (number, status, extra = {}) => ({
  id: String(number), number, title: `Run ${number}`, branch: "main", status, trigger: "push", author: "dev", ...extra,
});
const runs = [
  run(42, "running", { title: "Fix cart" }),
  run(142, "success", { title: "Bump deps" }),
  run(7, "pending", { branch: "feat/x" }),
  run(8, "failed", { author: "sam" }),
  run(9, "canceled"),
  run(10, "manual", { title: "Deploy #42 notes" }),
];
const numbers = (list) => list.map((r) => r.number);

test("query #42 matches number 42 only", () => {
  assert.deepEqual(numbers(filterRuns(runs, { query: "#42", chip: "all" })), [42]);
});

test("query matches title, branch and author, case-insensitive", () => {
  assert.deepEqual(numbers(filterRuns(runs, { query: "fix CART", chip: "all" })), [42]);
  assert.deepEqual(numbers(filterRuns(runs, { query: "feat/", chip: "all" })), [7]);
  assert.deepEqual(numbers(filterRuns(runs, { query: "sam", chip: "all" })), [8]);
});

test("empty query and chip all keep every run", () => {
  assert.equal(filterRuns(runs, { query: "  ", chip: "all" }).length, runs.length);
  assert.equal(filterRuns(runs, {}).length, runs.length);
});

test("chip running includes pending", () => {
  assert.deepEqual(numbers(filterRuns(runs, { query: "", chip: "running" })), [42, 7]);
  assert.deepEqual(numbers(filterRuns(runs, { chip: "other" })), [9, 10]);
});

test("query and chip combine", () => {
  assert.deepEqual(numbers(filterRuns(runs, { query: "main", chip: "passed" })), [142]);
});

test("chipCounts sum to all", () => {
  const c = chipCounts(runs);
  assert.deepEqual({ ...c }, { all: 6, running: 2, failed: 1, passed: 1, other: 2 });
  assert.equal(c.running + c.failed + c.passed + c.other, c.all);
  assert.deepEqual({ ...chipCounts([]) }, { all: 0, running: 0, failed: 0, passed: 0, other: 0 });
});

test("anyLive is true for running or pending runs", () => {
  assert.equal(anyLive(runs), true);
  assert.equal(anyLive([run(1, "success"), run(2, "manual")]), false);
});

test("ago and dur format times", () => {
  const now = Date.parse("2026-01-01T12:00:00Z");
  assert.equal(ago("2026-01-01T11:59:30Z", now), "just now");
  assert.equal(ago("2026-01-01T11:00:00Z", now), "1h ago");
  assert.equal(ago("", now), "");
  assert.equal(dur(null), "");
  assert.equal(dur(42), "42s");
  assert.equal(dur(130), "2m 10s");
  assert.equal(dur(3725), "1h 2m");
});

test("size formats bytes", () => {
  assert.equal(size(512), "512 B");
  assert.equal(size(1536), "1.5 KB");
  assert.equal(size(20 * 1024 * 1024), "20 MB");
});
