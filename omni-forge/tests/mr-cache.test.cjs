const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFile, execFileSync } = require("node:child_process");
const { load } = require("./load.cjs");
const { cacheDir, MR_REFS, sourceRef, fetchMr, diffOk, ensureMr, dropMr, pruneStale } = load(["forge/mr-cache.js"]);

const ENV = {
  ...process.env,
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_SYSTEM: "/dev/null",
  GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.org",
  GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.org",
};
function adapter() {
  const calls = [];
  const exec = (cmd, args, opts = {}) => {
    calls.push({ cmd, args: [...args] });
    return new Promise((resolve) => {
      execFile(cmd, args, { cwd: opts.cwd, env: ENV, maxBuffer: 1 << 24 }, (err, stdout, stderr) => {
        resolve({ code: err ? (typeof err.code === "number" ? err.code : 1) : 0, stdout, stderr });
      });
    });
  };
  return { exec, calls };
}
const git = (cwd, ...args) => execFileSync("git", args, { cwd, env: ENV, encoding: "utf8" });

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mrcache-"));
  const remote = path.join(root, "remote.git");
  const user = path.join(root, "user");
  git(root, "init", "-q", "--bare", "-b", "main", remote);
  git(root, "clone", "-q", remote, user);
  git(user, "checkout", "-q", "-b", "main");
  fs.writeFileSync(path.join(user, "a.txt"), "a\n");
  git(user, "add", "."); git(user, "commit", "-qm", "base");
  git(user, "push", "-q", "origin", "main");
  git(user, "checkout", "-q", "-b", "feature");
  fs.writeFileSync(path.join(user, "b.txt"), "b\n");
  git(user, "add", "."); git(user, "commit", "-qm", "feat");
  git(user, "push", "-q", "origin", "HEAD:refs/merge-requests/3/head");
  git(user, "checkout", "-q", "main");
  return { root, remote, user, dir: path.join(root, "cache", "mr-cache", "git.example.org", "grp", "app.git") };
}
const opts = (f) => ({ repoRoot: f.user, dir: f.dir, url: f.remote, kind: "gitlab", number: 3, target: "main" });
const snapshot = (user) => [
  git(user, "for-each-ref"), fs.readFileSync(path.join(user, ".git", "config"), "utf8"), git(user, "count-objects", "-v"),
].join("\n--\n");

test("cacheDir local and remote", () => {
  assert.equal(cacheDir({ local: true, appHome: "/h/.config/herdr-app", home: "/h", host: "git.example.org", path: "group/app" }),
    "/h/.config/herdr-app/data/omni-forge/mr-cache/git.example.org/group/app.git");
  assert.equal(cacheDir({ local: false, appHome: "/h/.config/herdr-app", home: "/home/u", host: "git.example.org", path: "group/app" }),
    "/home/u/.cache/omni-forge/mr-cache/git.example.org/group/app.git");
});

test("sourceRef and MR_REFS", () => {
  assert.equal(sourceRef("gitlab", 7), "refs/merge-requests/7/head");
  assert.equal(sourceRef("github", 7), "refs/pull/7/head");
  assert.deepEqual({ ...MR_REFS(7) }, { head: "refs/omni-forge/mr/7/head", base: "refs/omni-forge/mr/7/base" });
});

test("fetchMr fills the cache and leaves the user's repo untouched", async () => {
  const f = fixture();
  const before = snapshot(f.user);
  const { exec } = adapter();
  const res = await fetchMr(exec, opts(f));
  assert.equal(res.ok, true, res.error);
  const head = git(f.dir.replace(/\/$/, ""), "--git-dir=" + f.dir, "rev-parse", "--verify", MR_REFS(3).head + "^{commit}").trim();
  assert.equal(head, git(f.user, "rev-parse", "feature").trim());
  git(f.root, "--git-dir=" + f.dir, "rev-parse", "--verify", MR_REFS(3).base + "^{commit}");
  assert.equal(snapshot(f.user), before);
});

test("fetch failure returns the git error", async () => {
  const f = fixture();
  const { exec } = adapter();
  const res = await fetchMr(exec, { ...opts(f), url: path.join(f.root, "nope.git") });
  assert.equal(res.ok, false);
  assert.match(res.error, /nope\.git|does not appear|not a git repository/i);
});

