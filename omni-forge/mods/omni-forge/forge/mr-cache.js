// A bare cache repo per project, kept OUTSIDE the user's repo, that borrows the user's objects
// (objects/info/alternates) and holds the MR head and target tip under refs/omni-forge/mr/<n>/.
// The user's repo is only read. `exec` is passed in (herdr's exec), so this file does not import herdr.

const BROKEN = /bad object|missing|could not read|unable to read|corrupt|inflate/i;

export function cacheDir({ local, appHome, home, host, path }) {
  const base = local ? `${appHome}/data/omni-forge` : `${home}/.cache/omni-forge`;
  return `${base}/mr-cache/${host}/${path}.git`;
}

export function MR_REFS(n) {
  return { head: `refs/omni-forge/mr/${n}/head`, base: `refs/omni-forge/mr/${n}/base` };
}

export function sourceRef(kind, n) {
  return kind === "github" ? `refs/pull/${n}/head` : `refs/merge-requests/${n}/head`;
}

const safeDir = (dir) => typeof dir === "string" && dir.endsWith(".git") && dir.includes("/mr-cache/");

async function run(exec, cmd, args, opts) {
  try {
    return await exec(cmd, args, opts);
  } catch (e) {
    return { code: -1, stdout: "", stderr: String(e?.message ?? e) };
  }
}

const failure = (res) => (res.stderr || res.stdout || `exit ${res.code}`).trim();

export async function fetchMr(exec, { on, repoRoot, dir, url, kind, number, target }) {
  const refs = MR_REFS(number);
  const common = await run(exec, "git", ["-C", repoRoot, "rev-parse", "--path-format=absolute", "--git-common-dir"], { on });
  if (common.code !== 0) return { ok: false, error: failure(common) };
  const objects = `${common.stdout.trim()}/objects`;
  const init = await run(exec, "git", ["init", "--bare", "-q", dir], { on });
  if (init.code !== 0) return { ok: false, error: failure(init) };
  const alt = await run(exec, "sh", ["-c", 'mkdir -p "$1/objects/info" && printf "%s\\n" "$2" > "$1/objects/info/alternates"', "sh", dir, objects], { on });
  if (alt.code !== 0) return { ok: false, error: failure(alt) };
  const fetch = await run(exec, "git", [
    `--git-dir=${dir}`, "fetch", "--no-tags", "--quiet", url,
    `+${sourceRef(kind, number)}:${refs.head}`, `+refs/heads/${target}:${refs.base}`,
  ], { on, timeout: 120000 });
  if (fetch.code !== 0) return { ok: false, error: failure(fetch) };
  await run(exec, "touch", [`${dir}/omni-forge-used`], { on });
  return { ok: true, refs };
}

// `rev-parse --verify` takes one revision, so each ref is checked on its own.
export async function diffOk(exec, { on, dir, refs }) {
  for (const ref of [refs.head, refs.base]) {
    const res = await run(exec, "git", [`--git-dir=${dir}`, "rev-parse", "--verify", `${ref}^{commit}`], { on });
    if (res.code !== 0) return { ok: false, error: `missing objects: ${failure(res)}` };
  }
  return { ok: true };
}

export async function ensureMr(exec, opts) {
  const first = await fetchMr(exec, opts);
  const check = first.ok ? await diffOk(exec, { on: opts.on, dir: opts.dir, refs: first.refs }) : first;
  if (check.ok) return first;
  if (!BROKEN.test(check.error) || !safeDir(opts.dir)) return { ok: false, error: check.error };
  await run(exec, "rm", ["-rf", opts.dir], { on: opts.on });
  const second = await fetchMr(exec, opts);
  if (!second.ok) return second;
  const again = await diffOk(exec, { on: opts.on, dir: opts.dir, refs: second.refs });
  return again.ok ? second : { ok: false, error: again.error };
}

export async function dropMr(exec, { on, dir, number }) {
  const refs = MR_REFS(number);
  for (const ref of [refs.head, refs.base]) await run(exec, "git", [`--git-dir=${dir}`, "update-ref", "-d", ref], { on });
}

export async function pruneStale(exec, { on, root, days = 14 }) {
  const res = await run(exec, "sh", ["-c", 'find "$1" -name omni-forge-used -mtime "+$2"', "sh", root, String(days)], { on });
  if (res.code !== 0) return;
  for (const stamp of res.stdout.split("\n").map((s) => s.trim()).filter(Boolean)) {
    const dir = stamp.slice(0, stamp.length - "/omni-forge-used".length);
    if (safeDir(dir)) await run(exec, "rm", ["-rf", dir], { on });
  }
}
