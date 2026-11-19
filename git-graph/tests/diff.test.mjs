import test from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { diffRows, splitDiffRows, conflictRows } from "../mods/git-graph/diff-rows.js";
import { languageOf, tokenizeLine } from "../mods/git-graph/syntax.js";
import { diffArgs, untrackedRows, rowsFromDiff, scopeLabel, statusOf, statOf, capRows, DIFF_LINES } from "../mods/git-graph/diff-target.js";

const env = { ...process.env, GIT_AUTHOR_NAME: "T", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "T", GIT_COMMITTER_EMAIL: "t@t", GIT_CONFIG_GLOBAL: "/dev/null" };
const git = (cwd, args) => { const r = spawnSync("git", args, { cwd, env, encoding: "utf8" }); assert.equal(r.status, 0, `${args.join(" ")}: ${r.stderr}`); return r.stdout; };
const write = (cwd, p, text) => { mkdirSync(join(cwd, p, ".."), { recursive: true }); writeFileSync(join(cwd, p), text); };
const repo = () => { const r = mkdtempSync(join(tmpdir(), "herdr-diff-")); git(r, ["init", "-q", "-b", "main"]); return r; };
const commit = (r, msg = "c") => { git(r, ["add", "-A"]); git(r, ["commit", "-qm", msg]); return git(r, ["rev-parse", "HEAD"]).trim(); };
const show = (r, target, full = false) => rowsFromDiff(git(r, diffArgs({ root: r, ...target }, full)));
const kinds = (rows) => rows.map((x) => x.kind).join("");

// ---- ported from better-changes ----

test("diffRows numbers old and new lines and resets at each hunk", () => {
  const rows = diffRows(["@@ -3,2 +10,2 @@", " keep", "-gone", "+came", "\\ No newline at end of file", "@@ -50 +60 @@", "-x"]);
  assert.deepEqual(rows[0], { kind: "@", text: "@@ -3,2 +10,2 @@" });
  assert.deepEqual(rows[1], { kind: " ", old: 3, next: 10, text: "keep" });
  assert.deepEqual(rows[2], { kind: "-", old: 4, text: "gone" });
  assert.deepEqual(rows[3], { kind: "+", next: 11, text: "came" });
  assert.deepEqual(rows[4], { kind: "", text: "\\ No newline at end of file" });
  assert.deepEqual(rows[6], { kind: "-", old: 50, text: "x" });
});

test("splitDiffRows pairs a replacement block by position and never across context", () => {
  const pairs = splitDiffRows(diffRows(["@@ -1,4 +1,4 @@", "-a", "-b", "+c", " mid", "+d"]));
  assert.equal(pairs[0].kind, "@");
  assert.deepEqual(pairs.slice(1, 3).map((p) => [p.left?.text ?? null, p.right?.text ?? null]), [["a", "c"], ["b", null]]);
  assert.equal(pairs[3].left.text, "mid");
  assert.equal(pairs[3].right.text, "mid");
  assert.deepEqual([pairs[4].left, pairs[4].right.text], [null, "d"]);
});

test("two nearby conflicts show the lines between them once", () => {
  const block = (name) => ["<<<<<<< HEAD", `${name} mine`, "=======", `${name} theirs`, ">>>>>>> topic"];
  const file = [...block("a"), "between 1", "between 2", ...block("b")].join("\n");
  const { inline } = conflictRows(file);
  assert.equal(inline.filter((row) => row.text === "between 1").length, 1);
  assert.equal(inline.filter((row) => row.text === "between 2").length, 1);
});

test("conflict rows keep file line numbers, a few lines around, and the base inline", () => {
  const file = ["1", "2", "3", "4", "5", "<<<<<<< HEAD", "mine", "more mine", "||||||| base", "old", "=======", "theirs", ">>>>>>> topic", "after", "6", "7", "8", "9"].join("\n");
  const { inline, split, count } = conflictRows(file);
  assert.equal(count, 1);
  assert.equal(inline[0].text, "Conflict 1 of 1 · line 6");
  assert.deepEqual(inline.slice(1, 4).map((r) => r.text), ["3", "4", "5"]);
  assert.equal(inline.find((r) => r.text === "theirs").next, 12);
  assert.ok(inline.some((r) => r.kind === "base" && r.text === "old"));
  assert.ok(!inline.some((r) => r.text === "1"));
  assert.ok(!split.some((r) => r.left?.text === "old" || r.right?.text === "old"));
  const pairs = split.filter((r) => r.left?.kind === "yours");
  assert.deepEqual(pairs.map((r) => [r.left.text, r.right?.text ?? null]), [["mine", "theirs"], ["more mine", null]]);
});

