// Git arguments and rows for the Diff tab. Pure: no herdr import, so node can test it.
import { diffRows } from "./diff-rows.js";

const LIT = "--literal-pathspecs";
const FULL = "--unified=1000000";
// Plain text whatever the repo configures: no colour, no external diff tool, no textconv filter.
const PLAIN = ["--no-color", "--no-ext-diff", "--no-textconv"];
const UNTRACKED_CAP = 3000;
export const NO_CHANGES = "No changes in this file";
export const BINARY = "Binary file, no text diff";

// Arguments for the git call that shows a target's diff, or null when the view
// reads the file itself (untracked and conflicted files).
export function diffArgs(target, full = false) {
  const wide = [...PLAIN, ...(full ? [FULL] : [])];
  switch (target?.source) {
    case "unstaged": return [LIT, "diff", ...wide, "--", target.path];
    case "staged": return [LIT, "diff", "--cached", ...wide, "--", target.path];
    case "commit": return [LIT, "show", "--diff-merges=first-parent", "--format=", ...wide, target.commit.hash, "--", target.path];
    default: return null;
  }
}

// An untracked file is all additions.
export function untrackedRows(text) {
  if (text == null) return { message: NO_CHANGES };
  if (text.includes("\0")) return { message: BINARY };
  const lines = text.split("\n");
  if (lines.length && lines[lines.length - 1] === "") lines.pop();
  return { rows: lines.slice(0, UNTRACKED_CAP).map((t, i) => ({ kind: "+", next: i + 1, text: t })) };
}

// Rows from `git diff` / `git show` output: everything before the first hunk is header.
export function rowsFromDiff(stdout) {
  if (!stdout || !stdout.trim()) return { message: NO_CHANGES };
  if (/^Binary files .* differ$/m.test(stdout) || /^GIT binary patch$/m.test(stdout)) return { message: BINARY };
  const lines = stdout.replace(/\n$/, "").split("\n");
  const first = lines.findIndex((l) => l.startsWith("@@"));
  if (first < 0) return { message: NO_CHANGES };
  // Header lines (diff --git, index, ---, +++, mode, similarity) all precede the first hunk.
  return { rows: diffRows(lines.slice(first)) };
}

// The Diff tab's header: what is compared.
export function scopeLabel(target) {
  if (!target) return "";
  if (target.source !== "commit") return target.source;
  const c = target.commit ?? {};
  return ["commit", c.short || String(c.hash ?? "").slice(0, 7), c.subject].filter(Boolean).join(" ");
}

// The header's status letter, as the Changes list marks files: U untracked, ! conflict,
// A or D when git's diff header says the file was created or deleted, else M.
export function statusOf(target, stdout) {
  if (target?.source === "untracked") return "U";
  if (target?.source === "conflict") return "!";
  if (/^new file mode /m.test(stdout ?? "")) return "A";
  if (/^deleted file mode /m.test(stdout ?? "")) return "D";
  return "M";
}

export function statOf(rows) {
  let add = 0, del = 0;
  for (const r of rows ?? []) { if (r.kind === "+") add++; else if (r.kind === "-") del++; }
  return { add, del };
}

// better-changes' limits: rows past DIFF_LINES are dropped and a line past LINE_LENGTH is cut.
export const DIFF_LINES = 1500;
export const LINE_LENGTH = 4000;
export function capRows(rows) {
  const long = (r) => (r.text ?? "").length > LINE_LENGTH;
  const truncated = rows.length > DIFF_LINES || rows.some(long);
  if (!truncated) return { rows, truncated };
  return { rows: rows.slice(0, DIFF_LINES).map((r) => (long(r) ? { ...r, text: `${r.text.slice(0, LINE_LENGTH)}…` } : r)), truncated };
}
