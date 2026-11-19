import test from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as B from "../mods/git-graph/branches.js";

const env = { ...process.env, GIT_AUTHOR_NAME: "T", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "T", GIT_COMMITTER_EMAIL: "t@t", GIT_CONFIG_GLOBAL: "/dev/null" };
const git = (cwd, args) => { const r = spawnSync("git", args, { cwd, env, encoding: "utf8" }); assert.equal(r.status, 0, `${args.join(" ")}: ${r.stderr}`); return r.stdout; };

// main, fix (local) plus origin/main, origin/fix, origin/only-remote, origin/HEAD.
const mk = () => {
  const base = mkdtempSync(join(tmpdir(), "herdr-branches-")), repo = join(base, "repo");
  git(base, ["init", "-q", "-b", "main", "--bare", join(base, "remote.git")]);
  git(base, ["init", "-q", "-b", "main", repo]);
  git(repo, ["remote", "add", "origin", join(base, "remote.git")]);
  writeFileSync(join(repo, "a.txt"), "1"); git(repo, ["add", "."]); git(repo, ["commit", "-qm", "init"]);
  git(repo, ["branch", "fix"]); git(repo, ["branch", "only-remote"]);
  git(repo, ["push", "-q", "origin", "main", "fix", "only-remote"]);
  git(repo, ["branch", "-D", "only-remote"]);
  git(repo, ["fetch", "-q", "origin"]);
  git(repo, ["remote", "set-head", "origin", "main"]);
  return repo;
};
const list = (repo, current = "main") => B.parseBranches(git(repo, B.BRANCH_REFS), current);

test("parseBranches: locals first (current first), remote-only after, no HEAD or duplicates", () => {
  const repo = mk();
  assert.deepEqual(list(repo), [
    { name: "main", local: true, current: true },
    { name: "fix", local: true, current: false },
    { name: "origin/only-remote", local: false, current: false },
  ]);
});

test("parseBranches: detached (current null) marks nothing current", () => {
  const repo = mk();
  assert.ok(list(repo, null).every((b) => !b.current));
});

test("filterBranches: case-insensitive substring, capped at 200", () => {
  const repo = mk();
  assert.deepEqual(B.filterBranches(list(repo), "FI").map((b) => b.name), ["fix"]);
  const many = Array.from({ length: 300 }, (_, i) => ({ name: `b${i}`, local: true, current: false }));
  assert.equal(B.filterBranches(many, "").length, 200);
});

test("switchArgs: remote branch creates a tracking local branch", () => {
  const repo = mk();
  const remote = list(repo).find((b) => !b.local);
  assert.deepEqual(B.switchArgs(remote), ["switch", "--track", "origin/only-remote"]);
  git(repo, B.switchArgs(remote));
  assert.equal(git(repo, ["branch", "--show-current"]).trim(), "only-remote");
  assert.equal(git(repo, ["config", "branch.only-remote.remote"]).trim(), "origin");
  git(repo, B.switchArgs({ name: "fix", local: true }));
  assert.equal(git(repo, ["branch", "--show-current"]).trim(), "fix");
});

test("createArgs: null for names git would reject, valid otherwise", () => {
  for (const bad of ["-x", "a b", "a..b", "x.lock", "", "a/", "a@{b", "a~b", "a^b", "a:b", "a?b", "a*b", "a[b", "a\\b"]) assert.equal(B.createArgs(bad), null, bad);
  const repo = mk();
  assert.deepEqual(B.createArgs("feature/login"), ["switch", "-c", "feature/login"]);
  git(repo, B.createArgs("feature/login"));
  assert.equal(git(repo, ["branch", "--show-current"]).trim(), "feature/login");
});
