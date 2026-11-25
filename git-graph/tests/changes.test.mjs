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

test("clampChangesWidth: 240 at least, half the width at most, rounded", () => {
  assert.equal(C.CHANGES_W, 320);
  assert.equal(C.clampChangesWidth(320, 1200), 320);
  assert.equal(C.clampChangesWidth(100, 1200), 240);
  assert.equal(C.clampChangesWidth(900, 1200), 600);
  assert.equal(C.clampChangesWidth(300.4, 1200), 300);
  // A pane under 480 wide: the minimum wins.
  assert.equal(C.clampChangesWidth(320, 400), 240);
  // Before the first measure there is no upper bound.
  assert.equal(C.clampChangesWidth(900, undefined), 900);
});

test("literal pathspecs: a file named *.log is only that file for discard and stage", () => {
  const repo = mk();
  for (const p of ["a.log", "b.log", "*.log"]) write(repo, p, p);
  const star = { path: "*.log", s: "A", fresh: true };
  apply(repo, C.stageArgs(["*.log"]));
  assert.deepEqual(C.splitChanges(status(repo)).staged.map((c) => c.path), ["*.log"]);
  apply(repo, C.unstageArgs(["*.log"], true));
  assert.deepEqual(C.splitChanges(status(repo)).staged, []);
  apply(repo, C.discardPlan([star]).list);
  assert.equal(existsSync(join(repo, "*.log")), false);
  assert.equal(existsSync(join(repo, "a.log")), true);
  assert.equal(existsSync(join(repo, "b.log")), true);
});

test("literal pathspecs: unstage of *.log touches only that file; whole-tree forms still work", () => {
  const repo = mk();
  for (const p of ["a.log", "*.log"]) write(repo, p, p + "\n");
  git(repo, ["add", "."]); git(repo, ["commit", "-qm", "logs"]);
  for (const p of ["a.log", "*.log"]) write(repo, p, p + " changed\n");
  git(repo, ["add", "."]);
  apply(repo, C.unstageArgs(["*.log"], true));
  assert.deepEqual(C.splitChanges(status(repo)).staged.map((c) => c.path), ["a.log"]);
  apply(repo, C.unstageAllArgs(true));
  assert.deepEqual(C.splitChanges(status(repo)).staged, []);
  apply(repo, C.stageAllArgs());
  assert.equal(C.splitChanges(status(repo)).staged.length, 2);
});

test("literal pathspecs: no-HEAD unstage of *.log keeps a.log staged", () => {
  const repo = mk(false);
  for (const p of ["a.log", "*.log"]) write(repo, p, p);
  git(repo, ["add", "."]);
  apply(repo, C.unstageArgs(["*.log"], false));
  assert.deepEqual(C.splitChanges(status(repo)).staged.map((c) => c.path), ["a.log"]);
  apply(repo, C.unstageAllArgs(false));
  assert.deepEqual(C.splitChanges(status(repo)).staged, []);
});

test("swapDraft: a draft stays with its repo", () => {
  const drafts = new Map();
  const empty = { title: "", body: "" };
  let cur = C.swapDraft(drafts, null, "/a", empty);
  assert.deepEqual(cur, empty);
  cur = C.swapDraft(drafts, "/a", "/b", { title: "fix A", body: "why" });
  assert.deepEqual(cur, empty);
  cur = C.swapDraft(drafts, "/b", "/a", { title: "B title", body: "" });
  assert.deepEqual(cur, { title: "fix A", body: "why" });
  assert.equal(drafts.has("/a"), false);
  cur = C.swapDraft(drafts, "/a", "/b", { title: "", body: "  " });
  assert.deepEqual(cur, { title: "B title", body: "" });
  assert.equal(drafts.has("/a"), false, "a blank draft is not kept");
  assert.deepEqual(C.swapDraft(drafts, "/b", null, cur), empty);
});

