# git-graph Diff Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One reusable Diff tab per space in git-graph, which shows a file's diff inline or side by side, opened from Changes and from commit details.

**Architecture:**
- Pure ported pieces (rows, side-by-side pairing, conflict rows, syntax lexer) and the git-argument choice live in node-testable modules.
- A new `diff-view.js` renders the tab as git-graph's `props.view: "diff"`.
- A small `diff-open.js` hands a target to the space's Diff tab through shared keys, and Changes and commit details call it instead of drawing their own diffs.

**Tech Stack:** Herdr gpui-kit mods (JS); node `--test` + `node:assert`; git CLI.

**Spec:** `docs/superpowers/specs/2026-11-19-git-graph-diff-tab-design.md`

## Global Constraints

- **Ported files** carry the line `Ported from better-changes (https://github.com/munza/herdr-mods, Apache-2.0).`
  - Sources are under `~/.config/herdr-app/mods/better-changes/`: `views/diff.js`, `syntax.js`, `git/model.js`.
  - Upstream tests: `https://github.com/munza/herdr-mods/blob/main/better-changes/tests/changes.test.cjs`.
- **Shared keys:**
  - `git-graph.diff-tabs`: `{ [spaceId]: tabId }`.
  - `git-graph.diff-open`: `{ [spaceId]: { target, at } }`.
  - `git-graph.diff-layout`: `"inline"` | `"split"`, default `"inline"`.
  - `git-graph.diff-full`: boolean, default false.
- **Target** is `{ root, on, path, source, commit? }`:
  - `source` is one of `unstaged` | `staged` | `untracked` | `conflict` | `commit`;
  - `commit` is `{ hash, short, subject }`.
- **Every git call** goes through `exec("git", args, { cwd: root, on })`, and path arguments use `--literal-pathspecs`.
- **Tab:** named after the file's base name, icon `mods/git-graph/icons/graph.svg`, opened with `tab.new { name, mod: "git-graph", props: { view: "diff" } }`.
- **Messages, exact:**
  - `Binary file, no text diff`
  - `No changes in this file`
  - `Pick a file in Changes or in a commit to see its diff.`
- **Tests:** `cd git-graph && node --test tests/*.test.mjs`. `herdr-app check git-graph/mods/git-graph` must pass.
- **Test repos:** throwaway repos in `os.tmpdir()` with `GIT_CONFIG_GLOBAL=/dev/null`. Never write to real projects.
- **Mod rules:**
  - no stored `cx`;
  - no `run`/`setShared`/`notify`/`exec` in render;
  - no employer names in files.
- **Live app:**
  - install with `git-graph/sync.sh`, then check `herdr-app status` has no errors and take one screenshot;
  - don't change the user's focus, tabs or layout;
  - don't run git actions there.

## Review Focus

1. A path with a space, non-ASCII, or `*` diffs only that file (literal pathspecs). Test in Task 1.
2. A deleted file shows every line removed, an untracked file every line added, and a binary file shows `Binary file, no text diff`. Test in Task 1.
3. A root commit's file shows as all added, and a merge commit diffs against its first parent. Test in Task 1.
4. A recorded Diff tab that was closed counts as none, so the next click opens a new tab instead of selecting a dead id. Test in Task 2.
5. A second file click while the Diff tab exists retargets that tab. It does not open another. Test in Task 2.

---

### Task 1: Ported diff logic and git arguments

**Files:**
- Create: `mods/git-graph/diff-rows.js`. Port `diffRows` (old/next numbers), `splitDiffRows` and `conflictRows` from better-changes `git/model.js`.
- Create: `mods/git-graph/syntax.js`, better-changes' `syntax.js` verbatim plus the credit line.
- Create: `mods/git-graph/diff-target.js`.
- Test: `tests/diff.test.mjs`.

