// Pure logic for the Changes tab: splitting status entries, the file tree,
// and the git argument lists for stage, unstage, discard and commit.
// Ported from git-panel (https://github.com/LaiqianDS/herdr-mods, Apache-2.0), itself from Herdr's shipped changes mod.

const letter = (c) => (c === "D" ? "D" : c === "A" ? "A" : "M");
const isConflict = (xy) => xy.includes("U") || xy === "AA" || xy === "DD";

// files: parseStatus entries ({ path, xy }). A file can land in both lists.
export function splitChanges(files) {
  const staged = [], work = [];
  for (const { path, xy } of files) {
    if (xy === "??") work.push({ path, s: "A", fresh: true });
    else if (isConflict(xy)) work.push({ path, s: "!", fresh: false });
    else {
      if (xy[0] !== " ") staged.push({ path, s: letter(xy[0]), fresh: false });
      if (xy[1] !== " ") work.push({ path, s: letter(xy[1]), fresh: false });
    }
  }
  return { staged, work };
}

export const changeCount = (files) => new Set(files.map((f) => f.path)).size;

// Rows for a changes list: dirs before files at each level, sorted by name;
// a dir holding only one dir is merged into it ("src/shop").
export function fileTree(changes) {
  const root = { dirs: new Map(), files: [] };
  for (const change of changes) {
    const parts = change.path.split("/");
    let node = root;
    for (const part of parts.slice(0, -1)) {
      if (!node.dirs.has(part)) node.dirs.set(part, { dirs: new Map(), files: [] });
      node = node.dirs.get(part);
    }
    node.files.push({ name: parts[parts.length - 1], change });
  }
  const byName = (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  const rows = [];
  const walk = (node, prefix, depth) => {
    const dirs = [...node.dirs].map(([name, child]) => ({ name, child })).sort(byName);
    for (let { name, child } of dirs) {
      while (child.files.length === 0 && child.dirs.size === 1) {
        const [[next, sub]] = child.dirs;
        name += "/" + next; child = sub;
      }
      const path = prefix ? `${prefix}/${name}` : name;
      rows.push({ kind: "dir", path, name, depth });
      walk(child, path, depth + 1);
    }
    for (const { name, change } of node.files.sort(byName)) rows.push({ kind: "file", path: change.path, name, depth, change });
  };
  walk(root, "", 0);
  return rows;
}

// --literal-pathspecs: a file name is never read as a glob or pathspec magic ("*.log" is that one file).
const LIT = "--literal-pathspecs";
export const stageArgs = (paths) => [[LIT, "add", "--", ...paths]];
export const stageAllArgs = () => [["add", "-A"]];
export const unstageArgs = (paths, hasHead) => [[LIT, ...(hasHead ? ["restore", "--staged", "--", ...paths] : ["rm", "--cached", "-f", "-q", "--", ...paths])]];
export const unstageAllArgs = (hasHead) => [[LIT, ...(hasHead ? ["restore", "--staged", "--", "."] : ["rm", "-r", "--cached", "-f", "-q", "--", "."])]];

// -f: with --cached it only drops the index entry, even when the file was edited after staging.

// Discard only touches the working tree; staged changes stay.
export function discardPlan(changes) {
  const tracked = changes.filter((c) => !c.fresh && c.s !== "!").map((c) => c.path);
  const fresh = changes.filter((c) => c.fresh).map((c) => c.path);
  const list = [...(tracked.length ? [[LIT, "restore", "--", ...tracked]] : []), ...(fresh.length ? [[LIT, "clean", "-f", "--", ...fresh]] : [])];
  if (!list.length) return null;
  const one = changes.length === 1 ? changes[0].path.split("/").pop() : null;
  const text = one ? (fresh.length ? `Delete untracked file ${one}?` : `Discard changes to ${one}?`)
    : `Discard ${tracked.length} changed and delete ${fresh.length} untracked files?`;
  return { text: `${text} This cannot be undone.`, list };
}

// conflicted: an unmerged file is left; git refuses the commit, and "add -A" would mark it resolved.
export function commitPlan(title, body, stagedCount, conflicted = false) {
  const t = title.trim(), b = (body ?? "").trim();
  if (!t || conflicted) return null;
  const list = [["commit", "-m", t, ...(b ? ["-m", b] : [])]];
  if (stagedCount === 0) list.unshift(["add", "-A"]);
  return list;
}

// The commit fields per repo: keeps `current` (when not blank) as fromRoot's draft and gives toRoot's, taking it out of `drafts`.
export function swapDraft(drafts, fromRoot, toRoot, current) {
  if (fromRoot != null && (current.title.trim() || current.body.trim())) drafts.set(fromRoot, current);
  const next = (toRoot != null && drafts.get(toRoot)) || { title: "", body: "" };
  drafts.delete(toRoot);
  return next;
}

// The Diff tab's source for a Changes row: kind is "staged" or "work".
export function rowSource(kind, change) {
  if (kind === "staged") return "staged";
  return change.fresh ? "untracked" : change.s === "!" ? "conflict" : "unstaged";
}

// The Diff tab's source for a file of the graph's Uncommitted row (a parseStatus entry):
// a file changed in both the index and the working tree opens on the working tree, what the person sees.
export function uncommittedSource(f) {
  if (f.untracked) return "untracked";
  if (f.status === "U") return "conflict";
  return f.xy?.[1] && f.xy[1] !== " " ? "unstaged" : "staged";
}

// fileTree rows without those under a collapsed dir (a Set of dir paths).
export function visibleRows(rows, collapsed) {
  const hidden = [...collapsed].map((dir) => dir + "/");
  return rows.filter((r) => !hidden.some((h) => r.path.startsWith(h)));
}

export const commitLabel = (stagedCount, workCount, conflicted = false) =>
  (conflicted ? "Resolve conflicts first" : stagedCount ? "Commit" : workCount ? "Commit all" : "Nothing to commit");

// The full view's Changes column: 320 by default, at least 240, at most half the pane (`total`, unknown before it's measured).
export const CHANGES_W = 320, CHANGES_MIN = 240;
export const clampChangesWidth = (w, total) => Math.round(Math.max(CHANGES_MIN, Math.min((total ?? Infinity) * 0.5, w)));
