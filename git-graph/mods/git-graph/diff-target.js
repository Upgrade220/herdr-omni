// Git arguments and rows for the Diff tab. Pure: no herdr import, so node can test it.
import { diffRows } from "./diff-rows.js";

const LIT = "--literal-pathspecs";
const FULL = "--unified=1000000";
const UNTRACKED_CAP = 3000;
export const NO_CHANGES = "No changes in this file";
export const BINARY = "Binary file, no text diff";

// Arguments for the git call that shows a target's diff, or null when the view
// reads the file itself (untracked and conflicted files).
export function diffArgs(target, full = false) {
  const wide = full ? [FULL] : [];
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
