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

// The space's tabs holding only git-graph panes (a tab with a terminal beside it is not one), in tab order.
export function gitTabs(panes, spaces, spaceId) {
  const byTab = new Map();
  for (const p of panes ?? []) {
    const e = byTab.get(p.tab) ?? { mod: 0, other: 0 };
    if (p.mod === MOD) e.mod++;
    else e.other++;
    byTab.set(p.tab, e);
  }
  const only = new Set([...byTab].filter(([, e]) => e.mod > 0 && e.other === 0).map(([id]) => id));
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
