const { test } = require("node:test");
const assert = require("node:assert/strict");
const { load } = require("./load.cjs");
const { nextDelay } = load(["ci/poller.js"]);
const { ForgeError } = load(["forge/cli.js"]);
const W = load(["ci/watch.js"]);
const { Watches, watchKey, claimOwner, watchTick } = W;

const mem = (init) => {
  let v = init;
  return { get: () => v, set: (x) => { v = x; }, peek: () => v };
};
const id = { kind: "github", host: "github.com", path: "o/r", runId: "7" };
const plain = (x) => JSON.parse(JSON.stringify(x));
const run = (status, extra = {}) => ({ number: 12, title: "Fix it", status, ...extra });

test("nextDelay base values", () => {
  assert.equal(nextDelay({ visible: true, anyRunning: true, errors: 0 }), 5000);
  assert.equal(nextDelay({ visible: true, anyRunning: false, errors: 0 }), 30000);
  assert.equal(nextDelay({ visible: false, anyRunning: true, errors: 0 }), 30000);
});

test("nextDelay backs off x2 per error, capped", () => {
  assert.equal(nextDelay({ visible: true, anyRunning: false, errors: 3 }), 240000);
  assert.equal(nextDelay({ visible: true, anyRunning: false, errors: 4 }), 300000);
  assert.equal(nextDelay({ visible: true, anyRunning: true, errors: 20 }), 300000);
});

test("watchKey is JSON of the tuple", () => {
  assert.equal(watchKey(id), '["github","github.com","o/r","7"]');
});

test("update finishes exactly once on running -> success, null while running", () => {
  const w = new Watches(mem({}));
  const k = watchKey(id);
  w.add(k, run("running"));
  assert.equal(w.update(k, run("running")), null);
  assert.equal(w.update(k, run("success")), "finished");
  assert.equal(w.update(k, run("success")), null);
  assert.deepEqual(plain(w.keys()), []);
});

test("keys returns parsed identities", () => {
  const w = new Watches(mem({}));
  w.add(watchKey(id), run("running"));
  assert.deepEqual(plain(w.keys()), [id]);
});

test("manual stays watched, dropped after 24h", () => {
  const w = new Watches(mem({}));
  const k = watchKey(id);
  w.add(k, run("running"), 0);
  assert.equal(w.update(k, run("manual"), 1000), null);
  assert.equal(w.keys().length, 1);
  assert.equal(w.update(k, run("manual"), 1000 + 24 * 3600 * 1000), null);
  assert.equal(w.keys().length, 1);
  assert.equal(w.update(k, run("manual"), 1000 + 24 * 3600 * 1000 + 1), null);
  assert.equal(w.keys().length, 0);
});

test("manual then success still finishes", () => {
  const w = new Watches(mem({}));
  const k = watchKey(id);
  w.add(k, run("manual"), 0);
  assert.equal(w.update(k, run("success"), 5), "finished");
});

test("claimOwner: claims, refreshes, respects live and stale owners", () => {
  const s = mem(undefined);
  assert.equal(claimOwner({ ...s, now: () => 1000, id: "a" }), true);
  assert.equal(claimOwner({ ...s, now: () => 2000, id: "b" }), false);
  assert.equal(claimOwner({ ...s, now: () => 3000, id: "a" }), true);
  assert.equal(s.peek().ts, 3000);
  assert.equal(claimOwner({ ...s, now: () => 3000 + 90001, id: "b" }), true);
  assert.equal(s.peek().id, "b");
});

function setup(detail) {
  const watches = new Watches(mem({}));
  const k = watchKey(id);
  watches.add(k, run("running"));
  const notes = [];
  const providerFor = (key) => {
    assert.deepEqual(plain(key), id);
    return { runDetail: async (rid) => { assert.equal(rid, "7"); return detail(); } };
  };
  return { watches, k, notes, args: { watches, providerFor, notify: (n) => notes.push(n), now: () => 0 } };
}

