import test from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import * as G from "../mods/git-graph/git.js";
import * as C from "../mods/git-graph/changes.js";

const env = { ...process.env, GIT_AUTHOR_NAME: "T", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "T", GIT_COMMITTER_EMAIL: "t@t", GIT_CONFIG_GLOBAL: "/dev/null" };
const git = (cwd, args) => { const r = spawnSync("git", args, { cwd, env, encoding: "utf8" }); assert.equal(r.status, 0, `${args.join(" ")}: ${r.stderr}`); return r.stdout; };
const apply = (cwd, lists) => { for (const a of lists) git(cwd, a); };
const write = (cwd, p, text) => { mkdirSync(join(cwd, p, ".."), { recursive: true }); writeFileSync(join(cwd, p), text); };
const status = (cwd) => G.parseStatus(git(cwd, ["status", "--porcelain=v1", "-z", "--no-renames", "--untracked-files=all"]));
const mk = (withCommit = true) => {
  const base = mkdtempSync(join(tmpdir(), "herdr-changes-")), repo = join(base, "repo");
  git(base, ["init", "-q", "-b", "main", "--bare", join(base, "remote.git")]);
  git(base, ["init", "-q", "-b", "main", repo]);
  git(repo, ["remote", "add", "origin", join(base, "remote.git")]);
  if (withCommit) { write(repo, "base.txt", "1"); git(repo, ["add", "."]); git(repo, ["commit", "-qm", "init"]); }
  return repo;
};

test("splitChanges: modified in index and worktree appears in both", () => {
  const repo = mk();
  write(repo, "base.txt", "2"); git(repo, ["add", "base.txt"]); write(repo, "base.txt", "3");
  const { staged, work } = C.splitChanges(status(repo));
  assert.deepEqual(staged, [{ path: "base.txt", s: "M", fresh: false }]);
  assert.deepEqual(work, [{ path: "base.txt", s: "M", fresh: false }]);
});

test("splitChanges: untracked is fresh", () => {
  const repo = mk(); write(repo, "new.txt", "x");
  const { staged, work } = C.splitChanges(status(repo));
  assert.deepEqual(staged, []);
  assert.deepEqual(work, [{ path: "new.txt", s: "A", fresh: true }]);
});

test("splitChanges: conflict gives !", () => {
  const repo = mk();
  git(repo, ["checkout", "-qb", "other"]); write(repo, "base.txt", "other"); git(repo, ["commit", "-qam", "o"]);
  git(repo, ["checkout", "-q", "main"]); write(repo, "base.txt", "main"); git(repo, ["commit", "-qam", "m"]);
  spawnSync("git", ["merge", "other"], { cwd: repo, env });
  const { staged, work } = C.splitChanges(status(repo));
  assert.deepEqual(staged, []);
  assert.deepEqual(work, [{ path: "base.txt", s: "!", fresh: false }]);
});

test("path with space and non-ASCII survives stage, unstage, discard", () => {
  const repo = mk(), p = "a b/ç.txt";
  write(repo, p, "x");
  apply(repo, C.stageArgs([p]));
  assert.deepEqual(C.splitChanges(status(repo)).staged.map((c) => c.path), [p]);
  apply(repo, C.unstageArgs([p], true));
  const { staged, work } = C.splitChanges(status(repo));
  assert.deepEqual(staged, []);
  assert.deepEqual(work.map((c) => c.path), [p]);
  const plan = C.discardPlan(work);
  assert.equal(plan.text, "Delete untracked file ç.txt? This cannot be undone.");
  apply(repo, plan.list);
  assert.equal(existsSync(join(repo, p)), false);
});

test("no-HEAD repo: unstage empties the index and the first commit works", () => {
  const repo = mk(false), p = "f.txt";
  write(repo, p, "x"); apply(repo, C.stageArgs([p]));
  assert.equal(C.splitChanges(status(repo)).staged.length, 1);
  apply(repo, C.unstageArgs([p], false));
  assert.equal(C.splitChanges(status(repo)).staged.length, 0);
  apply(repo, C.commitPlan("first", "", 0));
  assert.equal(git(repo, ["log", "--format=%s"]).trim(), "first");
});

test("discardPlan: mixed counts text, staged files stay staged", () => {
  const repo = mk();
  write(repo, "keep.txt", "k"); git(repo, ["add", "keep.txt"]);
  write(repo, "base.txt", "changed"); write(repo, "new.txt", "n");
  const { staged, work } = C.splitChanges(status(repo));
  const plan = C.discardPlan(work);
  assert.equal(plan.text, "Discard 1 changed and delete 1 untracked files? This cannot be undone.");
  apply(repo, plan.list);
  assert.deepEqual(C.splitChanges(status(repo)).staged, staged);
  assert.equal(existsSync(join(repo, "new.txt")), false);
});