**Interfaces (produces):**
- `diffRows(lines: string[]) -> Row[]`, where a Row is `{ kind: "@"|"+"|"-"|" "|"", old?, next?, text }`.
- `splitDiffRows(rows) -> Pair[]`, as better-changes.
- `conflictRows(text) -> Row[] | null`, as better-changes.
- `languageOf(path)`, `syntaxColors(t)`, `tokenizeLine(line, language, state)`, as better-changes.
- `diffArgs(target, full: boolean) -> string[] | null`:
  - `unstaged`: `["--literal-pathspecs","diff", …full?["--unified=1000000"]:[] ,"--",path]`.
  - `staged`: the same with `--cached`.
  - `commit`: `["--literal-pathspecs","show","--diff-merges=first-parent","--format=", …full, hash,"--",path]`.
  - `untracked` and `conflict`: `null`, because the view reads the file itself.
- `untrackedRows(text: string|null) -> { rows } | { message }`:
  - null text → `{ message: "No changes in this file" }`;
  - text containing NUL → `{ message: "Binary file, no text diff" }`;
  - otherwise every line becomes a `+` row with `next` numbers;
  - capped at 3000 lines.
- `rowsFromDiff(stdout: string) -> { rows } | { message }`:
  - empty → `No changes in this file`;
  - `Binary files … differ` → `Binary file, no text diff`;
  - otherwise rows with the header lines (`diff --git`, `index`, `---`, `+++`) dropped.

- [ ] **Step 1: Write the failing tests.** Port better-changes' tests for `diffRows`, `splitDiffRows` and `conflictRows` from its `changes.test.cjs` as `node:test` tests. Then add these, each on a temp repo, running `git` with `diffArgs` and feeding `rowsFromDiff`:
  - an unstaged edit of `a b/ç*.txt` next to a file `a b/çx.txt` that is also edited gives rows for that one file only (Review Focus 1);
  - a staged edit with `--cached` gives the staged side only;
  - a staged deletion gives only `-` rows (Review Focus 2);
  - `untrackedRows("x\ny\n")` gives 2 `+` rows, and `untrackedRows("a\0b")` gives `{message:"Binary file, no text diff"}`;
  - a committed binary file gives `{message:"Binary file, no text diff"}`;
  - the root commit's file gives only `+` rows (Review Focus 3);
  - a merge commit's file gives its first-parent diff (Review Focus 3);
  - `full=true` on a 50-line file with one change gives 50 rows and one `+`/`-` pair;
  - `diffArgs({source:"untracked"})` is `null`.
- [ ] **Step 2:** Run the tests and see them fail with ERR_MODULE_NOT_FOUND.
- [ ] **Step 3:** Port the code and implement `diff-target.js`.
- [ ] **Step 4:** The full suite passes and `herdr-app check` passes.
- [ ] **Step 5:** Commit `git-graph: diff rows, syntax colours and diff arguments (ported from better-changes)`.

### Task 2: Finding and feeding the space's Diff tab

**Files:** Modify `mods/git-graph/place.js` (pure additions); Test `tests/place.test.mjs`.

**Interfaces (produces):**
- `DIFF_TABS = "git-graph.diff-tabs"`, `DIFF_OPEN = "git-graph.diff-open"`, `DIFF_LAYOUT = "git-graph.diff-layout"`, `DIFF_FULL = "git-graph.diff-full"`.
- `diffTabOf(map, spaces, spaceId) -> tabId | null`: the recorded tab, only if it is still among that space's tabs.
- `openDiffPlan({ map, spaces, spaceId, target, now }) -> { select: tabId | null, newTab: { name } | null, open: { [spaceId]: { target, at: now } } }`:
  - selects the live recorded tab;
  - otherwise asks for a new tab named after `target.path`'s base name.
- `pendingTarget(openMap, spaceId, seenAt) -> { target, at } | null`: the entry for the space when its `at` is newer than `seenAt`.

- [ ] **Step 1: Tests.**
  - `diffTabOf` with a recorded id that isn't in the space's tabs gives `null` (Review Focus 4).
  - `openDiffPlan` with a live recorded tab gives `select: id, newTab: null` (Review Focus 5).
  - `openDiffPlan` with no tab gives `newTab: { name: "cart.js" }` for `src/shop/cart.js`.
  - `pendingTarget` ignores an entry whose `at <= seenAt` and an entry for another space.
- [ ] **Steps 2–4:** RED, then implement, then GREEN and the suite. Commit `git-graph: find and feed the space's Diff tab`.

### Task 3: The Diff tab view

