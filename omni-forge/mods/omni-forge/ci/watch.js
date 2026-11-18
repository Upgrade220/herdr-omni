// Watched runs: shared-state bookkeeping, owner election and the poll tick. Pure: no herdr import.
// `get`/`set` wrap shared("omni-forge.watches") and shared("omni-forge.watch-owner"); the views inject them.

const OWNER_STALE_MS = 90000;
const MANUAL_MAX_MS = 24 * 3600 * 1000;
const TOMBSTONE_MS = 6 * 3600 * 1000;
const TERMINAL = new Set(["success", "failed", "canceled"]);
const WORDS = { success: "passed", failed: "failed", canceled: "canceled" };

export const watchKey = ({ kind, host, path, runId }) => JSON.stringify([kind, host, path, String(runId)]);

// Watches are stored as { [key]: { number, title, status, manualSince } } plain data.
// A finished run stays as a tombstone { done: ts } for 6h, so a list fetch that started before the
// finish (and still shows the run as running) cannot re-add it and notify a second time.
const isDone = (e) => e != null && e.done != null;
export class Watches {
  constructor({ get, set }) {
    this.get = get;
    this.set = set;
  }
  _all() {
    return { ...(this.get() ?? {}) };
  }
  // Drops tombstones older than 6h.
  prune(now = Date.now()) {
    const all = this._all();
    let changed = false;
    for (const [k, e] of Object.entries(all)) {
      if (isDone(e) && now - e.done > TOMBSTONE_MS) { delete all[k]; changed = true; }
    }
    if (changed) this.set(all);
  }
  add(key, run, now = Date.now()) {
    this.prune(now);
    const all = this._all();
    if (all[key]) return; // watched already, or finished (tombstone)
    all[key] = { number: run?.number ?? null, title: run?.title ?? "", status: run?.status ?? "running", manualSince: run?.status === "manual" ? now : null };
    this.set(all);
  }
  keys() {
    return Object.entries(this._all()).filter(([, e]) => !isDone(e)).map(([k]) => {
      const [kind, host, path, runId] = JSON.parse(k);
      return { kind, host, path, runId };
    });
  }
  has(key) {
    const e = this._all()[key];
    return e != null && !isDone(e);
  }
  entry(key) {
    const e = this._all()[key];
    return e != null && !isDone(e) ? e : null;
  }
  drop(key) {
    const all = this._all();
    if (!(key in all)) return;
    delete all[key];
    this.set(all);
  }
  // Returns "finished" once on a terminal status (and leaves a tombstone), else null.
  update(key, run, now = Date.now()) {
    const all = this._all();
    const cur = all[key];
    if (!cur || isDone(cur)) return null;
    if (TERMINAL.has(run.status)) {
      all[key] = { done: now };
      this.set(all);
      return "finished";
    }
    // skipped/other can never become terminal here: stop watching without notifying.
    if (run.status !== "running" && run.status !== "pending" && run.status !== "manual") {
      this.drop(key);
      return null;
    }
    const manualSince = run.status === "manual" ? (cur.manualSince ?? now) : null;
    if (manualSince !== null && now - manualSince > MANUAL_MAX_MS) {
      this.drop(key);
      return null;
    }
    all[key] = { number: run.number ?? cur.number, title: run.title ?? cur.title, status: run.status, manualSince };
    this.set(all);
    return null;
  }
}

// True when this copy owns polling. The owner refreshes its claim on every call (every tick);
// another copy takes over once the claim is older than 90s.
export function claimOwner({ get, set, now, id }) {
  const t = now();
  const cur = get();
  if (cur && cur.id !== id && t - cur.ts <= OWNER_STALE_MS) return false;
  set({ id, ts: t });
  const after = get();
  return !after || after.id === id;
}

// Polls every watch once. Finished runs notify, then become tombstones; 404 drops silently;
// other errors keep the watch. Returns the number of failed polls so callers can back off.
export async function watchTick({ watches, providerFor, notify, now }) {
  let errors = 0;
  watches.prune(now());
  for (const id of watches.keys()) {
    const key = watchKey(id);
    try {
      const { run } = await providerFor(id).runDetail(id.runId);
      const before = watches.entry(key);
      if (!before) continue;
      if (!TERMINAL.has(run.status)) {
        watches.update(key, run, now());
        continue;
      }
      // Notify first, then mark done whatever notify does, so the run never notifies twice.
      try {
        notify({
          title: `${id.path} #${run.number ?? before.number} ${WORDS[run.status]}`,
          body: run.title ?? before.title ?? "",
          level: run.status === "success" ? "info" : "error",
          action: { name: "tab.new", args: { name: "CI", mod: "omni-forge", props: { view: "full", open: key } } },
        });
      } finally {
        watches.update(key, run, now());
      }
    } catch (e) {
      if (e?.status === 404) watches.drop(key);
      else errors++;
    }
  }
  return { errors };
}
