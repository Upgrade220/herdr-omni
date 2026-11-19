// Where git-graph points, and where its Git tab is, from snapshots of herdr's live data.
// Pure: no herdr import, so tests pass snapshots. `snap` = { focused, panes, spaces }.
// A location is { cwd, on }: `on` is a machine name, or null for this machine.

export const MOD = "git-graph";
export const TAB_NAME = "Git";
export const MOD_ICON = `mods/${MOD}/icons/graph.svg`;
// shared: the last focused terminal's location, and the side tab ("changes" | "graph") in use.
export const LAST_LOC = "git-graph.last-loc";
export const VIEW_KEY = "git-graph.side-tab";

const loc = (cwd, on) => ({ cwd, on: on ?? null });

// The focused terminal's location, or null when the focus has no cwd of its own (a mod pane).
export function terminalLoc({ focused, panes, spaces }) {
  const f = focused;
  if (!f) return null;
  const pane = f.pane ? (panes ?? []).find((p) => p.pane === f.pane) : null;
  if (pane && !pane.terminal) return null;
  const cwd = pane?.cwd || (f.terminal ? f.cwd : null);
  if (!cwd) return null;
  const space = (spaces ?? []).find((s) => s.id === f.space);
  // A layout terminal block has no pane; its address names the machine ("vps/t3").
  const on = !f.pane && f.terminal?.includes("/") ? f.terminal.split("/")[0] : (space?.machine ?? null);
  return loc(cwd, on);
}

// What to write to shared LAST_LOC: the focused terminal's location when it differs from `last`, else null.
export function lastLocUpdate(last, snap) {
  const term = terminalLoc(snap);
  if (!term || (last?.cwd === term.cwd && (last?.on ?? null) === term.on)) return null;
  return term;
}

// A terminal in the focused tab, then in its space, then the space folder.
export function fallbackLoc({ focused, panes, spaces }) {
  const f = focused;
  if (!f) return null;
  const space = (spaces ?? []).find((s) => s.id === f.space);
  const tabs = new Set((space?.tabs ?? []).map((x) => x.id));
  const all = (panes ?? []).filter((p) => p.terminal && p.cwd);
  const other = all.find((p) => p.tab === f.tab) ?? all.find((p) => tabs.has(p.tab));
  if (other) return loc(other.cwd, space?.machine);
  return space?.folder ? loc(space.folder, space.machine) : null;
}

// The focused terminal, else the last one seen (shared LAST_LOC), else the fallback.
export function pickLoc(snap, last) {
  return terminalLoc(snap) ?? (last?.cwd ? loc(last.cwd, last.on) : null) ?? fallbackLoc(snap);
}

// The space's tabs holding only git-graph panes (a tab with a terminal beside it is not one), in tab order,
// without the ids in `exclude` (the Diff tabs, which hold a git-graph pane too).
export function gitTabs(panes, spaces, spaceId, exclude = []) {
  const byTab = new Map();
  for (const p of panes ?? []) {
    const e = byTab.get(p.tab) ?? { mod: 0, other: 0 };
    if (p.mod === MOD) e.mod++;
    else e.other++;
    byTab.set(p.tab, e);
  }
  const skip = new Set(exclude ?? []);
  const only = new Set([...byTab].filter(([id, e]) => e.mod > 0 && e.other === 0 && !skip.has(id)).map(([id]) => id));
  const tabs = (spaces ?? []).find((s) => s.id === spaceId)?.tabs ?? [];
  return tabs.map((t) => t.id).filter((id) => only.has(id));
}

// The id to hide to close the side panel: the side block's nearest ancestor (or the block itself)
// whose parent is a row, e.g. the right `panel` column holding a `panel-body` stack.
export function sidePanelId(tree) {
  const isSide = (n) => n?.type === "block" && n.content?.mod === MOD && n.content.props?.view !== "full";
  const find = (node, path) => {
    if (!node) return null;
    if (isSide(node)) return [...path, node];
    for (const c of Array.isArray(node.children) ? node.children : []) {
      const hit = find(c, [...path, node]);
      if (hit) return hit;
    }
    return null;
  };
  const path = find(tree, []);
  if (!path) return null;
  for (let i = path.length - 1; i > 0; i--) if (path[i - 1].type === "row") return path[i].id ?? null;
  return null;
}

// The mod-icons map with ours added, or null when it's already there (nothing to write).
export function withModIcon(map) {
  if (map?.[MOD] === MOD_ICON) return null;
  return { ...(map ?? {}), [MOD]: MOD_ICON };
}