test("rowSource: a Changes row's side for the Diff tab", () => {
  assert.equal(C.rowSource("staged", { path: "a", s: "M", fresh: false }), "staged");
  assert.equal(C.rowSource("work", { path: "a", s: "M", fresh: false }), "unstaged");
  assert.equal(C.rowSource("work", { path: "a", s: "A", fresh: true }), "untracked");
  assert.equal(C.rowSource("work", { path: "a", s: "!", fresh: false }), "conflict");
});

test("uncommittedSource: the side an Uncommitted row's file opens on, from real statuses", () => {
  const repo = mk();
  write(repo, "both.txt", "1"); write(repo, "staged.txt", "1"); write(repo, "work.txt", "1");
  git(repo, ["add", "."]); git(repo, ["commit", "-qm", "files"]);
  write(repo, "both.txt", "2"); git(repo, ["add", "both.txt"]); write(repo, "both.txt", "3");
  write(repo, "staged.txt", "2"); git(repo, ["add", "staged.txt"]);
  write(repo, "work.txt", "2");
  write(repo, "new.txt", "x");
  write(repo, "added.txt", "x"); git(repo, ["add", "added.txt"]);
  const by = Object.fromEntries(status(repo).map((f) => [f.path, C.uncommittedSource(f)]));
  assert.deepEqual(by, { "added.txt": "staged", "both.txt": "unstaged", "new.txt": "untracked", "staged.txt": "staged", "work.txt": "unstaged" });
  assert.equal(C.uncommittedSource({ xy: "UU", status: "U", untracked: false, staged: false }), "conflict");
  assert.equal(C.uncommittedSource({ xy: "AA", status: "U", untracked: false, staged: false }), "conflict");
  assert.equal(C.uncommittedSource({ xy: " D", status: "D", untracked: false, staged: false }), "unstaged");
  assert.equal(C.uncommittedSource({ xy: "D ", status: "D", untracked: false, staged: true }), "staged");
});

test("push: what the Push button offers", () => {
  const remotes = ["origin"];
  assert.equal(C.pushPlan({ current: null, upstream: null, ahead: 0, remotes }), null, "detached HEAD");
  assert.equal(C.pushPlan({ current: "main", upstream: null, ahead: 0, remotes: [] }), null, "no remote");
  assert.deepEqual(C.pushPlan({ current: "main", upstream: "origin/main", ahead: 2, remotes }),
    { label: "Push", ahead: 2, enabled: true, args: [["push"]] });
  assert.deepEqual(C.pushPlan({ current: "main", upstream: "origin/main", ahead: 0, remotes }),
    { label: "Push", ahead: 0, enabled: false, tooltip: "Nothing to push", args: [["push"]] });
  assert.deepEqual(C.pushPlan({ current: "feat", upstream: null, ahead: 0, remotes }),
    { label: "Publish branch", ahead: 0, enabled: true, tooltip: "Push feat and set its upstream", dialog: { type: "push", name: "feat" } });
});

test("push: upstream and ahead are read, and the push runs, in a throwaway repo", () => {
  const remote = mkdtempSync(join(tmpdir(), "gg-remote-")), dir = mkdtempSync(join(tmpdir(), "gg-push-"));
  git(remote, ["init", "-q", "--bare"]);
  git(dir, ["init", "-q", "-b", "main"]);
  git(dir, ["commit", "-q", "--allow-empty", "-m", "one"]);
  git(dir, ["remote", "add", "origin", remote]);
  git(dir, ["push", "-q", "-u", "origin", "main"]);
  git(dir, ["commit", "-q", "--allow-empty", "-m", "two"]);
  assert.equal(git(dir, C.UPSTREAM).trim(), "origin/main");
  assert.equal(git(dir, C.AHEAD).trim(), "1");
  const plan = C.pushPlan({ current: "main", upstream: "origin/main", ahead: 1, remotes: ["origin"] });
  for (const args of plan.args) spawnSync("git", args, { cwd: dir, env });
  assert.equal(git(dir, C.AHEAD).trim(), "0");
});
