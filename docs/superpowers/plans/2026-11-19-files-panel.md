# Files in the Left Sidebar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** better-files lives as a **Files** tab in the left sidebar. It gets a git on/off switch, filetree's git extras, an agent-neutral Recent list, and "Show diff" opening git-graph's Diff tab.

**Architecture:** better-files comes into the repo with `scripts/upstream.sh`. The logic it gains goes into new pure modules (`files/git-extras.js`, `files/recent.js`) with tests. Its tree, viewer and menu get small hooks. better-sidebar gets a `switcher` view (Spaces | Agents | Files) above a layout stack holding its lists block and the better-files block. git-graph's Diff tab learns to take `props.target`.

**Tech Stack:** Herdr gpui-kit mods (JS); node `--test` (each mod's own harness); git CLI.

**Spec:** `docs/superpowers/specs/2026-11-19-files-panel-design.md`

## Global Constraints

- **Upstream:**
  - `scripts/upstream.sh add better-files https://github.com/munza/herdr-mods.git better-files main` puts it in folder `./better-files/`.
  - munza's LICENSE and NOTICE are copied into `better-files/`, as for better-sidebar and better-tabs.
  - Both READMEs get a "Changes in herdr-omni" section.
  - filetree ideas are credited as `cybertron288/herdr-mods filetree (MIT)`.
- **Shared keys:**
  - `better-files.git`: boolean, default `true`.
  - `better-files.recent`: `{ [folder]: [{ path, at }] }`, newest first, at most 100 per folder.
- **Recent skips:**
  - `.git`;
  - the filter's skipped folders: `node_modules`, `.venv`, `__pycache__`, `target`, `dist`, `.next`;
  - files Git ignores.
- **Git-graph handoff** (keys owned by git-graph, kept in step):
  - **Tabs:** `git-graph.diff-tabs` `{ [spaceId]: tabId }`.
  - **Open request:** `git-graph.diff-open` `{ [spaceId]: { target, at } }`.
  - **New tab:** `tab.new { name, mod: "git-graph", props: { view: "diff", target } }`.
  - **Target shape:** `{ root, on, path, source: "unstaged" }`. A file only in the index uses `"staged"` and an untracked file uses `"untracked"`.
- **Tests:**
  - better-files: `cd better-files && node --test tests/*.test.cjs`;
  - better-sidebar: `cd better-sidebar && node --test tests/*.test.cjs`;
  - git-graph: `cd git-graph && node --test tests/*.test.mjs`;
  - `herdr-app check` on each changed mod.
- **Scope:**
  - Agents read and run only inside `/Users/upgrade220/repos/herdr-omni` and `~/.config/herdr-app` (and the scratchpad). Never search `~`, `/Applications` or `~/Library`.
  - Throwaway git repos only. No employer names.
- **Mod rules:** no stored `cx`; no `run`/`setShared`/`notify`/`exec` in render.
- **Live app:** `sync.sh`, `herdr-app status` and one screenshot are allowed. Changing the user's focus, tabs or layout, or clicking, is not, except the layout edit in Task 7.

## Review Focus

1. A `git checkout` touching hundreds of files, or a change under `node_modules` or `.git`, never pushes Recent past 100 entries or lists skipped paths. Test in Task 3.
2. A folder that isn't a repo, or a repo with no commits: the summary is hidden and the tree still draws. Test in Task 2.
3. "Show diff" with no Diff tab open opens one that shows that file. Test in Task 5 (git-graph's `targetFromProps`).
4. After a restart, or after the sidebar collapses to the rail and expands again, the switcher shows the tab that's really visible. Test in Task 6 (`switcherState`).
5. A file deleted after it entered Recent shows struck through and doesn't crash on click. Test in Task 3 (`recentRows`).

---

### Task 1: Bring better-files in

- [ ] Run the `upstream.sh add` command from Global Constraints. Copy munza's `LICENSE`/`NOTICE`. Add a `sync.sh` like better-sidebar's. Add a root README row and a `better-files/README.md` "Changes in herdr-omni" section that lists the spec's changes.
- [ ] Baseline: `cd better-files && node --test tests/*.test.cjs` passes, and `herdr-app check better-files/mods/better-files` passes.
- [ ] `diff -rq better-files/mods/better-files ~/.config/herdr-app/mods/better-files`, ignoring `*.d.ts`, `jsconfig.json` and `.cache`. List any differences in the report.
- [ ] Commit `better-files: credit upstream, sync script`.

### Task 2: Git extras logic

**Files:** Create `better-files/mods/better-files/files/git-extras.js` (pure); Test `better-files/tests/git-extras.test.cjs`, using the same loader style as `tests/files.test.cjs`.

**Interfaces (produces):**
- `NUMSTAT = ["--no-optional-locks","diff","HEAD","--numstat","-z","--no-renames"]`. With no HEAD the caller skips it.
- `parseNumstat(stdout) -> { [path]: { add, del } }`. Binary files give `add: null, del: null`.
- `folderCounts(marks: { [path]: letter }) -> { [folder]: number }`. It counts changed files under each ancestor folder, relative paths, with `""` as the root.
- `BRANCH = ["--no-optional-locks","status","--porcelain=v2","--branch","-z"]`, then `parseBranch(stdout) -> { branch, ahead, behind } | null`.
- `summaryOf(marks, numstat, branchInfo) -> { branch, ahead, behind, add, del, modified, added, deleted } | null`. It returns null when `branchInfo` is null.
- `IGNORED = ["--no-optional-locks","ls-files","--others","--ignored","--exclude-standard","--directory","-z"]`, then `parseIgnored(stdout) -> Set<path>`. A directory entry ends in `/`. `isIgnored(set, path)` matches an entry or any ancestor directory.

- [ ] **Tests**, each on a temp repo where it says so:
  - numstat of a 3-line add and a 1-line delete gives `{a:{add:3,del:0}, b:{add:0,del:1}}`, and a binary file gives nulls;
  - `folderCounts({"src/a.js":"M","src/x/b.js":"A","c":"D"})` gives `{"":3, "src":2, "src/x":1}`;
  - `parseBranch` on a repo ahead 2 of its bare remote gives `{branch:"main", ahead:2, behind:0}`;
  - a repo with no commits: `parseBranch` gives `branch:"main"`, ahead and behind 0, and `summaryOf(...)` still works with an empty numstat (Review Focus 2);
  - `summaryOf(..., null)` gives `null` (not a repo);
  - `parseIgnored` with an ignored `dist/` makes `isIgnored(set, "dist/x/y.js")` true.
- [ ] Run RED, implement, then GREEN and the suite. Commit `better-files: git extras logic (counts, summary, ignored)`.

### Task 3: Recent logic

**Files:** Create `better-files/mods/better-files/files/recent.js` (pure); Test `better-files/tests/recent.test.cjs`.

**Interfaces (produces):**
- `SKIP_DIRS = [".git","node_modules",".venv","__pycache__","target","dist",".next"]`.
- `skipped(relPath) -> bool`: true if any path segment is in `SKIP_DIRS`.
- `record(list, relPath, at, max = 100) -> list`:
  - newest first;
  - the same path moves to the front with the new `at`;
  - cut to `max`;
  - unchanged when `skipped(relPath)`.
- `recentRows(list, exists: (path) => bool, now) -> [{ path, ago, gone }]`. `ago` is `now`/`Ns`/`Nm`/`Nh`/`Nd`, and `gone` is `!exists(path)`.

- [ ] **Tests:**
  - recording 150 distinct paths keeps 100, newest first (Review Focus 1);
  - re-recording an old path moves it to the front without duplicating it;
  - `node_modules/x/y.js` and `.git/index` are ignored (Review Focus 1);
  - `recentRows` marks a missing file `gone: true` (Review Focus 5), with `ago` of `"2m"` for 120 s.
- [ ] RED, implement, GREEN, suite. Commit `better-files: Recent logic`.

### Task 4: Git switch, extras and Recent in the views

**Files:**
- Modify `better-files/mods/better-files/files/reads.js`:
  - when git is on, read `NUMSTAT`, `BRANCH` and `IGNORED` alongside the status it reads now;
  - the existing folder watch calls `record` for each changed path relative to the folder, dropping Git-ignored paths, then saves to `shared("better-files.recent")` from the watch callback.
- Modify `views/tree.js`:
  - the header gets **Tree | Recent** and a git toggle, a branch icon that sets `better-files.git` in its click handler;
  - with git on, the summary line goes under the header (branch, `↑ahead ↓behind`, `+add −del`, and a small bar of modified, added and deleted counts);
  - with git on, rows get `+N −N` and folders a changed count, and ignored rows draw in `t.dim`;
  - with git off, there are no marks, extras, summary or dimming.
- Modify `views/viewer.js`: with git off, no changed-line tints, bars or Expand all.
- Create `views/recent.js`: the Recent list, using `recentRows`. Gone files are struck through, a click opens the file like a tree row, and a right-click gives the same menu.
- Modify `views/context-menu.js`: hide "Show diff" when git is off.

- [ ] Add a test only for new pure helpers.
- [ ] Check: suite, `herdr-app check`, `sync.sh`, `herdr-app status`, one screenshot of whatever is visible.
- [ ] Commit `better-files: git on/off, git extras, Recent`.

### Task 5: Show diff opens git-graph's Diff tab

**Files:**
- Modify `git-graph/mods/git-graph/diff-target.js` and add `targetFromProps(props) -> target | null`. It validates the shape (a string `root` and `path`, and a known `source`).
- Modify `git-graph/mods/git-graph/diff-view.js`: on init, a valid `props.target` is shown first, before the localStorage restore.
- Modify `better-files/mods/better-files/actions/open.js`:
  - replace the better-changes handoff with git-graph's keys from Global Constraints;
  - the root comes from `git rev-parse --show-toplevel`;
  - the source comes from the file's status letter: an untracked file maps to `"untracked"`, a file that is only staged maps to `"staged"`, and anything else maps to `"unstaged"`.
- Modify `actions/outside.js`: offer Show diff when `mods/git-graph/mod.json` exists, not better-changes.

- [ ] **Tests** (git-graph `tests/diff.test.mjs`): `targetFromProps({target:{root:"/r",path:"a b.js",source:"unstaged",on:null}})` returns it, and a missing path or an unknown source gives `null` (Review Focus 3).
- [ ] Add a better-files test for the status-to-source mapping if it is extracted as a pure helper.
- [ ] Run the suites of both mods, then check, sync and status. Commit `better-files, git-graph: Show diff opens the Diff tab`.

### Task 6: The sidebar switcher

**Files:**
- Modify `better-sidebar/mods/better-sidebar/main.js` to route `props.view === "switcher"`.
- Create `views/switcher.js`:
  - draws a strip like lists.js's Spaces | Agents tabs, adding Files;
  - Files runs `layout.select { stack: "sidebar-body", child: "files" }`;
  - Spaces and Agents run `layout.select { stack: "sidebar-body", child: "spaces" }` and set the lists tab through the shared key the lists view reads.
- Modify `views/lists.js`:
  - `props.strip === false` hides its own strip;
  - it reads the shared tab key so the switcher can set it;
  - the collapsed rail gets a Files icon that expands the sidebar (as the rail's expand does) and selects Files.
- Create `views/switcher-state.js` (pure) with `switcherState(tree, listsTab) -> "spaces"|"agents"|"files"`, read from the `sidebar-body` stack's active child in `layout()`.
- Add a `better-sidebar.files` action for keys: it selects Files, then runs `better-files.focus`.

- [ ] **Tests** (better-sidebar):
  - `switcherState` with the stack active `files` gives `"files"`;
  - with the stack on `spaces` and listsTab `"agents"`, it gives `"agents"`;
  - with no stack in the tree, it gives listsTab (Review Focus 4).
- [ ] RED, implement, GREEN, suite, check. Commit `better-sidebar: Spaces | Agents | Files switcher`.

### Task 7: Layout, keys, install, docs

**Files:** `~/.config/herdr-app/layouts/main-graph.json` (backed up to the scratchpad first), `~/.config/herdr-app/keys.json`, and the README sections.

- [ ] **Layout:**
  - In the sidebar, replace `sidebar-lists` with:
    - a `switcher` block (`better-sidebar`, `view: "switcher"`, about 40 px);
    - a stack `sidebar-body` with children `spaces` (the existing lists block plus `strip: false`) and `files` (`better-files`).
  - Remove the Files button and the right-panel `files` block. Any stack `active` that was `files` there becomes `graph`.
  - Validate with `herdr-app status` (no errors).
- [ ] **Keys:** `cmd-shift-e` → `mod.action:better-sidebar.files` (check the exact action syntax in AGENTS.md), only if it is unbound. Otherwise skip it and say so.
- [ ] Run `sync.sh` for better-files, better-sidebar and git-graph, then `herdr-app status` and one screenshot.
- [ ] Bring the README sections up to date. Commit `docs: Files in the sidebar`.
