# omni-forge Part 1 (Foundation + CI) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Herdr mod `omni-forge` that shows the focused terminal's repo CI (GitHub Actions via `gh`, GitLab pipelines via `glab`) in ci-dash's look, as a side list and a full tab with run detail, job logs, actions, notifications and Send to agent.

**Architecture:** Pure logic (remote detection, CLI wrapper, two providers normalizing to one model, log cleanup, polling/watch scheduling, agent prompt) lives in plain modules with injected `exec`/clock so node tests can drive them. Views (`side`, `full`, `log`) are thin gpui-kit renderers over that logic, picked by `props.view` in `main.js`. Providers expose a CI interface now; parts 2–4 add MR/issue methods to the same provider objects.

**Tech Stack:** Herdr gpui-kit mod (JS ES modules, no build), `gh` and `glab` CLIs through Herdr `exec`, node `--test` with a `vm` loader that strips imports (as munza's tests do).

**Spec:** `docs/superpowers/specs/2026-11-18-forge-ci-design.md`

## Global Constraints

- Mod folder: `omni-forge/mods/omni-forge/` in this repo; `mod.json` `{"place":"none","title":"omni-forge","version":"0.1.0"}`; repo folder also holds `RECIPE.md`, `README.md`, `LICENSE` (MIT, Upgrade220), `sync.sh` (rsync to `~/.config/herdr-app/mods/omni-forge/`, excluding `*.d.ts` and `jsconfig.json`).
- No Python, no Go, no stored tokens. GitHub: `gh` (`--hostname`/`-R host/owner/repo` explicit). GitLab: `glab api --hostname <host>`, project addressed by URL-encoded full path (`group%2Fapp`) for REST and `fullPath` for GraphQL.
- `gh`/`glab` run locally; `git` runs on the space's machine (`{ on: space.machine }`).
- AGENTS.md rules: no stored `cx`, no `run`/`setShared`/`notify` during render, animate natively (`.frames`/`.spin`), `herdr-app check` passes.
- Test fixtures are synthetic: no real company project names, users or URLs in the repo.
- Credit: `views/ui.js` header comment and README name cybertron288/herdr-mods `ci-dash` (MIT) as the source of the look.
- Commands: tests `cd omni-forge && node --test tests/*.test.cjs`; check `herdr-app check "$PWD/mods/omni-forge"`.

## Review Focus

1. A GitLab branch whose pipelines run only as MR pipelines (`refs/merge-requests/<iid>/head`): "This branch" must still list them. Test in Task 2.
2. Focused pane not in a git repo, no `origin`, or a host `glab` isn't logged into: the panel shows a message with the exact login command, never an empty list or a crash. Test in Task 1.
3. A job log over the size cap: shown tail-truncated with a "truncated" note, not an `exec` failure. Test in Task 4.
4. A watched run that disappears (deleted, or repo switched) or whose poll errors: the watch list drops/keeps it without notifying falsely and without hot-looping. Test in Task 5.
5. GitHub job still running: log view says "Log available when the job finishes" and polls; no error. Test in Task 3.

---

### Task 1: Scaffold, remote detection, CLI wrapper

**Files:**
- Create: `omni-forge/mods/omni-forge/{mod.json,main.js}`, `forge/detect.js`, `forge/cli.js`, `omni-forge/sync.sh`, `omni-forge/LICENSE`
- Test: `omni-forge/tests/load.cjs` (vm loader: strips `import` lines, evaluates listed files in one context with given globals, returns exports), `omni-forge/tests/detect.test.cjs`

**Interfaces:**
- Produces:
  - `parseRemote(url: string) -> {host, path} | null` (ssh `git@h:a/b.git`, `ssh://git@h[:port]/a/b.git`, `https://h/a/b(.git)`; nested groups kept in `path`)
  - `forgeKind(host: string) -> "github" | "gitlab"` (`github.com` → github; else gitlab)
  - `async detectRepo(cwd, machine, exec) -> {kind, host, path, url} | {error, hint}`: `git remote get-url origin`, falling back to the first of `git remote`
  - `class ForgeError extends Error { status, hint }`
  - `async cli(exec, kind, host, args: string[], {timeout, raw}) -> parsed JSON | string`: runs `gh` or `glab`; non-zero exit → `ForgeError` with `hint` mapped from stderr (401/“not logged”/“no token” → `glab auth login --hostname <host>` / `gh auth login`; 403; 404; 429)
  - `main.js` default export picks `{side, full, log}` from `props().view` (default `side`); views are stubs rendering their name until Task 6/7.

- [ ] **Step 1:** Write `tests/detect.test.cjs`: `parseRemote` for `git@git.example.org:grp/sub/app.git` → `{host:"git.example.org", path:"grp/sub/app"}`, `https://github.com/o/r` → `{host:"github.com", path:"o/r"}`, `ssh://git@h.example:2222/a/b.git` → host `h.example`; garbage → null. `forgeKind`. `detectRepo` with fake exec: not-a-repo stderr → `{error:"Not a Git repository"}`; no remotes → error; ok → kind/host/path. `cli` with fake exec exit 1 + stderr `"401 Unauthorized"` for gitlab host `git.example.org` → `ForgeError` whose `hint` is `glab auth login --hostname git.example.org`.
- [ ] **Step 2:** `node --test tests/detect.test.cjs` → FAIL (files missing).
- [ ] **Step 3:** Implement the files above. `cli` passes `timeout: 30000` by default; JSON parse unless `raw`.
- [ ] **Step 4:** Tests pass; `herdr-app check "$PWD/mods/omni-forge"` passes.
- [ ] **Step 5:** Commit `omni-forge: scaffold, remote detection, CLI wrapper`.

### Task 2: Model and GitLab provider (list, detail, actions)

**Files:**
- Create: `forge/model.js`, `forge/gitlab.js`
- Test: `tests/gitlab.test.cjs` with synthetic fixtures in `tests/fixtures/gitlab-*.json`

**Interfaces:**
- Consumes: `cli`, `ForgeError` (Task 1)
- Produces (`forge/model.js`):
  - `Status = "running"|"pending"|"manual"|"success"|"failed"|"canceled"|"skipped"|"other"`
  - `Run = {id, number, title, branch, status, trigger, author, createdAt, durationSec, url, request: number|null, attempt: number|null}`
  - `Job = {id, name, group, status, durationSec, url, manual: boolean, allowFailure: boolean, steps: {name,status,durationSec}[]}`; `group` is the GitLab stage / GitHub job name for steps
  - `Artifact = {id, name, sizeBytes, jobId: string|null}`
  - `RunDetail = {run: Run, groups: {name, jobs: Job[]}[], artifacts: Artifact[]}`
  - `chipOf(status) -> "running"|"failed"|"passed"|"other"` (running+pending → running; manual → other)
- Produces (`forge/gitlab.js`): `gitlabProvider(exec, {host, path}) ->` an object with
  `listRuns({branch: string|null, limit=30}) -> Run[]`, `runDetail(id) -> RunDetail`, `jobLog(jobId, {maxBytes}) -> {text, truncated, available:true}`,
  `retryRun(id)`, `retryJob(jobId)`, `cancelRun(id)`, `cancelJob(jobId)`, `playJob(jobId)`, `downloadArtifact(artifact, dir) -> path`, `capabilities: {play:true, retryFailed:false, liveLog:true}`.

GitLab specifics (verified against a live instance):
- List and detail via GraphQL `project(fullPath){ pipelines(first, ref){ nodes{ iid id status source ref duration createdAt user{username} commit{title} mergeRequest{iid} } } }`; detail adds `stages{nodes{name jobs{nodes{id name status manualJob allowFailure duration webPath artifacts{nodes{name fileType size}}}}}}` (GraphQL status is upper-case; map lower-case).
- **This branch:** query `pipelines(ref: branch)` **and** `mergeRequests(sourceBranches:[branch], state: opened){nodes{iid pipelines(first){...}}}`; merge, dedupe by id, sort by `createdAt` desc.
- Actions via REST: `POST projects/<enc>/pipelines/<id>/retry|cancel`, `POST projects/<enc>/jobs/<id>/retry|cancel|play`. GraphQL ids `gid://gitlab/Ci::Build/123` → `123`.
- Log: `sh -c 'glab api --hostname "$1" "$2" | tail -c "$3"' sh <host> projects/<enc>/jobs/<id>/trace <maxBytes+1>`; `truncated` when output exceeds `maxBytes`.
- Artifact: `sh -c 'glab api --hostname "$1" "$2" > "$3"' sh … projects/<enc>/jobs/<id>/artifacts <dir>/<path-last>-<jobId>-<name>.zip`.

- [ ] **Step 1:** Tests: `listRuns({branch:"feat-x"})` with a fixture where branch pipelines are empty and one opened MR (iid 12) has two pipelines → returns 2 runs with `request: 12`, newest first; status `MANUAL` → `"manual"`, `chipOf("manual") === "other"`; `runDetail` groups jobs by stage in stage order, `manual` true for `manualJob`; `playJob("gid://gitlab/Ci::Build/77")` calls exec with args containing `projects/grp%2Fapp/jobs/77/play` and `-X`/`POST`; `jobLog` sets `truncated` when fake output length is `maxBytes+1`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** All tests pass.
- [ ] **Step 5:** Commit `omni-forge: GitLab CI provider`.

### Task 3: GitHub provider

**Files:**
- Create: `forge/github.js`
- Test: `tests/github.test.cjs`, fixtures `tests/fixtures/github-*.json`

**Interfaces:**
- Consumes: Task 1 `cli`; Task 2 model types and the provider method names
- Produces: `githubProvider(exec, {host, path})` with the same methods as `gitlabProvider`; `playJob` throws `ForgeError("Not supported on GitHub")`; `retryRun(id, {failedOnly})`; `capabilities: {play:false, retryFailed:true, liveLog:false}`.

GitHub specifics: runs `repos/<o>/<r>/actions/runs?per_page=<limit>[&branch=<b>]` → fields `id, run_number, display_title, head_branch, status, conclusion, event, run_attempt, run_started_at, updated_at, html_url, actor.login, pull_requests[].number` (status `in_progress|queued|waiting|requested|pending` → running/pending; `completed` → conclusion `success|failure|cancelled|skipped|timed_out|startup_failure|action_required` → success/failed/canceled/skipped/failed/failed/other); `durationSec` from `run_started_at`..`updated_at`; `request` = first PR number or null. Detail: `…/runs/<id>/jobs` (steps) and `…/runs/<id>/artifacts`. Actions: `POST …/runs/<id>/rerun`, `…/rerun-failed-jobs`, `…/jobs/<id>/rerun`, `…/runs/<id>/cancel`. Log: `…/actions/jobs/<id>/logs` (raw); 404 while the job isn't completed → `{text:"", available:false}`. Artifact: `gh run download <run> -R <host>/<o>/<r> -n <name> -D <dir>/<repo>-<run>-<name>`.

- [ ] **Step 1:** Tests: status/conclusion mapping table above; `listRuns({branch:"main"})` passes `branch=main`; `jobLog` for a fake 404 → `available:false`, no throw; `retryRun(5,{failedOnly:true})` hits `rerun-failed-jobs`; `playJob` rejects with "Not supported on GitHub".
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** All tests pass.
- [ ] **Step 5:** Commit `omni-forge: GitHub CI provider`.

### Task 4: Log cleanup and log view

**Files:**
- Create: `ci/log.js`, `views/log.js`
- Test: `tests/log.test.cjs`

**Interfaces:**
- Produces: `cleanLog(text) -> {lines: {spans: {text, fg?, bold?}[]}[], firstError: number|null}`: strips GitLab `section_start:<ts>:<name>\r\e[0K` / `section_end:` markers and `\r` overwrites (keep text after the last `\r` on a line), parses SGR colours 30–37/90–97/1/0 into spans, strips other escapes and GitHub timestamp prefixes `^\d{4}-\d\d-\d\dT[\d:.]+Z `; `firstError` = first line matching `/(^|\b)(error|failed|ERROR|FAIL)\b|##\[error\]/`.
- `views/log.js` (`props: {kind, host, path, runId, jobId, name}`): header with job name, Open in browser, Refresh; a "truncated (showing last N MB)" note; scrolls to `firstError` on first load (`ScrollHandle.scroll_to_item`); polls every 5s while the job is running (GitLab) or until `available` (GitHub, text "Log available when the job finishes").
- Log size cap: `maxBytes = 2_000_000`.

- [ ] **Step 1:** Tests: a GitLab sample with section markers and `\e[32mok\e[0m` → no marker text in output, one green span; `"foo\rbar"` → `bar`; GitHub `2026-01-01T00:00:00.0000000Z ##[error]boom` → text `##[error]boom`, `firstError` its index; plain log → `firstError` null.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement `cleanLog` and the view.
- [ ] **Step 4:** Tests pass; `herdr-app check` passes.
- [ ] **Step 5:** Commit `omni-forge: job log view`.

### Task 5: Polling, watched runs, notifications

**Files:**
- Create: `ci/poller.js`, `ci/watch.js`
- Test: `tests/watch.test.cjs`

**Interfaces:**
- Produces:
  - `nextDelay({visible, anyRunning, errors}) -> ms`: visible+running 5000; visible 30000; hidden 30000 (watched only); errors back off ×2 per consecutive error, cap 300000.
  - `class Watches` over `shared("omni-forge.watches")`-shaped plain data (constructor takes `{get, set}`): `add(key, run)`, `keys() -> {kind,host,path,runId}[]`, `update(key, run) -> "finished"|null` (returns `"finished"` once when status leaves running/pending/manual→terminal success/failed/canceled; then removes it), `drop(key)` on a 404 `ForgeError`. Key = `JSON.stringify([kind,host,path,runId])`.
  - One owner polls watches: the first live copy that claims `shared("omni-forge.watch-owner")` with a timestamp older than 90s; owners refresh the claim each tick. Owner calls `notify({title:"<repo> #<number> passed|failed|canceled", body: title, level, action:{name:"tab.new", args:{mod:"omni-forge", props:{view:"full", open: key}}}})`.
  - Auto-watch: when a list refresh shows a running run on the current branch, `add` it.

- [ ] **Step 1:** Tests: `nextDelay` values above; with `errors` the base delay doubles per error, capped: visible-idle with 3 errors → 240000, with 4 → 300000; `Watches.update` returns `"finished"` exactly once for running→success and null for running→running; a 404 `ForgeError` passed to the tick drops the watch without notifying; a non-404 error keeps it and counts toward backoff.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement; the tick function takes injected `providerFor(key)`, `notify`, `now`.
- [ ] **Step 4:** Tests pass.
- [ ] **Step 5:** Commit `omni-forge: polling and run notifications`.

### Task 6: ci-dash look, full view (list + detail + actions)

**Files:**
- Create: `views/ui.js` (pills, chips, filter box, tab pills, status icons; adapted from ci-dash's `ui.js`, credited), `views/full.js`, `views/runs.js` (list state: filter, chip, This branch; shared by side and full)
- Test: `tests/runs.test.cjs` (pure list filtering/counting from `views/runs.js`)

**Interfaces:**
- Consumes: Tasks 1–5
- Produces:
  - `filterRuns(runs, {query, chip}) -> Run[]` and `chipCounts(runs) -> {all, running, failed, passed, other}`; query matches title, branch, author, `#number`.
  - Full view: header `CI  <path>` + refresh; filter box; chips with counts; This branch toggle (default on; branch = focused pane's `branch`); rows (title, `#number`, age; pills: branch, status, duration, trigger, `MR !n`/`PR #n`, author). Click → detail in the same view with back: groups → jobs (status icon, duration; ▶ Play on `manual` when `capabilities.play`; Retry; Cancel while running; Log → `pane.split {direction:"right", mod:"omni-forge", props:{view:"log", …}}`; Send to agent on failed — Task 7), run actions (Retry, Retry failed when `capabilities.retryFailed`, Cancel, Open in browser), artifacts (Download → `~/Downloads`, then `exec("open", ["-R", path])`).
  - Lists poll only while visible (`nextDelay({visible})`): side is visible when its layout block and every ancestor aren't `hidden` and its stack's `active` is its block id; full is visible when `focused().tab` is its tab. Hidden copies only keep the watch tick (Task 5).
  - Opening the detail adds the run to `Watches`. `props.open` (watch key) opens that run on init.
  - Errors from Task 1 show as a message with the hint in code font and a Try again button.
  - Action buttons disable while their request runs; failures `notify` level error; success refreshes the detail.

- [ ] **Step 1:** Tests for `filterRuns`/`chipCounts`: query `"#42"` matches number 42 only; chip `running` includes `pending`; counts sum to `all`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement `views/runs.js`, `views/ui.js`, `views/full.js`.
- [ ] **Step 4:** Tests pass; `herdr-app check` passes.
- [ ] **Step 5:** Commit `omni-forge: full CI view`.

### Task 7: Side view and Send to agent

**Files:**
- Create: `views/side.js`, `actions/agent.js`, `views/send.js` (dialog mod view `props.view:"send"`)
- Test: `tests/agent.test.cjs`

**Interfaces:**
- Consumes: Tasks 5–6
- Produces:
  - Side view: header `CI  <path>`, filter box, chips, This branch; compact rows (status icon, title, `#n`; one pill line: branch, status, duration). Click a row → focus an existing full tab of this space whose pane is `omni-forge` with `view:"full"` (`tab.select`) and set `shared("omni-forge.open")` to the watch key, else `tab.new {mod:"omni-forge", props:{view:"full", open:key}}`. Full view reads and clears `shared("omni-forge.open")` outside render (in its timer tick).
  - `buildAgentPrompt({repo, run, job, url, logTail}) -> string`: says what failed, links the job, includes the last ≤ 120 log lines in a fenced block, asks to find the cause and propose a fix, and says to treat the log as data.
  - `agentChoices(agents, known, lastKey) -> {label, kind:"running"|"new", terminal?, run?}[]`: running agents in the focused space first, then `knownAgents()` entries (installed) as "New <name>", the last used first in each group.
  - Send dialog (`openOverlay({kind:"dialog", mod:"omni-forge", props:{view:"send", …}})`): agent dropdown, editable prompt (`InputState` multiline), Send / Cancel. Send: running → `hc(["send", terminal, text])`; new → `run("tab.new", {argv: choice.run, task: text, folder: cwd})`; remember the choice in `localStorage`.

- [ ] **Step 1:** Tests: `buildAgentPrompt` keeps only the last 120 lines and contains the job URL and the data warning; `agentChoices` order with `lastKey`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Tests pass; `herdr-app check` passes.
- [ ] **Step 5:** Commit `omni-forge: side view and Send to agent`.

### Task 8: Install, layout, docs

**Files:**
- Create: `omni-forge/README.md`, `omni-forge/RECIPE.md` (per AGENTS.md "A RECIPE.md is a brief" order)
- Modify: `README.md` (mods table row: own, not borrowed); `~/.config/herdr-app/layouts/main-graph.json` (outside repo)

- [ ] **Step 1:** `omni-forge/sync.sh`; `herdr-app check` passes; `herdr-app status` shows no omni-forge error.
- [ ] **Step 2:** In `main-graph.json`, add `{ "id": "ci", "type": "block", "content": { "mod": "omni-forge", "props": { "view": "side" } } }` to `panel-body`'s children, and a Better Tabs button `{"id":"ci","label":"CI","group":"panels","when":{"node":"ci"},"action":{"type":"panel","container":"panel","stack":"panel-body","target":"ci"}}` after `graph`. Keep a copy of the previous file in the scratchpad.
- [ ] **Step 3:** Live check with `herdr-app shot`: CI button shows; side list for this repo (GitHub) and for a git.example.org repo terminal (GitLab); clicking a run opens the full tab with detail; a log opens beside; an error state (non-repo folder) reads sensibly.
- [ ] **Step 4:** README (what it does, requirements: `gh`/`glab` logged in, what it writes: retry/cancel/play/downloads/agent messages, credit ci-dash) and RECIPE; commit `omni-forge: docs and install`.