test("discardPlan: only conflicts gives null", () => {
  assert.equal(C.discardPlan([{ path: "a", s: "!", fresh: false }]), null);
});

test("fileTree: compresses single-child dirs, dirs first", () => {
  const ch = (path) => ({ path, s: "M", fresh: false });
  const rows = C.fileTree([ch("README.md"), ch("src/shop/coupon.js"), ch("src/shop/cart.js")]);
  assert.deepEqual(rows.map((r) => [r.kind, r.path, r.name, r.depth]), [
    ["dir", "src/shop", "src/shop", 0],
    ["file", "src/shop/cart.js", "cart.js", 1],
    ["file", "src/shop/coupon.js", "coupon.js", 1],
    ["file", "README.md", "README.md", 0],
  ]);
  assert.equal(rows[1].change.path, "src/shop/cart.js");
});

test("changeCount counts a both-lists file once", () => {
  assert.equal(C.changeCount([{ path: "a" }, { path: "a" }, { path: "b" }]), 2);
});

test("commitPlan: blank title is null; body and add -A", () => {
  assert.equal(C.commitPlan("  ", "", 1), null);
  assert.deepEqual(C.commitPlan("t", "b", 1), [["commit", "-m", "t", "-m", "b"]]);
  assert.deepEqual(C.commitPlan("t", "", 0), [["add", "-A"], ["commit", "-m", "t"]]);
});

test("workDiffArgs: unstaged and staged diffs of a path with spaces", () => {
  const repo = mk(), p = "a b/ç.txt";
  write(repo, p, "one\n"); git(repo, ["add", "."]); git(repo, ["commit", "-qm", "add"]);
  write(repo, p, "two\n"); git(repo, ["add", "--", p]); write(repo, p, "three\n");
  const work = G.diffRows(git(repo, C.workDiffArgs(false, p)));
  const staged = G.diffRows(git(repo, C.workDiffArgs(true, p)));
  assert.deepEqual(work.filter((r) => r.kind === "+").map((r) => r.text), ["three"]);
  assert.deepEqual(staged.filter((r) => r.kind === "+").map((r) => r.text), ["two"]);
});

test("visibleRows: a collapsed dir hides what's under it, not its siblings", () => {
  const ch = (path) => ({ path, s: "M", fresh: false });
  const rows = C.fileTree([ch("src/a/x.js"), ch("src/b.js"), ch("src/ab.js"), ch("top.md")]);
  assert.deepEqual(C.visibleRows(rows, new Set(["src/a"])).map((r) => r.path), ["src", "src/a", "src/ab.js", "src/b.js", "top.md"]);
  assert.deepEqual(C.visibleRows(rows, new Set(["src"])).map((r) => r.path), ["src", "top.md"]);
  assert.equal(C.visibleRows(rows, new Set()).length, rows.length);
});

test("commitLabel: Commit, Commit all, Nothing to commit", () => {
  assert.equal(C.commitLabel(1, 3), "Commit");
  assert.equal(C.commitLabel(0, 2), "Commit all");
  assert.equal(C.commitLabel(0, 0), "Nothing to commit");
});

test("no-HEAD repo: unstage a file edited after staging (AM) keeps the edit", () => {
  for (const all of [false, true]) {
    const repo = mk(false);
    write(repo, "f.txt", "one\n"); git(repo, ["add", "f.txt"]); write(repo, "f.txt", "two\n");
    apply(repo, all ? C.unstageAllArgs(false) : C.unstageArgs(["f.txt"], false));
    assert.equal(git(repo, ["ls-files", "--cached"]), "");
    assert.equal(readFileSync(join(repo, "f.txt"), "utf8"), "two\n");
  }
});

test("conflicts: commitPlan refuses, commitLabel says resolve first", () => {
  assert.equal(C.commitPlan("t", "", 0, true), null);
  assert.equal(C.commitPlan("t", "", 2, true), null);
  assert.equal(C.commitLabel(0, 2, true), "Resolve conflicts first");
  assert.equal(C.commitLabel(1, 2, false), "Commit");
});

test("diffWidth: no spread, works on many rows", () => {
  const rows = Array.from({ length: 200000 }, (_x, i) => ({ text: i === 5 ? "x".repeat(100) : "a" }));
  assert.equal(C.diffWidth(rows), 100 * 6.6 + 60);
  assert.equal(C.diffWidth([]), 300);
});
