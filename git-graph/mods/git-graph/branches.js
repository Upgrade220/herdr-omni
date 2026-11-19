// Pure logic for the branch picker: listing, filtering, switching, creating.
// Ported from git-panel (https://github.com/LaiqianDS/herdr-mods, Apache-2.0), itself from Herdr's shipped changes mod.

export const BRANCH_REFS = ["for-each-ref", "--format=%(refname)", "refs/heads", "refs/remotes"];

const byName = (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

// `current` is the checked-out branch name, or null when detached.
export function parseBranches(stdout, current) {
  const refs = stdout.split("\n").filter(Boolean);
  const heads = refs.filter((r) => r.startsWith("refs/heads/")).map((r) => r.slice(11));
  const known = new Set(heads);
  const locals = heads.map((name) => ({ name, local: true, current: name === current })).sort(byName);
  const remotes = refs
    .filter((r) => r.startsWith("refs/remotes/") && !r.endsWith("/HEAD"))
    .map((r) => r.slice(13))
    .filter((name) => !known.has(name.replace(/^[^/]+\//, "")))
    .map((name) => ({ name, local: false, current: false }))
    .sort(byName);
  const i = locals.findIndex((b) => b.current);
  if (i > 0) locals.unshift(...locals.splice(i, 1));
  return [...locals, ...remotes];
}

export function filterBranches(list, query) {
  const q = (query || "").toLowerCase();
  return list.filter((b) => b.name.toLowerCase().includes(q)).slice(0, 200);
}

export function validBranchName(name) {
  if (!name || name.startsWith("-") || /\s/.test(name)) return false;
  if (name.includes("..") || name.includes("@{") || /[~^:?*[\\]/.test(name)) return false;
  return !name.endsWith("/") && !name.endsWith(".lock");
}

// A remote branch gets a local branch that tracks it.
export const switchArgs = (b) => (b.local ? ["switch", b.name] : ["switch", "--track", b.name]);

export const createArgs = (name) => (validBranchName(name) ? ["switch", "-c", name] : null);