**Files:**
- Create: `mods/git-graph/diff-view.js`, ported from better-changes `views/diff.js` (rendering parts) with the credit line.
- Modify: `main.js` so that `props.view === "diff"` gives a `DiffView` instead of `Graph`.

**Interfaces:**
- **Consumes:** Task 1 (`diffArgs`, `rowsFromDiff`, `untrackedRows`, `diffRows`, `splitDiffRows`, `conflictRows`, syntax) and Task 2 (`DIFF_TABS`, `DIFF_OPEN`, `DIFF_LAYOUT`, `DIFF_FULL`, `pendingTarget`).
- **Produces:** `class DiffView` with `init(cx)` and `render(cx)`.

**Behaviour:**
- **Startup:**
  - On init, the view registers itself in `DIFF_TABS` for its space with its own tab id, found from `focused()` when it was just opened or selected, as omni-forge's full view finds its `ownTab`.
  - It restores its last target from `localStorage` (`target`).
- **Taking a target:** a timer tick of about 300 ms takes a newer `pendingTarget` for its space. It saves the target, retitles itself with `run("tab.rename", { id, name })` from the tick (not from render), and loads it.
- **Loading:**
  - `untracked` reads the file through `readTextFile(root + "/" + path, { on })` and uses `untrackedRows`.
  - `conflict` follows better-changes' `readConflict`.
  - Everything else runs `exec` with `diffArgs` and uses `rowsFromDiff`.
  - A stale-load guard drops results for a target that is no longer current.
- **Header:**
  - the status letter, the file icon (better-icons via `file-icons.js`), the path, `+a −d`;
  - the scope: `unstaged`, `staged`, `untracked`, `conflict` or `commit <short> <subject>`;
  - an **Inline | Side by side** switch, which sets `DIFF_LAYOUT` in its click handler;
  - a **Full file** toggle that sets `DIFF_FULL`, hidden for `untracked` and `conflict`.
- **Body:** better-changes' inline and side-by-side rows with syntax colours, the conflict view, and the line cap note.
- **Empty state:** `Pick a file in Changes or in a commit to see its diff.`
- **Refresh:** a working-tree target re-reads when `shared("git-graph.changed")` changes, checked in the tick. Commit targets never re-read.

- [ ] **Step 1:** Add a test only for any new pure helper.
- [ ] **Step 2:** Port and implement.
- [ ] **Step 3:** The suite passes, `herdr-app check` passes, then install with `sync.sh`, check `herdr-app status` (no errors) and take one screenshot.
- [ ] **Step 4:** Commit `git-graph: the Diff tab (inline or side by side)`.

### Task 4: Open it from Changes and commit details

**Files:**
- Create: `mods/git-graph/diff-open.js`, with `openDiff(target)`. It reads `focused()`, `spaces()` and `shared(DIFF_TABS)` and applies `openDiffPlan`: `setShared(DIFF_OPEN, …)`, then `run("tab.select", { id })` or `run("tab.new", { name, mod: "git-graph", props: { view: "diff" } })`. It is called only from click handlers.
- Modify `changes-view.js`:
  - a file click calls `openDiff` with the row's source (`staged` / `unstaged` / `untracked` / `conflict`);
  - remove the in-panel diff, the "← Changes" link and their state;
  - Esc no longer handles a diff.
- Modify `graph.js`:
  - in `detailsPane`, a file click calls `openDiff` with `source: "commit"` and `commit: { hash, short, subject }`;
  - files of the "Uncommitted changes" row map to `staged`, `unstaged` or `untracked` from the status;
  - remove the strip's own diff view ("← Files") and `openDiff`'s old state.
- Modify `git-graph/README.md` ("Changes in herdr-omni"): describe the Diff tab and credit better-changes (Apache-2.0).

- [ ] **Step 1:** Test any new pure helper. For example, mapping an uncommitted file to its source belongs in `changes.js`.
- [ ] **Step 2:** Implement.
- [ ] **Step 3:** The suite passes, `herdr-app check` passes, `sync.sh`, `herdr-app status` and one screenshot.
- [ ] **Step 4:** Commit `git-graph: Changes and commit files open in the Diff tab`.
