// MR list logic (views/mrs.js) and MrList data flow (views/mr-list.js).
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { load } = require("./load.cjs");

const mr = (o) => ({ number: 1, title: "T", author: "al", source: "feat", target: "main", draft: false, state: "open",
  url: "", updatedAt: "2026-01-01T00:00:00Z", pipeline: null, approvals: 0, approvalsRequired: null, approvedBy: [],
  reviewers: [], assignees: [], unresolved: 0, headSha: "x", ...o });

function setup(extra = {}) {
  return load(["ci/poller.js", "forge/model.js", "views/runs.js", "views/mrs.js", "views/ui.js", "views/mr-list.js"], {
    InputState: { new: () => ({ on() {}, value: () => "", set_value() {} }) },
    ...extra,
  });
}

test("chips: approved reviewer drops out of review; author+reviewer is in both until approved", () => {
  const { chipOfMr } = setup();
  assert.deepEqual([...chipOfMr(mr({ reviewers: ["me"], approvedBy: ["me"] }), "me")], []);
  assert.deepEqual([...chipOfMr(mr({ reviewers: ["me"] }), "me")], ["review"]);
  assert.deepEqual([...chipOfMr(mr({ author: "me", reviewers: ["me"] }), "me")].sort(), ["mine", "review"]);
  assert.deepEqual([...chipOfMr(mr({ author: "me", reviewers: ["me"], approvedBy: ["me"] }), "me")], ["mine"]);
});

test("counts and filter by number, author, branch", () => {
  const { mrCounts, filterMrs } = setup();
  const list = [mr({ number: 412, author: "bo", source: "fix/x", reviewers: ["me"] }), mr({ number: 5, author: "me", source: "feat/y" }), mr({ number: 6, title: "Hello" })];
  assert.deepEqual(JSON.parse(JSON.stringify(mrCounts(list, "me"))), { review: 1, mine: 1, all: 3 });
  const f = (text, chip = "all") => filterMrs(list, { chip, text, me: "me" }).map((m) => m.number);
  assert.deepEqual(f("!412"), [412]);
  assert.deepEqual(f("#5"), [5]);
  assert.deepEqual(f("bo"), [412]);
  assert.deepEqual(f("feat/y"), [5]);
  assert.deepEqual(f("hello"), [6]);
  assert.deepEqual(f("", "review"), [412]);
  assert.deepEqual(f("", "mine"), [5]);
});

test("mrNumber", () => {
  const { mrNumber } = setup();
  assert.equal(mrNumber("gitlab", 4), "!4");
  assert.equal(mrNumber("github", 4), "#4");
});

function owner(listMrs) {
  return { provider: { listMrs }, repo: { kind: "gitlab" }, gen: 0, pollVisible: () => true };
}
const cxStub = () => { const p = []; return { notify() {}, spawn(fn) { const r = fn(this); p.push(r); return r; }, settle: async () => { while (p.length) await p.shift(); } }; };

test("MrList.load stores me/mrs, schedules the next poll, and tickDue gates on busy/time", async () => {
  const { MrList } = setup();
  const o = owner(async () => ({ me: "me", mrs: [mr({})] }));
  const l = new MrList(o), cx = cxStub();
  assert.equal(l.chip, "review");
  l.load(cx);
  assert.equal(l.busy, true);
  assert.equal(l.tickDue(Date.now() + 1e9), false);
  await cx.settle();
  assert.equal(l.me, "me");
  assert.equal(l.mrs.length, 1);
  assert.equal(l.loaded, true);
  assert.equal(l.busy, false);
  assert.equal(l.tickDue(Date.now()), false);
  assert.equal(l.tickDue(Date.now() + 31000), true);
});

test("MrList.load drops a result whose gen changed; errors back off", async () => {
  const { MrList } = setup();
  const o = owner(async () => { o.gen++; return { me: "me", mrs: [mr({})] }; });
  const l = new MrList(o), cx = cxStub();
  l.load(cx);
  await cx.settle();
  assert.equal(l.loaded, false);
  assert.equal(l.mrs.length, 0);
  assert.equal(l.busy, false);
  const o2 = owner(async () => { throw new Error("boom"); });
  const l2 = new MrList(o2);
  l2.load(cx);
  await cx.settle();
  assert.equal(l2.errors, 1);
  assert.equal(l2.error.message, "boom");
});
