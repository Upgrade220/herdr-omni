// Where a CI view points, from snapshots of herdr's live data. Pure: no herdr import, so tests
// pass snapshots. `snap` = { focused: focused(), panes: panes(), spaces: spaces() }.
//
// Source order (full view): props.open's repo, then shared("omni-forge.last-loc") (the last focused
// terminal, recorded by every copy), then the focused terminal, then a terminal in the focused tab
// or space. Once a location is set, only a focused terminal with a new cwd moves it.

export const MOD = "omni-forge";
export const LAST_LOC = "omni-forge.last-loc";

// props.open is a watch key: JSON [kind, host, path, runId].
export function parseOpen(value) {
  try {
    const [kind, host, path, runId] = JSON.parse(value);
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

// Full is visible when the focused tab is a full tab. panes() carries no props, so with several
// full tabs any of them counts; with none found, the window being active decides.
export function isVisible({ focused, panes, windowActive }) {
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

// One step of following. `state` = { loc, seenTerm, lastLoc }: the current location (null at first),
// the key of the terminal last seen focused, and shared last-loc. Returns
// { move: loc | null (detect there), branch: string | null (the branch now, when at loc), seenTerm }.
export function nextLoc({ loc, seenTerm, lastLoc }, snap) {
  const term = terminalLoc(snap);
  const seen = term?.key ?? seenTerm ?? null;
  if (!loc) {
    const first = (lastLoc?.cwd ? locOf(lastLoc.cwd, lastLoc.machine, lastLoc.branch) : null) ?? term ?? fallbackLoc(snap);
    return { move: first, branch: first?.branch ?? null, seenTerm: seen };
  }
  if (term && term.key !== seenTerm && term.key !== loc.key) return { move: term, branch: term.branch, seenTerm: seen };
  const branch = term && term.key === loc.key ? term.branch : null;
  return { move: null, branch, seenTerm: seen };
}

// The value to record in shared last-loc, or null when it shouldn't change.
export function lastLocUpdate(current, snap) {
  const term = terminalLoc(snap);
  if (!term) return null;
  const next = { cwd: term.cwd, machine: term.machine, branch: term.branch };
  const same = current && current.cwd === next.cwd && (current.machine ?? null) === next.machine && (current.branch ?? null) === next.branch;
  return same ? null : next;
}