// shared maps: spaceId -> Diff tab id, spaceId -> { target, at } to show, and the Diff view's layout / full-screen state.
export const DIFF_TABS = "git-graph.diff-tabs";
export const DIFF_OPEN = "git-graph.diff-open";
export const DIFF_LAYOUT = "git-graph.diff-layout";
export const DIFF_FULL = "git-graph.diff-full";
// shared: repo root -> when the Graph's status read last found its changed files different. The Diff tab
// re-reads a working-tree diff past it (a remote space has no folder watch of its own).
export const WORKTREE = "git-graph.worktree";

// The space's recorded Diff tab, only while it is still among the space's tabs.
export function diffTabOf(map, spaces, spaceId) {
  const id = map?.[spaceId];
  if (!id) return null;
  const tabs = (spaces ?? []).find((s) => s.id === spaceId)?.tabs ?? [];
  return tabs.some((t) => t.id === id) ? id : null;
}

// A tab.new waits this long for its Diff tab to show up; clicks meanwhile only change the target.
export const PENDING_MS = 2000;
// A Diff copy started this soon after a tab.new is that tab's (CLAIM_MS: a slow start still counts).
export const CLAIM_MS = 5000;

const tabIds = (spaces, spaceId) => ((spaces ?? []).find((s) => s.id === spaceId)?.tabs ?? []).map((t) => t.id);

// How to show `target`: select the live Diff tab; else, while a tab.new asked for one is still on its
// way (`open`'s pendingTab, under PENDING_MS old), just hand over the new target; else ask for a new tab
// named after the file, noting the space's tabs before it (`before`) so the new copy can find its own.
// `open` is the current hand-off map; the result's `open` is this space's new entry.
export function openDiffPlan({ map, open, spaces, spaceId, target, now }) {
  const select = diffTabOf(map, spaces, spaceId);
  if (select) return { select, newTab: null, open: { [spaceId]: { target, at: now } } };
  const pending = open?.[spaceId]?.pendingTab;
  if (pending && now - pending.at < PENDING_MS) return { select: null, newTab: null, open: { [spaceId]: { target, at: now, pendingTab: pending } } };
  const name = String(target?.path ?? "").split("/").pop();
  return { select: null, newTab: { name }, open: { [spaceId]: { target, at: now, pendingTab: { at: now, before: tabIds(spaces, spaceId) } } } };
}

// The DIFF_TABS map with `ownTab` recorded for the space, or null when nothing changes: it is already
// there, or another Diff tab of the space is recorded and still live (that one keeps the space).
export function registerDiffTab(map, spaces, spaceId, ownTab) {
  const live = diffTabOf(map, spaces, spaceId);
  if (live) return null;
  return { ...(map ?? {}), [spaceId]: ownTab };
}

// Which tab a Diff copy that hasn't found its own yet sits in, or null (try again later).
// A fresh copy (born within CLAIM_MS after a space's pendingTab) takes the one tab of that space that
// is not in `before` and holds only git-graph panes, and nothing when that is ambiguous. A restored
// copy (no fresh entry) takes the focused tab when it holds only git-graph panes and is neither the
// Git tab nor in `taken` (Diff tabs recorded by other copies): only an on-screen copy is focused.
export function claimTab({ spaces, panes, open, born, focused, taken = [] }) {
  const fresh = Object.entries(open ?? {}).filter(([, e]) => {
    const at = e?.pendingTab?.at;
    return typeof at === "number" && born >= at && born - at <= CLAIM_MS;
  });
  if (fresh.length) {
    const found = fresh.flatMap(([spaceId, e]) => {
      const before = new Set(e.pendingTab.before ?? []);
      return gitTabs(panes, spaces, spaceId).filter((id) => !before.has(id));
    });
    return found.length === 1 ? found[0] : null;
  }
  if (!focused?.tab) return null;
  const tab = ((spaces ?? []).find((s) => s.id === focused.space)?.tabs ?? []).find((t) => t.id === focused.tab);
  if (!tab || tab.name === TAB_NAME) return null;
  return gitTabs(panes, spaces, focused.space, taken).includes(focused.tab) ? focused.tab : null;
}

// The space's hand-off entry when it is newer than `seenAt`.
export function pendingTarget(openMap, spaceId, seenAt) {
  const e = openMap?.[spaceId];
  return e && e.at > (seenAt ?? 0) ? e : null;
}
