// The full CI view's own tabs: Runs, run tabs and log tabs.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { load } = require("./load.cjs");
const { Tabs, MAX_TABS } = load(["views/tabs.js"]);

const ids = (tabs) => JSON.parse(JSON.stringify(tabs.list.map((t) => t.id))); // vm arrays are another realm

test("a new Tabs has Runs and MRs, Runs selected", () => {
  const tabs = new Tabs();
  assert.deepEqual(ids(tabs), ["runs", "mrs"]);
  assert.equal(tabs.selected, "runs");
  assert.equal(MAX_TABS, 8);
});

test("opening the same run twice keeps one tab and selects it", () => {
  const tabs = new Tabs();
  tabs.openRun({ id: "5", title: "Fix totals", number: 12, status: "running" });
  tabs.select("runs");
  const tab = tabs.openRun({ id: "5", title: "Fix totals", number: 12, status: "failed" });
  assert.deepEqual(ids(tabs), ["runs", "mrs", "run:5"]);
  assert.equal(tabs.selected, "run:5");
  assert.equal(tab.kind, "run");
  assert.equal(tab.runId, "5");
});

test("a log tab is keyed by run and job", () => {
  const tabs = new Tabs();
  const tab = tabs.openLog({ runId: "5", jobId: "77", name: "Build", status: "failed" });
  assert.equal(tab.id, "log:5:77");
  assert.equal(tab.kind, "log");
  assert.equal(tab.label, "Build");
  assert.equal(tabs.selected, "log:5:77");
  tabs.openLog({ runId: "5", jobId: "77", name: "Build" });
  assert.deepEqual(ids(tabs), ["runs", "mrs", "log:5:77"]);
});

test("Runs can't be closed", () => {
  const tabs = new Tabs();
  assert.equal(tabs.close("runs"), null);
  assert.deepEqual(ids(tabs), ["runs", "mrs"]);
});

test("closing the selected tab selects the one selected before it", () => {
  const tabs = new Tabs();
  tabs.openRun({ id: "1", title: "a", number: 1 });
  tabs.openLog({ runId: "1", jobId: "2", name: "b" });
  tabs.select("run:1");
  tabs.openLog({ runId: "1", jobId: "3", name: "c" });
  const closed = tabs.close("log:1:3");
  assert.equal(closed.id, "log:1:3");
  assert.equal(tabs.selected, "run:1");
  tabs.close("run:1");
  assert.equal(tabs.selected, "log:1:2");
  tabs.close("log:1:2");
  assert.equal(tabs.selected, "runs");
});

test("closing a tab that isn't selected keeps the selection", () => {
  const tabs = new Tabs();
  tabs.openRun({ id: "1", title: "a", number: 1 });
  tabs.openRun({ id: "2", title: "b", number: 2 });
  tabs.close("run:1");
  assert.equal(tabs.selected, "run:2");
});

test("a ninth tab evicts the least recently selected one, never Runs or the new tab", () => {
  const tabs = new Tabs();
  for (let i = 1; i <= 7; i++) tabs.openRun({ id: String(i), title: `r${i}`, number: i });
  tabs.select("run:1"); // run:2 is now least recently selected
  tabs.select("runs");
  const evicted = [];
  tabs.onEvict = (tab) => evicted.push(tab.id);
  tabs.openRun({ id: "8", title: "r8", number: 8 });
  assert.equal(tabs.list.length, MAX_TABS);
  assert.ok(!ids(tabs).includes("run:2"));
  assert.ok(ids(tabs).includes("runs"));
  assert.ok(ids(tabs).includes("run:8"));
  assert.deepEqual(evicted, ["run:2"]);
});

test("reset leaves Runs and MRs, Runs selected", () => {
  const tabs = new Tabs();
  tabs.openRun({ id: "1", title: "a", number: 1 });
  tabs.openLog({ runId: "1", jobId: "2", name: "b" });
  tabs.reset();
  assert.deepEqual(ids(tabs), ["runs", "mrs"]);
  assert.equal(tabs.selected, "runs");
});

test("setStatus updates a tab's status", () => {
  const tabs = new Tabs();
  tabs.openRun({ id: "1", title: "a", number: 1, status: "running" });
  tabs.setStatus("run:1", "success");
  assert.equal(tabs.list[2].status, "success");
  tabs.setStatus("nope", "failed"); // unknown ids are ignored
});

test("MRs can't be closed", () => {
  const tabs = new Tabs();
  assert.equal(tabs.close("mrs"), null);
  assert.deepEqual(ids(tabs), ["runs", "mrs"]);
});

test("openMr opens an item tab after the fixed ones; twice selects the same tab", () => {
  const tabs = new Tabs();
  const tab = tabs.openMr({ number: 7, title: "Fix totals" });
  assert.deepEqual(ids(tabs), ["runs", "mrs", "mr:7"]);
  assert.equal(tab.kind, "mr");
  assert.equal(tab.number, "7");
  tabs.select("runs");
  tabs.openMr({ number: 7, title: "Fix totals" });
  assert.deepEqual(ids(tabs), ["runs", "mrs", "mr:7"]);
  assert.equal(tabs.selected, "mr:7");
});

test("eviction never takes Runs or MRs, and MR tabs share the limit", () => {
  const tabs = new Tabs();
  const evicted = [];
  tabs.onEvict = (tab) => evicted.push(tab.id);
  for (let i = 1; i <= 7; i++) tabs.openMr({ number: i, title: `m${i}` });
  assert.equal(tabs.list.length, MAX_TABS);
  assert.deepEqual(evicted, ["mr:1"]);
  assert.ok(ids(tabs).includes("runs") && ids(tabs).includes("mrs"));
});
