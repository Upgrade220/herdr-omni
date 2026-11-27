// Shows an MR's changed file in git-graph's Diff tab. The keys and the opening decision are git-graph's
// (its place.js: DIFF_TABS, DIFF_OPEN, PENDING_MS, diffTabOf, openDiffPlan); a mod can't import another
// mod's code, so this is a copy, and tests/diff-handoff.test.cjs checks the two agree.
// openMrFile fetches the MR's refs into the cache repo (forge/mr-cache.js), then hands a `range` target over.
import { exec, appHome, focused, spaces, shared, setShared, run } from "herdr";
import { ensureMr, cacheDir, MR_REFS } from "../forge/mr-cache.js";
import { mrNumber } from "../views/mrs.js";

// shared: spaceId -> the space's Diff tab id, and spaceId -> { target, at, pendingTab? } to show.
export const DIFF_TABS = "git-graph.diff-tabs";
export const DIFF_OPEN = "git-graph.diff-open";
// A tab.new waits this long for its Diff tab to show up; clicks meanwhile only change the target.
export const PENDING_MS = 2000;
const DIFF_MOD = "git-graph";

const tabIds = (spaceList, spaceId) => ((spaceList ?? []).find((s) => s.id === spaceId)?.tabs ?? []).map((t) => t.id);

// The space's recorded Diff tab, only while it is still among the space's tabs.
export function diffTabOf(map, spaceList, spaceId) {
  const id = map?.[spaceId];
  if (!id) return null;
  return tabIds(spaceList, spaceId).includes(id) ? id : null;
}

// How to show `target`: select the live Diff tab; else, while a tab.new asked for one is still on its
// way, just hand over the new target; else ask for a new tab named after the file. The result's `open`
// is this space's new entry for DIFF_OPEN.
export function openDiffPlan({ map, open, spaces: spaceList, spaceId, target, now }) {
  const select = diffTabOf(map, spaceList, spaceId);
  if (select) return { select, newTab: null, open: { [spaceId]: { target, at: now } } };
  const pending = open?.[spaceId]?.pendingTab;
  if (pending && now - pending.at < PENDING_MS) return { select: null, newTab: null, open: { [spaceId]: { target, at: now, pendingTab: pending } } };
  const name = String(target?.path ?? "").split("/").pop();
  return { select: null, newTab: { name }, open: { [spaceId]: { target, at: now, pendingTab: { at: now, before: tabIds(spaceList, spaceId) } } } };
}

// ---- MR files ------------------------------------------------------------------

const homes = new Map(); // machine -> that machine's $HOME
const inflight = new Map(); // cache dir -> the last ensureMr started on it

async function homeOf(machine) {
  if (!machine) return appHome();
  if (homes.has(machine)) return homes.get(machine);
  const res = await exec("sh", ["-c", 'printf %s "$HOME"'], { on: machine });
  const home = (res.stdout ?? "").trim();
  if (res.code !== 0 || !home) throw new Error(`Cannot read $HOME on ${machine}`);
  homes.set(machine, home);
  return home;
}

// ensureMr is unguarded against itself: one at a time per cache dir.
function ensureSerial(dir, opts) {
  const make = async () => {
    try { return await ensureMr(exec, opts); } catch (e) { return { ok: false, error: String(e?.message ?? e) }; }
  };
  const next = (inflight.get(dir) ?? Promise.resolve()).then(make);
  inflight.set(dir, next);
  next.then(() => { if (inflight.get(dir) === next) inflight.delete(dir); });
  return next;
}

// The MR cache repo's folder for this repo on `machine` (null: this computer).
export async function mrCacheDir({ repo, machine }) {
  const home = await homeOf(machine);
  return cacheDir({ local: !machine, appHome: machine ? "" : home, home, host: repo.host, path: repo.path });
}

const text = (res) => (res.stderr || res.stdout || `exit ${res.code}`).trim();

// The Diff tab's target for one MR file, as the `range` source reads it.
export function mrFileTarget({ root, on, path, dir, refs, kind, number }) {
  return { root, on: on ?? null, path, source: "range", gitDir: dir, base: refs.base, head: refs.head, label: `${mrNumber(kind, number)} · ${path}` };
}

// Called from click handlers only. -> { ok: true } | { ok: false, error }; DIFF_OPEN is touched only on ok.
export async function openMrFile({ repo, loc, mr, path }) {
  try {
    const on = loc?.machine ?? undefined;
    if (!loc?.cwd) return { ok: false, error: "No folder to read the repository from. Focus a terminal in it first." };
    const top = await exec("git", ["-C", loc.cwd, "rev-parse", "--show-toplevel"], { on });
    if (top.code !== 0) return { ok: false, error: text(top) };
    const root = top.stdout.trim();
    let url = repo.url;
    if (!url) {
      const remote = await exec("git", ["-C", root, "remote", "get-url", "origin"], { on });
      if (remote.code !== 0 || !remote.stdout.trim()) return { ok: false, error: text(remote) };
      url = remote.stdout.trim();
    }
    const dir = await mrCacheDir({ repo, machine: loc.machine });
    const res = await ensureSerial(dir, { on, repoRoot: root, dir, url, kind: repo.kind, number: mr.number, target: mr.target });
    if (!res.ok) return { ok: false, error: res.error };
    const spaceId = focused()?.space;
    if (!spaceId) return { ok: false, error: "No space to show the diff in." };
    const target = mrFileTarget({ root, on: loc.machine, path, dir, refs: res.refs ?? MR_REFS(mr.number), kind: repo.kind, number: mr.number });
    const open = shared(DIFF_OPEN) ?? {};
    const plan = openDiffPlan({ map: shared(DIFF_TABS), open, spaces: spaces(), spaceId, target, now: Date.now() });
    setShared(DIFF_OPEN, { ...open, ...plan.open });
    if (plan.select) run("tab.select", { id: plan.select });
    else if (plan.newTab) run("tab.new", { name: plan.newTab.name, mod: DIFF_MOD, props: { view: "diff", target } });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e?.message ?? e) };
  }
}