test("missing objects wipe and refetch once", async () => {
  const f = fixture();
  // MR 4 exists only on the remote, so the cache stores its objects itself (loose).
  const other = path.join(f.root, "other");
  git(f.root, "clone", "-q", f.remote, other);
  fs.writeFileSync(path.join(other, "c.txt"), "c\n");
  git(other, "add", "."); git(other, "commit", "-qm", "mr4");
  git(other, "push", "-q", "origin", "HEAD:refs/merge-requests/4/head");
  const { exec, calls } = adapter();
  const o = { ...opts(f), number: 4 };
  assert.equal((await fetchMr(exec, o)).ok, true);
  // Damage every loose object the cache holds.
  const objDir = path.join(f.dir, "objects");
  let damaged = 0;
  for (const d of fs.readdirSync(objDir).filter((n) => /^[0-9a-f]{2}$/.test(n))) {
    for (const n of fs.readdirSync(path.join(objDir, d))) { const p = path.join(objDir, d, n); fs.chmodSync(p, 0o644); fs.writeFileSync(p, "garbage"); damaged++; }
  }
  assert.ok(damaged > 0);
  calls.length = 0;
  const res = await ensureMr(exec, o);
  assert.equal(res.ok, true, res.error);
  assert.equal(calls.filter((c) => c.args.includes("fetch")).length, 2);
  assert.equal((await diffOk(exec, { dir: f.dir, refs: MR_REFS(4) })).ok, true);
});

test("dropMr removes both refs", async () => {
  const f = fixture();
  const { exec } = adapter();
  await fetchMr(exec, opts(f));
  await dropMr(exec, { dir: f.dir, number: 3 });
  assert.equal(git(f.root, "--git-dir=" + f.dir, "for-each-ref", "refs/omni-forge").trim(), "");
});

test("pruneStale deletes old caches and keeps fresh ones", async () => {
  const f = fixture();
  const { exec } = adapter();
  const root = path.join(f.root, "cache", "mr-cache");
  const fresh = path.join(root, "git.example.org", "grp", "fresh.git");
  await fetchMr(exec, opts(f));
  await fetchMr(exec, { ...opts(f), dir: fresh });
  execFileSync("touch", ["-t", "200001010000", path.join(f.dir, "omni-forge-used")]);
  await pruneStale(exec, { root, days: 14 });
  assert.equal(fs.existsSync(f.dir), false);
  assert.equal(fs.existsSync(fresh), true);
});

async function corruptCache(f, dir) {
  const other = path.join(f.root, "other");
  if (!fs.existsSync(other)) {
    git(f.root, "clone", "-q", f.remote, other);
    fs.writeFileSync(path.join(other, "c.txt"), "c\n");
    git(other, "add", "."); git(other, "commit", "-qm", "mr4");
    git(other, "push", "-q", "origin", "HEAD:refs/merge-requests/4/head");
  }
  const { exec, calls } = adapter();
  const o = { ...opts(f), number: 4, dir };
  assert.equal((await fetchMr(exec, o)).ok, true);
  const objDir = path.join(dir, "objects");
  for (const d of fs.readdirSync(objDir).filter((n) => /^[0-9a-f]{2}$/.test(n))) {
    for (const n of fs.readdirSync(path.join(objDir, d))) { const p = path.join(objDir, d, n); fs.chmodSync(p, 0o644); fs.writeFileSync(p, "garbage"); }
  }
  calls.length = 0;
  return { exec, calls, o };
}

test("a transport failure keeps a good cache and fetches once", async () => {
  const f = fixture();
  const { exec, calls } = adapter();
  assert.equal((await fetchMr(exec, opts(f))).ok, true);
  calls.length = 0;
  const res = await ensureMr(exec, { ...opts(f), url: path.join(f.root, "nope.git") });
  assert.equal(res.ok, false);
  assert.equal(calls.filter((c) => c.args.includes("fetch")).length, 1);
  assert.equal(fs.existsSync(f.dir), true);
  assert.equal((await diffOk(exec, { dir: f.dir, refs: MR_REFS(3) })).ok, true);
});

test("ensureMr never deletes a dir that fails the safety guard", async () => {
  const f = fixture();
  for (const dir of [path.join(f.root, "other-cache", "app.git"), path.join(f.root, "mr-cache", "app")]) {
    const { exec, o } = await corruptCache(f, dir);
    const res = await ensureMr(exec, o);
    assert.equal(res.ok, false);
    assert.equal(fs.existsSync(dir), true);
  }
});

test("pruneStale never deletes a stale dir that is not a .git cache", async () => {
  const f = fixture();
  const { exec } = adapter();
  const root = path.join(f.root, "mr-cache");
  const dir = path.join(root, "git.example.org", "grp", "plain");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "omni-forge-used"), "");
  execFileSync("touch", ["-t", "200001010000", path.join(dir, "omni-forge-used")]);
  await pruneStale(exec, { root, days: 14 });
  assert.equal(fs.existsSync(dir), true);
});
