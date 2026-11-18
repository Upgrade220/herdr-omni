// herdr-omni: what a tab is called on screen. A tab someone named keeps its name; one nobody
// named (Herdr calls it "1", "2") shows its lead pane's terminal title when that says something,
// else its program (not a shell), else its folder, else a mod pane's title. Display only: nothing
// is renamed. Pure, and kept identical in Better Tabs' views/tab-label.js.

// Leading symbols are status decorations (Claude Code's spinning ✳ and the like).
const clean = (s) => (s ?? "").replace(/^[^\p{L}\p{N}]+/u, "").trim();

const lastSegment = (p) => (p ?? "").replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? "";

const isPath = (s) => /^[~/]|^[A-Za-z]:\\/.test(s);

// A title that only repeats the folder, the host or the program tells nothing.
function telling(title, program) {
  if (!title) return false;
  if (isPath(title) || title.includes("@")) return false;
  const lower = title.toLowerCase();
  return lower !== (program?.name ?? "").toLowerCase() && lower !== (program?.key ?? "").toLowerCase();
}

export function tabLabel(tab, panes) {
  if (!tab) return "";
  const mine = (panes ?? []).filter((p) => p.tab === tab.id);
  const terms = mine.filter((p) => p.terminal);
  const lead = terms.find((p) => p.program?.agent) ?? terms.find((p) => p.focused) ?? terms[0];
  // The + menu names an agent's tab after the agent: that name says no more than a number.
  if (tab.named && !(lead && tab.name === lead.program?.name)) return tab.name;
  if (lead) {
    // Paths are judged before cleaning: the cleaner would eat a leading "~/" or "/".
    const raw = (lead.title ?? "").trim();
    const title = clean(raw);
    if (!isPath(raw) && telling(title, lead.program)) return title;
    if (lead.program?.name && !lead.program.shell) return lead.program.name;
    const folder = lastSegment(lead.cwd);
    if (folder) return folder;
  }
  const mod = mine.find((p) => !p.terminal && p.title);
  return mod ? mod.title : tab.name;
}