test("a file without a complete conflict block has no conflict rows", () => {
  assert.equal(conflictRows("plain\n======="), null);
  assert.equal(conflictRows("<<<<<<< HEAD\nnever closed\n"), null);
});

test("syntax: language by name and a tokenised line that rejoins to its text", () => {
  assert.equal(languageOf("src/a.TS"), "ts");
  assert.equal(languageOf(".env.local"), "env");
  const { runs, state } = tokenizeLine("const x = 1;", "ts", null);
  assert.equal(runs.map((r) => r.text).join(""), "const x = 1;");
  assert.equal(runs[0].kind, "keyword");
  assert.equal(state, null);
  assert.notEqual(tokenizeLine("/* open", "ts", null).state, null);
});

// ---- diff arguments against real git ----

test("diffArgs shapes, with --literal-pathspecs first", () => {
  const t = (source, extra) => ({ root: "/r", on: null, path: "p", source, ...extra });
  const plain = ["--no-color", "--no-ext-diff", "--no-textconv"];
  assert.deepEqual(diffArgs(t("unstaged"), false), ["--literal-pathspecs", "diff", ...plain, "--", "p"]);
  assert.deepEqual(diffArgs(t("unstaged"), true), ["--literal-pathspecs", "diff", ...plain, "--unified=1000000", "--", "p"]);
  assert.deepEqual(diffArgs(t("staged"), false), ["--literal-pathspecs", "diff", "--cached", ...plain, "--", "p"]);
  assert.deepEqual(diffArgs(t("commit", { commit: { hash: "abc", short: "a", subject: "s" } }), true),
    ["--literal-pathspecs", "show", "--diff-merges=first-parent", "--format=", ...plain, "--unified=1000000", "abc", "--", "p"]);
  assert.equal(diffArgs({ source: "untracked" }), null);
  assert.equal(diffArgs({ source: "conflict" }), null);
});

test("an unstaged edit of a glob-named file shows that file only", () => {
  const r = repo();
  write(r, "a b/ç*.txt", "one\n"); write(r, "a b/çx.txt", "one\n"); commit(r);
  write(r, "a b/ç*.txt", "two\n"); write(r, "a b/çx.txt", "two\n");
  const { rows } = show(r, { source: "unstaged", path: "a b/ç*.txt" });
  assert.equal(kinds(rows), "@-+");
  assert.equal(rows[2].text, "two");
});

test("a staged edit shows the staged side only", () => {
  const r = repo();
  write(r, "f.txt", "one\n"); commit(r);
  write(r, "f.txt", "two\n"); git(r, ["add", "f.txt"]); write(r, "f.txt", "three\n");
  const { rows } = show(r, { source: "staged", path: "f.txt" });
  assert.deepEqual(rows.filter((x) => x.kind === "+").map((x) => x.text), ["two"]);
});

test("a staged deletion shows only - rows", () => {
  const r = repo();
  write(r, "f.txt", "a\nb\n"); commit(r);
  git(r, ["rm", "-q", "f.txt"]);
  const { rows } = show(r, { source: "staged", path: "f.txt" });
  assert.equal(kinds(rows), "@--");
});

test("untrackedRows: lines become + rows, NUL is binary, null is empty", () => {
  const { rows } = untrackedRows("x\ny\n");
  assert.deepEqual(rows, [{ kind: "+", next: 1, text: "x" }, { kind: "+", next: 2, text: "y" }]);
  assert.deepEqual(untrackedRows("a\0b"), { message: "Binary file, no text diff" });
  assert.deepEqual(untrackedRows(null), { message: "No changes in this file" });
  assert.equal(untrackedRows("l\n".repeat(5000)).rows.length, 3000);
});

test("a committed binary file has a message, not rows", () => {
  const r = repo();
  write(r, "f.txt", "t\n"); commit(r);
  writeFileSync(join(r, "b.bin"), Buffer.from([0, 1, 2, 0, 255]));
  const h = commit(r, "bin");
  assert.deepEqual(show(r, { source: "commit", path: "b.bin", commit: { hash: h } }), { message: "Binary file, no text diff" });
});

test("the root commit's file shows only + rows", () => {
  const r = repo();
  write(r, "f.txt", "a\nb\n"); const h = commit(r);
  const { rows } = show(r, { source: "commit", path: "f.txt", commit: { hash: h } });
  assert.equal(kinds(rows), "@++");
});

