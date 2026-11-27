// Where a CI view points, from snapshots of herdr's live data. Pure: no herdr import, so tests
// pass snapshots. `snap` = { focused: focused(), panes: panes(), spaces: spaces() }.
//
// Source order (full view): props.open's repo, then shared("omni-forge.last-loc") (the last focused
// terminal, recorded by every copy), then the focused terminal, then a terminal in the focused tab
// or space. Once a location is set, only a focused terminal with a new cwd moves it. A full tab
// counts only terminals of its own space (nextLoc's `space`).

export const MOD = "omni-forge";
export const LAST_LOC = "omni-forge.last-loc";
// { tab, key }: a run the side view asks the full tab `tab` (just selected) to open; that tab's
// full copy takes it in its tick (mayTakeOpen).
export const OPEN = "omni-forge.open";

// props.open is a watch key, JSON [kind, host, path, runId], or an MR key (mrKey) with mr: n and,
// optionally, the folder (and machine) the sender knows the repository at.
export function parseOpen(value) {
  try {
    const v = JSON.parse(value);
    if (v && !Array.isArray(v) && typeof v === "object") {
      if (!(v.kind && v.host && v.path && v.mr != null)) return null;
      const open = { kind: v.kind, host: v.host, path: v.path, mr: String(v.mr) };
      if (typeof v.cwd === "string" && v.cwd) { open.cwd = v.cwd; open.machine = typeof v.machine === "string" && v.machine ? v.machine : null; }
      return open;
    }
    const [kind, host, path, runId] = v;
    return kind && host && path && runId != null ? { kind, host, path, runId: String(runId) } : null;
  } catch {
    return null;
  }
}

const locOf = (cwd, machine, branch) => ({ key: `${machine ?? ""}|${cwd}`, cwd, machine: machine ?? null, branch: branch ?? null });

// Tabs that hold only omni-forge panes (a full tab, maybe with a log split beside it).
export function fullTabs(panes) {
  const byTab = new Map();
  for (const p of panes ?? []) {
    const e = byTab.get(p.tab) ?? { mod: 0, other: 0 };
    if (p.mod === MOD) e.mod++;
    else e.other++;
    byTab.set(p.tab, e);
  }
  return [...byTab].filter(([, e]) => e.mod > 0 && e.other === 0).map(([id]) => id);
}

// The full tabs of one space (the side view opens runs in the first of them), in tab order.
export function spaceFullTabs(panes, spaces, spaceId) {
  const tabs = (spaces ?? []).find((s) => s.id === spaceId)?.tabs ?? [];
  const full = new Set(fullTabs(panes));
  return tabs.map((t) => t.id).filter((id) => full.has(id));
}

// Full is visible when the focused tab is its own tab (`ownTab`, once known: see full.js). Before
// that, panes() carries no props, so with several full tabs any of them counts; with none found,
// the window being active decides.
export function isVisible({ focused, panes, windowActive, ownTab = null }) {
  if (ownTab) return Boolean(focused) && focused.tab === ownTab;
  const tabs = fullTabs(panes);
  if (tabs.length === 0) return Boolean(windowActive);
  return Boolean(focused) && tabs.includes(focused.tab);
}

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
  const machine = !f.pane && f.terminal?.includes("/") ? f.terminal.split("/")[0] : (space?.machine ?? null);
  const branch = pane?.branch ?? (panes ?? []).find((p) => p.cwd === cwd && p.branch)?.branch ?? null;
  return locOf(cwd, machine, branch);
}

// Only for the very first location: a terminal in the focused tab, then in its space, then the space folder.
export function fallbackLoc({ focused, panes, spaces }) {
  const f = focused;
  if (!f) return null;
  const space = (spaces ?? []).find((s) => s.id === f.space);
  const tabs = new Set((space?.tabs ?? []).map((x) => x.id));
  const all = (panes ?? []).filter((p) => p.terminal && p.cwd);
  const other = all.find((p) => p.tab === f.tab) ?? all.find((p) => tabs.has(p.tab));
  if (other) return locOf(other.cwd, space?.machine, other.branch);
  return space?.folder ? locOf(space.folder, space.machine, null) : null;
}

