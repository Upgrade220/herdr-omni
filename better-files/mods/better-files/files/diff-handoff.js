// Show diff's hand-off to git-graph's Diff tab. Pure: no herdr import, so node can test it.
// The keys and the opening decision are git-graph's (its place.js, openDiffPlan); a mod can't
// import another mod's code, so this is a copy, and tests/diff-handoff.test.cjs checks the two agree.

// shared: spaceId -> the space's Diff tab id, and spaceId -> { target, at, pendingTab? } to show.
export const DIFF_TABS = "git-graph.diff-tabs";
export const DIFF_OPEN = "git-graph.diff-open";
// A tab.new waits this long for its Diff tab to show up; clicks meanwhile only change the target.
export const PENDING_MS = 2000;

const tabsOf = (spaces, spaceId) => (spaces ?? []).find((s) => s.id === spaceId)?.tabs ?? [];

// The space's recorded Diff tab, only while it is still among the space's tabs.
function liveDiffTab(map, spaces, spaceId) {
  const id = map?.[spaceId];
  return id && tabsOf(spaces, spaceId).some((t) => t.id === id) ? id : null;
}

// Where a diff of a file looks: an untracked file is read whole, a change only in the index is
// staged, and anything else is in the working tree.
export function diffSource(change) {
  if (change?.untracked) return "untracked";
  if (change?.staged) return "staged";
  return "unstaged";
}

// A menu target (see targetOf) as the Diff tab's target, or null outside a Git repo. The Diff
// tab knows a file by its path from the Git root (`top`, from git rev-parse --show-toplevel).
export function diffTarget(target) {
  if (!target?.top || !target.relative) return null;
  return { root: target.top, on: target.on ?? null, path: target.relative, source: diffSource(target) };
}

// How to show `target`: select the live Diff tab; else, while a tab.new asked for one is still on
// its way (`open`'s pendingTab, under PENDING_MS old), just hand over the new target; else ask for a
// new tab named after the file, noting the space's tabs before it (`before`) so the new copy can find
// its own. The result's `open` is this space's new entry for DIFF_OPEN.
export function diffPlan({ map, open, spaces, spaceId, target, now }) {
  const select = liveDiffTab(map, spaces, spaceId);
  if (select) return { select, newTab: null, open: { [spaceId]: { target, at: now } } };
  const pending = open?.[spaceId]?.pendingTab;
  if (pending && now - pending.at < PENDING_MS)
    return { select: null, newTab: null, open: { [spaceId]: { target, at: now, pendingTab: pending } } };
  const name = String(target?.path ?? "").split("/").pop();
  const before = tabsOf(spaces, spaceId).map((t) => t.id);
  return { select: null, newTab: { name }, open: { [spaceId]: { target, at: now, pendingTab: { at: now, before } } } };
}