test("a merge commit's file shows its first-parent diff", () => {
  const r = repo();
  write(r, "base.txt", "b\n"); commit(r);
  git(r, ["checkout", "-qb", "topic"]); write(r, "t.txt", "topic\n"); commit(r, "topic");
  git(r, ["checkout", "-q", "main"]); write(r, "m.txt", "main\n"); commit(r, "main");
  git(r, ["merge", "-q", "--no-ff", "-m", "merge", "topic"]);
  const h = git(r, ["rev-parse", "HEAD"]).trim();
  const { rows } = show(r, { source: "commit", path: "t.txt", commit: { hash: h } });
  assert.equal(kinds(rows), "@+");
  assert.equal(rows[1].text, "topic");
});

test("full=true on a 50-line file with one change gives every line", () => {
  const r = repo();
  const lines = Array.from({ length: 50 }, (_, i) => `line ${i + 1}`);
  write(r, "f.txt", lines.join("\n") + "\n"); commit(r);
  lines[24] = "changed";
  write(r, "f.txt", lines.join("\n") + "\n");
  const { rows } = show(r, { source: "unstaged", path: "f.txt" }, true);
  const body = rows.filter((x) => x.kind !== "@");
  assert.equal(body.length, 51);
  assert.equal(rows.filter((x) => x.kind === "+").length, 1);
  assert.equal(rows.filter((x) => x.kind === "-").length, 1);
});

test("rowsFromDiff: empty is no changes", () => {
  assert.deepEqual(rowsFromDiff(""), { message: "No changes in this file" });
});

test("a repo that colours every diff still gives plain rows", () => {
  const r = repo();
  write(r, "f.txt", "one\n"); const h = commit(r);
  git(r, ["config", "color.ui", "always"]);
  write(r, "f.txt", "two\n");
  assert.equal(kinds(show(r, { source: "unstaged", path: "f.txt" }).rows), "@-+");
  assert.equal(kinds(show(r, { source: "commit", path: "f.txt", commit: { hash: h } }).rows), "@+");
});

// ---- the Diff tab's header and line cap ----

test("scopeLabel names what is compared", () => {
  for (const s of ["unstaged", "staged", "untracked", "conflict"]) assert.equal(scopeLabel({ source: s, path: "p" }), s);
  assert.equal(scopeLabel({ source: "commit", path: "p", commit: { hash: "abcdef1234", short: "abcdef1", subject: "Fix login" } }), "commit abcdef1 Fix login");
  assert.equal(scopeLabel({ source: "commit", path: "p", commit: { hash: "abcdef1234" } }), "commit abcdef1");
  assert.equal(scopeLabel(null), "");
});

test("statusOf: U untracked, ! conflict, A and D from git's header, else M", () => {
  assert.equal(statusOf({ source: "untracked" }, ""), "U");
  assert.equal(statusOf({ source: "conflict" }, ""), "!");
  const r = repo();
  write(r, "gone.txt", "a\n"); write(r, "kept.txt", "a\n"); commit(r);
  git(r, ["rm", "-q", "gone.txt"]); write(r, "new.txt", "n\n"); git(r, ["add", "new.txt"]); write(r, "kept.txt", "b\n");
  const out = (source, path) => git(r, diffArgs({ source, path }));
  assert.equal(statusOf({ source: "staged" }, out("staged", "gone.txt")), "D");
  assert.equal(statusOf({ source: "staged" }, out("staged", "new.txt")), "A");
  assert.equal(statusOf({ source: "unstaged" }, out("unstaged", "kept.txt")), "M");
});

test("statOf counts added and removed rows", () => {
  assert.deepEqual(statOf(diffRows(["@@ -1,3 +1,2 @@", " a", "-b", "-c", "+d"])), { add: 1, del: 2 });
  assert.deepEqual(statOf([]), { add: 0, del: 0 });
});

test("capRows keeps the first DIFF_LINES rows and shortens long lines", () => {
  const many = Array.from({ length: DIFF_LINES + 5 }, (_, i) => ({ kind: "+", next: i + 1, text: "x" }));
  const capped = capRows(many);
  assert.equal(capped.rows.length, DIFF_LINES);
  assert.equal(capped.truncated, true);
  const long = capRows([{ kind: " ", old: 1, next: 1, text: "y".repeat(5000) }]);
  assert.equal(long.truncated, true);
  assert.equal(long.rows[0].text, "y".repeat(4000) + "…");
  assert.equal(long.rows[0].old, 1);
  const few = [{ kind: "+", next: 1, text: "z" }];
  assert.deepEqual(capRows(few), { rows: few, truncated: false });
});