// One step of following. `state` = { loc, seenTerm, lastLoc, space }: the current location (null at
// first), the key of the terminal last seen focused, shared last-loc, and the space the view belongs
// to (a full tab's; null for a view of no space, which follows every terminal). With a space, only
// terminals of that space count: focus in another space neither moves the view nor seeds it, and
// last-loc seeds it only when a terminal of the space is there. Returns
// { move: loc | null (detect there), branch: string | null (the branch now, when at loc), seenTerm }.
export function nextLoc({ loc, seenTerm, lastLoc, space = null }, snap) {
  const elsewhere = Boolean(space) && snap.focused?.space !== space;
  const term = elsewhere ? null : terminalLoc(snap);
  const seen = term?.key ?? seenTerm ?? null;
  if (!loc) {
    const last = lastLoc?.cwd && (!space || inSpace(lastLoc, space, snap)) ? locOf(lastLoc.cwd, lastLoc.machine, lastLoc.branch) : null;
    const own = elsewhere ? { ...snap, focused: { space, tab: null } } : snap;
    const first = last ?? term ?? fallbackLoc(own);
    return { move: first, branch: first?.branch ?? null, seenTerm: seen };
  }
  if (term && term.key !== seenTerm && term.key !== loc.key) return { move: term, branch: term.branch, seenTerm: seen };
  const branch = term && term.key === loc.key ? term.branch : null;
  return { move: null, branch, seenTerm: seen };
}

// Whether a terminal of `space` sits at `where`'s folder.
function inSpace(where, space, { panes, spaces }) {
  const tabs = new Set(((spaces ?? []).find((s) => s.id === space)?.tabs ?? []).map((t) => t.id));
  return (panes ?? []).some((p) => p.terminal && p.cwd === where.cwd && tabs.has(p.tab));
}

// The space a full tab belongs to: its own tab's (`ownTab`, else the only full tab there is).
// undefined while that can't be told (several full tabs, own one not seen yet): don't follow then.
// null when there is no full tab at all.
export function fullTabSpace(ownTab, { panes, spaces }) {
  const tabs = fullTabs(panes);
  const tab = ownTab ?? (tabs.length === 1 ? tabs[0] : null);
  if (!tab) return tabs.length ? undefined : null;
  return (spaces ?? []).find((s) => (s.tabs ?? []).some((t) => t.id === tab))?.id ?? null;
}

// The value to record in shared last-loc, or null when it shouldn't change.
export function lastLocUpdate(current, snap) {
  const term = terminalLoc(snap);
  if (!term) return null;
  const next = { cwd: term.cwd, machine: term.machine, branch: term.branch };
  const same = current && current.cwd === next.cwd && (current.machine ?? null) === next.machine && (current.branch ?? null) === next.branch;
  return same ? null : next;
}

// Whether the layout shows an omni-forge side block (content.mod omni-forge, props.view "side" or
// unset): neither it nor an ancestor is `hidden`, and every stack on the way has it on its active
// child (`active`, else the first child). `tree` is layout().
export function sideVisible(tree, view = "side") {
  const isSide = (n) => n?.type === "block" && n.content?.mod === MOD && (n.content.props?.view ?? "side") === view;
  const walk = (node) => {
    if (!node || node.hidden) return false;
    if (isSide(node)) return true;
    const children = Array.isArray(node.children) ? node.children : [];
    if (node.type === "stack") {
      const active = children.find((c) => c.id === node.active) ?? children[0];
      return walk(active);
    }
    return children.some(walk);
  };
  return walk(tree);
}

// Whether a full copy takes the side view's open request `asked` ({tab, key}): the request's tab
// is focused and is this copy's own tab. With its own tab not known yet, only when that tab is the
// one full tab anywhere (so no other copy could be meant).
export function mayTakeOpen(asked, { focused, panes, ownTab }) {
  if (!asked?.tab || !asked.key || !focused || focused.tab !== asked.tab) return false;
  if (ownTab) return ownTab === asked.tab;
  const tabs = fullTabs(panes);
  return tabs.length === 1 && tabs[0] === asked.tab;
}

// The id to hide to close the side view's panel: the side block's nearest ancestor (or the block
// itself) whose parent is a row, e.g. the right `panel` column holding a `panel-body` stack.
export function sidePanelId(tree, view = "side") {
  const isSide = (n) => n?.type === "block" && n.content?.mod === MOD && (n.content.props?.view ?? "side") === view;
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

// shared(OPEN).key asking the full view to show its Runs tab.
export const RUNS_KEY = "runs";
// ... selecting the MRs tab.
export const MRS_KEY = "mrs";

// The key asking the full view to open an MR's tab (parseOpen reads it back).
// `loc` ({cwd, machine}) is the sender's folder: the full tab reads files and runs git there.
export const mrKey = ({ kind, host, path }, n, loc) =>
  JSON.stringify({ kind, host, path, mr: n, ...(loc?.cwd ? { cwd: loc.cwd, ...(loc.machine ? { machine: loc.machine } : {}) } : {}) });

// What omni-forge's own Herdr tabs are called, and the icon the tab bars draw for them
// (both bars read a mod tab's icon from shared("mod-icons")).
export const TAB_NAME = "CI";
export const MOD_ICON = `mods/${MOD}/icons/ci.svg`;

// The mod-icons map with ours added, or null when it's already there (nothing to write).
export function withModIcon(map) {
  if (map?.[MOD] === MOD_ICON) return null;
  return { ...(map ?? {}), [MOD]: MOD_ICON };
}