test("tick notifies once on finish with the brief's shape", async () => {
  const t = setup(async () => ({ run: run("failed") }));
  const r = await watchTick(t.args);
  assert.equal(r.errors, 0);
  assert.deepEqual(plain(t.notes), [{
    title: "o/r #12 failed", body: "Fix it", level: "error",
    action: { name: "tab.new", args: { name: "CI", mod: "omni-forge", props: { view: "full", open: t.k } } },
  }]);
  await watchTick(t.args);
  assert.equal(t.notes.length, 1);
});

test("tick levels: passed info, canceled error", async () => {
  let s = "success";
  const t = setup(async () => ({ run: run(s) }));
  await watchTick(t.args);
  assert.equal(t.notes[0].title, "o/r #12 passed");
  assert.equal(t.notes[0].level, "info");
  const t2 = setup(async () => ({ run: run("canceled") }));
  await watchTick(t2.args);
  assert.equal(t2.notes[0].title, "o/r #12 canceled");
  assert.equal(t2.notes[0].level, "error");
});

test("tick: still running keeps watch, no notify", async () => {
  const t = setup(async () => ({ run: run("running") }));
  assert.deepEqual(plain(await watchTick(t.args)), { errors: 0 });
  assert.equal(t.notes.length, 0);
  assert.equal(t.watches.keys().length, 1);
});

test("tick: 404 drops without notify, not an error", async () => {
  const t = setup(async () => { throw new ForgeError("nf", 404); });
  assert.deepEqual(plain(await watchTick(t.args)), { errors: 0 });
  assert.equal(t.notes.length, 0);
  assert.equal(t.watches.keys().length, 0);
});

test("tick: non-404 error keeps watch and counts", async () => {
  const t = setup(async () => { throw new ForgeError("boom", 500); });
  assert.deepEqual(plain(await watchTick(t.args)), { errors: 1 });
  assert.equal(t.notes.length, 0);
  assert.equal(t.watches.keys().length, 1);
});

// A list fetch that began before the finish can re-add the run as running; it must not notify twice.
test("finish leaves a tombstone: a stale add after finish does not notify again", async () => {
  const t = setup(async () => ({ run: run("success") }));
  await watchTick(t.args);
  assert.equal(t.notes.length, 1);
  t.watches.add(t.k, run("running"), 0); // same clock as the tick (now: () => 0)
  assert.deepEqual(plain(t.watches.keys()), []);
  await watchTick(t.args);
  assert.equal(t.notes.length, 1);
});

test("tombstones are pruned after 6h, then the key can be watched again", async () => {
  const store = mem({});
  const w = new Watches(store);
  const k = watchKey(id);
  w.add(k, run("running"), 0);
  assert.equal(w.update(k, run("success"), 1000), "finished");
  assert.ok(k in store.peek());
  w.add(k, run("running"), 1000 + 6 * 3600 * 1000);
  assert.deepEqual(plain(w.keys()), []);
  await watchTick({ watches: w, providerFor: () => { throw new Error("not polled"); }, notify: () => {}, now: () => 1000 + 6 * 3600 * 1000 + 1 });
  assert.equal(k in store.peek(), false);
  w.add(k, run("running"), 1000 + 6 * 3600 * 1000 + 2);
  assert.equal(w.keys().length, 1);
});

test("tick notifies before marking done, and marks done even if notify throws", async () => {
  const t = setup(async () => ({ run: run("failed") }));
  let liveAtNotify = null;
  t.args.notify = (n) => { liveAtNotify = t.watches.keys().length; t.notes.push(n); throw new Error("toast failed"); };
  await watchTick(t.args);
  assert.equal(liveAtNotify, 1);
  assert.equal(t.notes.length, 1);
  assert.deepEqual(plain(t.watches.keys()), []);
  await watchTick(t.args);
  assert.equal(t.notes.length, 1);
});
