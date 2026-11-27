# omni-forge part 2 (MRs/PRs) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** GitLab merge requests and GitHub pull requests ("MRs") inside omni-forge: a side list, an MR page in the full tab, the MR lifecycle without merge, and changed files shown in git-graph's Diff tab from a cache repo outside the user's repo.

**Architecture:** The forge providers (`forge/gitlab.js`, `forge/github.js`) gain one normalized MR interface. A pure list module and an `MrList` helper serve both the new side view (`view: "mrs"`) and a fixed MRs tab in the full view; each opened MR is a full-view item tab (`views/mr-page.js`). Changes are fetched into a bare cache repo that borrows the user's objects through git alternates (`forge/mr-cache.js`) and handed to git-graph's Diff tab as a new `range` target.

**Tech Stack:** Herdr gpui-kit JS mods; `gh` / `glab` CLIs (`gh api`, `gh api graphql`, `glab api`, `glab api graphql`); git; node `--test` with the vm loaders already in each mod.

**Spec:** `docs/superpowers/specs/2026-11-26-omni-forge-mrs-design.md`

## Global Constraints

- Herdr mod rules (`~/.config/herdr-app/AGENTS.md`): no stored `cx`; no `run`/`setShared`/`notify`/`exec` in render; `herdr-app check <mod folder>` must pass.
- Mods can't import each other: omni-forge keeps a copy of git-graph's Diff handoff keys and plan, with a test that they match.
- Nothing is written to the user's repo to view changes: no refs, config, objects or working-tree change. The cache is `<appHome>/data/omni-forge/mr-cache/<host>/<path>.git` locally, `~/.cache/omni-forge/mr-cache/<host>/<path>.git` on a space's other machine.
- Fetched refs into the cache: `refs/omni-forge/mr/<n>/head` from `refs/merge-requests/<n>/head` (GitLab) or `refs/pull/<n>/head` (GitHub), and `refs/omni-forge/mr/<n>/base` from the target branch.
- Range is always `base...head` (merge base).
- No Merge button anywhere. No tokens stored. `gh`/`glab` run on this computer; git runs on the space's machine.
- Open MRs only in lists. Polling only while shown: list every 30 s, an open MR page every 15 s, back off on errors (reuse `ci/poller.js`'s `nextDelay` doubling, capped 5 min). No notifications.
- Chips: **To review** (I'm a reviewer and haven't approved; the default), **Mine** (I'm the author), **All open**.
- Cache: an MR's refs are deleted when it's merged or closed and no MR tab shows it; a project cache unused 14 days is deleted; checked at omni-forge start and once a day.
- Tests only against throwaway repos and synthetic fixtures; never write actions against real projects. Public repo: examples use `git.example.org`, `group/app`; no employer names.
- Test commands: omni-forge `cd omni-forge && node --test tests/*.test.cjs`; git-graph `cd git-graph && node --test tests/*.test.mjs` (Node 26 rejects a bare dir).

## Review Focus

1. An MR whose source branch was deleted or force-pushed: the fetch of `refs/merge-requests/<n>/head` / `refs/pull/<n>/head` still works (those refs survive); a fetch failure shows the error with Open in browser, never a blank Diff tab. → Task 2 test "fetch failure returns the git error".
2. The user's repo garbage-collected objects the cache borrowed: `git diff` in the cache fails with "bad object" / "missing" → wipe and refetch once, not loop. → Task 2 test "missing objects wipe and refetch once".
3. A user who is both author and reviewer, or reviewer who already approved: To review excludes approved, Mine still counts it. → Task 5 test.
4. Repo switch while an MR page is loading or an action is running: results for the old repo are dropped (the `gen` guard RepoView uses). → Task 7 test "a late reply for another repo is dropped".
5. Empty or whitespace comment/reply/title submissions do nothing and don't call the forge. → Task 8 test.

---

### Task 1: git-graph Diff tab: the `range` source

**Files:**
- Modify: `git-graph/mods/git-graph/diff-target.js` (`diffArgs`, `targetFromProps`/`SOURCES`, `scopeLabel`)
- Modify: `git-graph/mods/git-graph/diff-view.js` only if a code path assumes a working tree for every source (check the read at ~line 186-210)
- Test: `git-graph/tests/diff.test.mjs`

**Interfaces:**
- Produces: target `{ root, on, path, source: "range", gitDir: string, base: string, head: string, label?: string }`; `diffArgs` → `["--git-dir=<gitDir>", "--literal-pathspecs", "diff", ...PLAIN, ...(full ? [FULL] : []), "<base>...<head>", "--", path]` (the `--git-dir` first: it's a global option; the caller prefixes `READ`).

- [ ] **Step 1: failing tests** in `diff.test.mjs`:
  - `diffArgs` for `{source:"range", gitDir:"/c.git", base:"refs/omni-forge/mr/7/base", head:"refs/omni-forge/mr/7/head", path:"a.js"}` equals the array above, with and without `full`.
  - `targetFromProps({target:{root:"/r", path:"a.js", source:"range", gitDir:"/c.git", base:"b", head:"h"}})` returns the target; missing `gitDir`, `base` or `head` → null.
  - `scopeLabel` of a range target with `label: "!7"` → `"!7"`; without → `"b...h"`.
  - In a throwaway repo pair (bare cache with `objects/info/alternates` → work repo's objects, refs created with `git update-ref` in the cache), running `git` with `[...READ, ...diffArgs(target)]` from the work repo's root returns rows via `rowsFromDiff` with the expected `+` line.
- [ ] **Step 2:** run `cd git-graph && node --test tests/*.test.mjs` → the new tests FAIL.
- [ ] **Step 3:** implement in `diff-target.js`; add `"range"` to `SOURCES` with the field check.
- [ ] **Step 4:** run the suite → PASS; `herdr-app check git-graph/mods/git-graph` → passes.
- [ ] **Step 5:** commit `git-graph: Diff tab range source (a cache git dir, base...head)`.

### Task 2: the MR cache repo

**Files:**
- Create: `omni-forge/mods/omni-forge/forge/mr-cache.js` (no herdr import; `exec` passed in)
- Test: `omni-forge/tests/mr-cache.test.cjs` (real git in `os.tmpdir()`, via a small exec adapter over `child_process.execFile`)

**Interfaces:**
- Produces:
  - `cacheDir({ local: boolean, appHome: string, home: string, host, path }) -> string`
  - `MR_REFS(n) -> { head: "refs/omni-forge/mr/<n>/head", base: "refs/omni-forge/mr/<n>/base" }`
  - `sourceRef(kind, n) -> "refs/merge-requests/<n>/head" | "refs/pull/<n>/head"`
  - `async fetchMr(exec, { on, repoRoot, dir, url, kind, number, target }) -> { ok: true, refs } | { ok: false, error: string }`: creates the bare repo when missing (`git init --bare`), writes `objects/info/alternates` with the absolute path of `git -C repoRoot rev-parse --git-common-dir` + `/objects`, fetches `+<sourceRef>:<head>` and `+refs/heads/<target>:<base>` from `url` with `--no-tags`, then touches `<dir>/omni-forge-used`.
  - `async diffOk(exec, { on, dir, refs })`: `git --git-dir=dir rev-parse --verify <head>^{commit} <base>^{commit}`.
  - `async ensureMr(exec, opts)`: `fetchMr`, then `diffOk`; on an error matching `/bad object|missing|could not read|unable to read/i` removes `dir` and fetches once more; returns `fetchMr`'s shape.
  - `async dropMr(exec, { on, dir, number })`: `git update-ref -d` both refs.
  - `async pruneStale(exec, { on, root, days = 14, now })`: deletes cache dirs under `root` whose `omni-forge-used` is older than `days` (one `sh -c` with `find <root> -name omni-forge-used -mtime +14`).
- [ ] **Step 1: failing tests:** `cacheDir` both ways (`/h/.config/herdr-app/data/omni-forge/mr-cache/git.example.org/group/app.git`, `/home/u/.cache/omni-forge/mr-cache/...`); `sourceRef` both kinds; in tmp: a bare "remote" with `refs/merge-requests/3/head` pointing at a feature commit and `main`, a clone as the user's repo →
  - "fetchMr fills the cache and leaves the user's repo untouched": refs resolve in the cache; the user repo's `git for-each-ref` output, `.git/config` bytes and `git count-objects -v` are identical before and after.
  - "fetch failure returns the git error": a bad `url` → `{ ok:false, error }` with git's message.
  - "missing objects wipe and refetch once": after a successful fetch, delete a loose object the cache borrows from the user repo (`git -C user gc --prune=now` after resetting a branch away) → `ensureMr` returns ok and the fetch ran exactly twice (count calls through the exec adapter).
  - `dropMr` removes both refs; `pruneStale` deletes a dir whose stamp is set 15 days back (`touch -t`) and keeps a fresh one.
- [ ] **Step 2:** `cd omni-forge && node --test tests/*.test.cjs` → FAIL.
- [ ] **Step 3:** implement.
- [ ] **Step 4:** suite PASS.
- [ ] **Step 5:** commit `omni-forge: MR cache repo outside the user's repo`.

### Task 3: MR model and the GitLab provider

**Files:**
- Modify: `omni-forge/mods/omni-forge/forge/model.js` (shape comments + `mrStateOf`)
- Modify: `omni-forge/mods/omni-forge/forge/gitlab.js` (MR reads and writes; `rest()` takes a method)
- Create fixtures: `omni-forge/tests/fixtures/gitlab-mrs.json`, `gitlab-mr-detail.json` (synthetic, `git.example.org`, `group/app`)
- Test: `omni-forge/tests/gitlab-mr.test.cjs` (the `recorder` pattern from `gitlab.test.cjs`)

**Interfaces:**
- Produces (both providers implement it; GitHub in Task 4):
  - `MR = { number, title, author, source, target, draft, state: "open"|"merged"|"closed", url, updatedAt, pipeline: Status|null, pipelineRunId: string|null, approvals: number, approvalsRequired: number|null, approvedBy: string[], reviewers: string[], assignees: string[], unresolved: number, headSha }`
  - `Thread = { id, resolvable, resolved, notes: { id, author, body, createdAt, system: boolean }[], path: string|null, line: number|null }`
  - `MrDetail = { mr: MR, description, threads: Thread[], files: { path, add, del, status }[] }`
  - `listMrs() -> { me: string, mrs: MR[] }` (open only, newest update first, up to 50, one GraphQL query incl. `currentUser{username}`)
  - `mrDetail(number) -> MrDetail`
  - writes, each `-> void`: `approve(n)`, `unapprove(n)`, `comment(n, body)`, `reply(n, threadId, body)`, `resolve(n, threadId, resolved)`, `update(n, { title?, description? })`, `setDraft(n, draft)`, `setReviewers(n, usernames)`, `setAssignees(n, usernames)`, `close(n)`, `reopen(n)`
  - `createMr({ source, target, title, description, draft, reviewers }) -> MR`
  - `searchUsers(query) -> { username, name }[]` (project members)
  - `defaultBranch() -> string`
  - `capabilities.mr = { revoke: true }` (GitLab)
- GitLab specifics: GraphQL `project.mergeRequests(state: opened, sort: UPDATED_DESC, first: 50)` with `reviewers`, `approvedBy`, `approvalsRequired`, `assignees`, `headPipeline{id status}`, `userDiscussionsCount`/resolvable counts; writes through REST (`POST .../approve`, `.../unapprove`, `.../notes`, `.../discussions/:id/notes`, `PUT .../discussions/:id?resolved=`, `PUT .../merge_requests/:iid` with `title`, `description`, `reviewer_ids`, `assignee_ids`, `state_event=close|reopen`); draft through GraphQL `mergeRequestSetDraft`; usernames → ids via `GET projects/:id/members/all?query=`.
- [ ] **Step 1: failing tests:** `listMrs` maps the fixture (me, approvals `1`/`2`, unresolved count, draft, pipeline status via the existing `mapStatus`); `mrDetail` threads keep order, system notes flagged, line threads carry `path`/`line`; each write calls the expected `glab api` method + endpoint + fields (assert on recorded args); `createMr` posts `source_branch`, `target_branch`, `title` prefixed `Draft: ` when draft.
- [ ] **Step 2:** FAIL. **Step 3:** implement. **Step 4:** PASS.
- [ ] **Step 5:** commit `omni-forge: GitLab merge requests in the provider`.

### Task 4: the GitHub provider

**Files:**
- Modify: `omni-forge/mods/omni-forge/forge/github.js`
- Create fixtures: `github-prs.json`, `github-pr-detail.json` (synthetic)
- Test: `omni-forge/tests/github-mr.test.cjs`

**Interfaces:**
- Consumes: the MR interface from Task 3 (same names and shapes).
- GitHub specifics: one `gh api graphql` query for the list (`viewer{login}`, `repository.pullRequests(states: OPEN, orderBy: UPDATED_AT DESC, first: 50)` with `reviewRequests`, `latestReviews`, `assignees`, `reviewThreads{isResolved}`, `commits(last:1){commit{oid statusCheckRollup{state}}}`); `approvalsRequired` null unless branch protection is readable; `pipelineRunId` = newest workflow run for `headSha` (`GET actions/runs?head_sha=`), fetched in `mrDetail` only. Writes: `POST pulls/:n/reviews {event: APPROVE}`; `comment` → `POST issues/:n/comments`; `reply` → `POST pulls/:n/comments/:id/replies`; `resolve` → GraphQL `resolveReviewThread`/`unresolveReviewThread`; `setDraft` → `convertPullRequestToDraft` / `markPullRequestReadyForReview`; reviewers → `POST`/`DELETE pulls/:n/requested_reviewers`; assignees → `POST`/`DELETE issues/:n/assignees`; close/reopen/update → `PATCH pulls/:n`; `createMr` → `POST pulls {head, base, title, body, draft}`; `searchUsers` → `GET repos/:p/collaborators` filtered locally. `capabilities.mr = { revoke: false }`; `unapprove` throws.
- [ ] **Step 1: failing tests** mirroring Task 3's (list mapping, detail threads incl. review-comment threads with path/line, each write's recorded args, `unapprove` rejects).
- [ ] **Step 2:** FAIL. **Step 3:** implement. **Step 4:** PASS.
- [ ] **Step 5:** commit `omni-forge: GitHub pull requests in the provider`.

### Task 5: MR list logic and `MrList`

**Files:**
- Create: `omni-forge/mods/omni-forge/views/mrs.js` (pure), `omni-forge/mods/omni-forge/views/mr-list.js` (`MrList`: data, polling, chips, filter, rows)
- Test: `omni-forge/tests/mrs.test.cjs`

**Interfaces:**
- Produces:
  - `MR_CHIPS = [{id:"review",label:"To review"},{id:"mine",label:"Mine"},{id:"all",label:"All open"}]`
  - `chipOfMr(mr, me) -> Set<"review"|"mine">`; `mrCounts(mrs, me) -> {review, mine, all}`; `filterMrs(mrs, { chip, text, me }) -> MR[]` (text matches title, `!n`/`#n`, author, source)
  - `mrNumber(kind, n) -> "!n" | "#n"`
  - `class MrList { constructor(owner); load(cx); tickDue(now) -> boolean; setChip(id, cx); render(t, { compact, onOpen }) }` where `owner` gives `{ provider, repo, gen, pollVisible() }`; chip default `"review"`; poll delay `nextDelay({ visible, anyRunning: false, errors })` with the 30 s base.
- [ ] **Step 1: failing tests:** a reviewer who approved isn't in To review; author+reviewer counts in both Mine and To review until approved; filter by `!412`, by author, by branch; counts; `mrNumber`; `MrList.load` with a stub provider stores `me`/`mrs` and drops a result whose `gen` changed (Review Focus 3).
- [ ] **Step 2:** FAIL. **Step 3:** implement; rows follow the spec sketch using `views/ui.js` (`statusPill`, `pill`, `tabPill`) — title, number, author, source → target, Draft, pipeline pill, `✓a/r` (or `✓a`), `💬n`, age (`ago` from `views/runs.js`). **Step 4:** PASS.
- [ ] **Step 5:** commit `omni-forge: MR list (chips, filter, rows)`.

### Task 6: the MRs side view and the full view's MRs tab

**Files:**
- Create: `omni-forge/mods/omni-forge/views/mr-side.js` (`MrSideView extends RepoView`, uses `MrList`; no watch tick)
- Modify: `main.js` (`PARTS.mrs = MrSideView`), `views/tabs.js` (fixed `{id:"mrs",kind:"mrs",label:"MRs"}` after Runs; `openMr({number,title})` → item tab `mr:<n>`, sharing `MAX_TABS`), `views/full.js` (MRs tab body = `MrList`; `OPEN` key `mrs` and `mr:<host>|<path>|<n>`), `views/locate.js` (`MRS_KEY = "mrs"`, `mrKey(repo, n)`, `parseOpen` accepts MR keys; side visibility for block id `mrs`)
- Test: `omni-forge/tests/tabs.test.cjs`, `full.test.cjs`, new `mr-side.test.cjs`

**Interfaces:**
- Consumes: `MrList` (Task 5), providers (Tasks 3-4).
- Produces: `Tabs.openMr({ number, title }) -> tab` with `tab.kind === "mr"`, `tab.number`; `mrKey({kind,host,path}, n) -> string`; `FullView.openMr(number, cx)` (creates the tab; the page comes in Task 7 — until then the tab body says "Loading…").
- [ ] **Step 1: failing tests:** Tabs: MRs is never closed or evicted, order Runs, MRs, items; `openMr` twice selects the same tab; side: a row click sets `shared(OPEN)` to `{tab, key: mrKey(...)}` and selects the full tab, or `tab.new` with `props.open`; full: an `OPEN` with an MR key opens that MR tab; `MRS_KEY` selects the MRs tab.
- [ ] **Step 2:** FAIL. **Step 3:** implement. **Step 4:** PASS; `herdr-app check omni-forge/mods/omni-forge` passes.
- [ ] **Step 5:** commit `omni-forge: MRs side view and MRs tab`.

### Task 7: the MR page (read side) and Diff handoff

**Files:**
- Create: `omni-forge/mods/omni-forge/views/mr-page.js` (`MrPage`: load, poll every 15 s while selected, render header / description / discussion / files)
- Create: `omni-forge/mods/omni-forge/actions/diff.js` (copy of git-graph's `DIFF_TABS`, `DIFF_OPEN`, `PENDING_MS`, `diffTabOf`/`openDiffPlan` logic, plus `openMrFile(...)` that runs `ensureMr` then hands `{root, on, path, source:"range", gitDir, base, head, label}` over)
- Modify: `views/full.js` (item tab kind `mr` renders `MrPage`; `dropTab` drops it)
- Test: `omni-forge/tests/mr-page.test.cjs`, `omni-forge/tests/diff-handoff.test.cjs`

**Interfaces:**
- Consumes: `mrDetail`, `ensureMr`/`cacheDir`/`MR_REFS` (Task 2), `mrKey` (Task 6).
- Produces: `class MrPage { constructor(owner, number); load(cx); render(t); }`; `openMrFile({ repo, loc, mr, path }) -> Promise<{ ok, error? }>`.
- Page content: header (title, number, state, author, source → target, pipeline pill → opens `run:<pipelineRunId>` in the CI part via the existing `openRun`, approvals, Open in browser); description as wrapped text; discussion (threads with replies, author, `ago`; system notes hidden except approvals and "added N commits", dimmed; line threads show `path:line` which opens that file via `openMrFile`); files with `+a −d`, click → `openMrFile`. A failed fetch shows the git error and Open in browser in the page, not a toast.
- [ ] **Step 1: failing tests:** diff-handoff copy equals git-graph's exports (import git-graph's `place.js` source through the loader and compare constants and plan outputs for the same inputs, as `better-files/tests/diff-handoff.test.cjs` does); `openMrFile` sets `DIFF_OPEN` with a `range` target whose `gitDir` is `cacheDir(...)` and refs `MR_REFS(n)`; a fetch failure returns `{ok:false}` and leaves `DIFF_OPEN` alone; "a late reply for another repo is dropped" (Review Focus 4); system-note filtering keeps approvals and commit notes only.
- [ ] **Step 2:** FAIL. **Step 3:** implement. **Step 4:** PASS; `herdr-app check` passes.
- [ ] **Step 5:** commit `omni-forge: MR page and changed files in the Diff tab`.

### Task 8: MR page actions

**Files:**
- Modify: `omni-forge/mods/omni-forge/views/mr-page.js`
- Create: `omni-forge/mods/omni-forge/views/people.js` (reviewer/assignee picker: input + matches from `searchUsers`, chosen chips)
- Test: `omni-forge/tests/mr-page.test.cjs`

**Interfaces:**
- Consumes: provider writes (Tasks 3-4).
- Produces: `MrPage.act(cx, id, fn)` (busy per action id, error shown on the page, reload after; same shape as `Detail.act` in `views/detail.js`).
- Buttons: Approve / Revoke (Revoke only when `capabilities.mr.revoke`), Reply + Resolve/Unresolve per resolvable thread, new comment box, Edit (title + description inline, Save/Cancel), Mark as ready / Mark as draft, Reviewers…, Assignees…, Close / Reopen, Open in browser. No Merge.
- [ ] **Step 1: failing tests:** each button calls its provider method with the right args and reloads; empty/whitespace comment, reply and title do nothing and make no call (Review Focus 5); Revoke hidden on GitHub; there is no element id containing `merge`.
- [ ] **Step 2:** FAIL. **Step 3:** implement. **Step 4:** PASS.
- [ ] **Step 5:** commit `omni-forge: MR actions (approve, discuss, edit, draft, people, close)`.

### Task 9: New MR

**Files:**
- Create: `omni-forge/mods/omni-forge/views/new-mr.js` (dialog part, `props.view: "new-mr"`, opened with `openOverlay({ mod: "omni-forge", kind: "dialog", width: 520, height: 560, props: { view: "new-mr", repo, loc } })`)
- Modify: `main.js` (`PARTS["new-mr"]`), `views/mr-list.js` (a **New MR** button in the list header)
- Test: `omni-forge/tests/new-mr.test.cjs`

**Interfaces:**
- Consumes: `createMr`, `defaultBranch`, `searchUsers`, people picker (Task 8); the branch's upstream via `git rev-parse --abbrev-ref --symbolic-full-name @{u}` on the space's machine.
- Form: source = current branch (read-only); target = `defaultBranch()` (editable text); title = last commit subject (`git log -1 --format=%s`); description; Draft toggle; reviewers. With no upstream: a notice and **Push branch first** that runs `git push --set-upstream <remote> <branch>` with the remote picked from `git remote` (prefer `origin`), then enables Create. Create → `createMr` → closes the dialog and opens the MR in the full tab (`shared(OPEN)` with `mrKey`).
- [ ] **Step 1: failing tests:** prefill from stubbed git; Create disabled until title non-blank and upstream exists; push button args; createMr args (draft, reviewers); success sets `OPEN` and closes the overlay; an error stays in the dialog.
- [ ] **Step 2:** FAIL. **Step 3:** implement. **Step 4:** PASS; `herdr-app check` passes.
- [ ] **Step 5:** commit `omni-forge: New MR dialog`.

### Task 10: cache cleanup, install, docs

**Files:**
- Modify: `views/full.js` / `views/mr-page.js` (on MR tab close or eviction: when the MR's last known state is merged/closed, `dropMr`); `views/repo.js` or `main.js` (once per start and every 24 h: `pruneStale` on the local cache root; one copy only, claimed through a shared key like `OWNER`)
- Modify: `omni-forge/README.md` (MRs section, cache location and cleanup, limits: forks not handled, GitHub has no Revoke, no Merge), `omni-forge/sync.sh` unchanged unless it drops new files
- Live config (not in repo): `~/.config/herdr-app/layouts/main-graph.json` gets `{ "id": "mrs", "type": "block", "content": { "mod": "omni-forge", "props": { "view": "mrs" } } }` in `panel-body` after `ci`, and a Better Tabs button `{"id":"mrs","label":"MRs","group":"panels","when":{"node":"mrs"},"action":{"type":"panel","container":"panel","stack":"panel-body","target":"mrs"}}` after CI. Back up both files to the scratchpad first.
- Test: `omni-forge/tests/mr-page.test.cjs` (cleanup on close), `omni-forge/tests/mr-cache.test.cjs` already covers `pruneStale`
- [ ] **Step 1: failing test:** closing a tab of a merged MR calls `dropMr` with its number; an open MR's tab close doesn't.
- [ ] **Step 2:** FAIL. **Step 3:** implement. **Step 4:** full suites of omni-forge and git-graph PASS; `herdr-app check` both mods; `./sync.sh` in both; layout edited; `herdr-app status` has no errors and no `layouts/main-graph.error`.
- [ ] **Step 5:** commit `omni-forge: MR cache cleanup, docs` (layout files are outside the repo, not committed).
