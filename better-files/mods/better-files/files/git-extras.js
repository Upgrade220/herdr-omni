// Git extras for the file panel: per-file +N -N, folder change counts, the branch summary
// and Git-ignored files. Pure: callers run the git commands and hand over the stdout.
// Ideas from cybertron288/herdr-mods filetree (MIT).

export const NUMSTAT = ["--no-optional-locks", "diff", "HEAD", "--numstat", "-z", "--no-renames"];
export const BRANCH = ["--no-optional-locks", "status", "--porcelain=v2", "--branch", "-z"];
export const IGNORED = ["--no-optional-locks", "ls-files", "--others", "--ignored", "--exclude-standard", "--directory", "-z"];

// `git diff --numstat -z --no-renames`: "add\tdel\tpath\0" per file; binary files show "-".
export function parseNumstat(stdout) {
  const out = {};
  for (const entry of stdout.split("\0")) {
    const m = /^(-|\d+)\t(-|\d+)\t(.+)$/s.exec(entry.replace(/^\n/, ""));
    if (!m) continue;
    out[m[3]] = m[1] === "-" ? { add: null, del: null } : { add: Number(m[1]), del: Number(m[2]) };
  }
  return out;
}

// Changed files under each ancestor folder. Accepts a letter or parseStatus's { mark } per path.
export function folderCounts(marks) {
  const counts = {};
  for (const file of Object.keys(marks)) {
    const parts = file.split("/").filter(Boolean);
    counts[""] = (counts[""] || 0) + 1;
    for (let i = 1; i < parts.length; i++) {
      const folder = parts.slice(0, i).join("/");
      counts[folder] = (counts[folder] || 0) + 1;
    }
  }
  return counts;
}

// `git status --porcelain=v2 --branch -z` header lines. A repo with no commits still has a branch.
export function parseBranch(stdout) {
  let branch = null;
  let ahead = 0;
  let behind = 0;
  for (const line of stdout.split("\0")) {
    if (line.startsWith("# branch.head ")) branch = line.slice(14);
    else if (line.startsWith("# branch.ab ")) {
      const m = /^# branch\.ab \+(\d+) -(\d+)/.exec(line);
      if (m) [ahead, behind] = [Number(m[1]), Number(m[2])];
    }
  }
  return branch === null ? null : { branch, ahead, behind };
}

const letterOf = (v) => (typeof v === "string" ? v : v?.mark);

export function summaryOf(marks, numstat, branchInfo) {
  if (!branchInfo) return null;
  let add = 0;
  let del = 0;
  for (const n of Object.values(numstat || {})) {
    add += n.add || 0;
    del += n.del || 0;
  }
  let modified = 0;
  let added = 0;
  let deleted = 0;
  for (const v of Object.values(marks || {})) {
    const letter = letterOf(v);
    if (letter === "A") added++;
    else if (letter === "D") deleted++;
    else modified++;
  }
  return { branch: branchInfo.branch, ahead: branchInfo.ahead, behind: branchInfo.behind, add, del, modified, added, deleted };
}

// `ls-files --others --ignored --directory -z`: an ignored folder is listed once, ending in "/".
export const parseIgnored = (stdout) => new Set(stdout.split("\0").filter(Boolean));

export function isIgnored(set, path) {
  if (set.has(path)) return true;
  for (let i = path.indexOf("/"); i !== -1; i = path.indexOf("/", i + 1)) {
    if (set.has(path.slice(0, i + 1))) return true;
  }
  return false;
}
