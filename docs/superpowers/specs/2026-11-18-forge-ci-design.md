# omni-forge, part 1: foundation + CI

A Herdr mod for working with GitLab and GitHub from inside Herdr. This spec covers
the first of four parts: the shared foundation (forge layer, look, two sizes) and
the CI view. Later parts, each with its own spec: 2 MRs/PRs, 3 diff view with inline
comments, 4 issues.

## Why

I work in GitLab (git.example.org, most repos) and GitHub (personal repos) and want
to stop switching to the browser to see how my pipelines are doing, read a failing
job's log, re-run or play a job, and grab an artifact. Existing Herdr mods are
GitHub-only (ci-dash, ci-dash-app, branch-pr, herdr-pr-flow) or look and work in a way
I don't want (herdr-forge: whole-window layout, dashboards like milestones/velocity).

## What I want

- **ci-dash's look** (cybertron288/herdr-mods `ci-dash`): header with repo name and
  refresh, pill tabs with counts, a filter box, status chips with counts, rows with small
  pills (branch, status, duration, trigger), detail in the same panel.
- **Follows the focused terminal's repo**, like ci-dash. One repo, one forge at a time;
  the header names the repo. No cross-project dashboard.
- **Two sizes of the same mod:**
  - *side*: narrow (~360px) in the right panel stack, next to Files / Changes / Git,
    opened by a Better Tabs button; compact rows (closer to herdr-pr-flow's cards).
  - *full*: its own Herdr tab (`tab.new` with the mod), full work area, roomier rows.
  - Side is a glanceable list only: clicking a run switches to the full tab with that
    run open (opening the full tab if it isn't there). Run detail, logs and every
    action live in the full tab.
- **GitHub through `gh`, GitLab through `glab`**, using the logins already on the
  machine. The mod never stores or asks for tokens.

```
side (~360px)                      full (own tab)
┌ CI  group/app           ⟳ ┐      ┌ CI  group/app                                 ⟳ ┐
│ 🔍 Filter…   This branch ✓│      │ 🔍 Filter runs…                    This branch ✓ │
│ All 30 ●Run 1 ●Failed 2   │      │ All 30  ● Running 1  ● Failed 2  ● Passed 26  …  │
│ ⟳ Fix totals rounding     │      │ ⟳ Fix totals rounding               #81231  2m   │
│   ⑂ fix/sums  running 4m  │      │   ⑂ fix/sums-rounding  running  4m 12s  MR !412  │
│ ✕ Bump deps    test:unit  │      │ ✕ Bump deps                          #81190  1h  │
└───────────────────────────┘      └──────────────────────────────────────────────────┘
```

## CI behaviour

- **Runs list:** GitHub Actions workflow runs / GitLab pipelines, newest first.
  Filter box; chips All / Running / Failed / Passed / Other with counts; a
  **This branch** chip, on by default.
- **This branch on GitLab** must include MR pipelines: our pipelines mostly run on MRs
  (`source: merge_request_event`, ref `refs/merge-requests/<iid>/head`), so the
  branch's open MR(s) are looked up and their pipelines shown with branch pipelines.
- **Row:** title/commit message, branch, status, duration, trigger (push, MR/PR,
  schedule, manual…), author, number, age; MR/PR number when it has one.
- **Run detail:** GitLab stages → jobs; GitHub jobs → steps. Status and duration on
  each. Artifacts listed. A running run refreshes every few seconds.
- **Job log:** opens in a pane beside the terminal (`pane.split` with this mod in a log
  view), not inside the panel. ANSI colours kept, GitLab section markers cleaned up,
  jumps to the first error. Refreshes while the job runs.
- **Actions:**
  - retry a job, retry the whole run (GitHub: rerun, and rerun failed jobs);
  - cancel a running run/job;
  - **▶ Play** a manual GitLab job (we have some manual jobs, not on every pipeline);
  - open in browser;
  - download an artifact;
  - **Send to agent** on a failed job: hands the job's name, URL and a log excerpt to an
    agent (one running in this space, or a new one in its own tab), with an editable
    prompt that only Send delivers.
- **Notification** when a run I'm watching finishes (passed/failed), via `notify()`,
  clickable to open it.

## Goals / non-goals / anti-goals

- Goals: everything in "CI behaviour", for github.com and any GitLab host `glab` is
  logged into (git.example.org today); the foundation parts 2–4 build on.
- Non-goals (this part): MRs/PRs, issues, diffs (parts 2–4); a "run pipeline with
  variables" / workflow_dispatch wizard (we don't start pipelines by hand); runners,
  milestones, velocity, any cross-project dashboard; GitHub Enterprise or gitlab.com
  beyond "works if the CLI is logged in there".
- Anti-goals: herdr-forge's look; taking over the whole window with a layout; storing
  tokens; a Python or Go dependency.

## Constraints

- Herdr mod rules (`~/.config/herdr-app/AGENTS.md`): gpui-kit JS, no timers for
  animation, no stored `cx`, no `setShared`/`run` during render, `herdr-app check` must
  pass, `exec` default timeout 30s (output observed capped around 8 MiB by herdr-pr-flow).
- Installed today: `gh` (github.com, logged in), `glab` (git.example.org, logged in;
  gitlab.com not), `python3`; no Go.
- Git runs on the space's machine (`exec(..., { on: space.machine })`); `gh`/`glab`
  run on this computer, where the logins are.

## Approaches

- **A. New mod in herdr-omni, borrowing pieces — chosen.** Plain JS; `gh api` / `glab
  api` behind one small provider interface that parts 2–4 extend; ci-dash's `ui.js`
  look copied with credit (MIT); herdr-forge's idea of one normalized shape for both
  forges; tests from the start. Costs more up front than forking; gives the structure
  the next parts need.
- B. Fork ci-dash via `scripts/upstream.sh` and add GitLab: its 650-line `main.js`
  mixes drawing and GitHub calls, no tests, no provider layer — we'd rewrite most of it
  and every sync would conflict.
- C. Reuse herdr-forge's `forge.py` under a new UI: 2.6k lines of Python built for its
  own panels, adds `python3` on every Herdr machine.

## Decided (my calls, open to correction)

- Mod name **`omni-forge`**, in this repo as `omni-forge/mods/omni-forge/` with
  `RECIPE.md`, `README.md`, `LICENSE` (MIT, own) and credit for ci-dash's borrowed look.
  (Not `forge-*`, which herdr-forge's mods use.)
- One mod, views picked by `props.view`: `side`, `full`, `log`.
- Forge detection: focused pane's cwd → `git remote get-url` (prefer `origin`) → host →
  `github.com` uses `gh`; any other host uses `glab` if `glab auth status --hostname
  <host>` succeeds; otherwise the panel says which login command to run.
- Artifacts download to `~/Downloads/` (not into the repo, unlike ci-dash) and are
  revealed in Finder.
- Polling: only while the view is shown; running runs every 5s, otherwise every 30s
  and on manual refresh; backs off on errors.
- Watched runs for notifications: runs on the current branch that were running when
  last seen, plus any run opened in detail.
- Watched runs keep being polled (every 30s) while the CI view is hidden, so the
  finish notification fires when I'm not looking. One copy owns the watch list,
  kept in `shared()` so it survives restarts and repo switches. Clicking the
  notification opens the run in the full tab (`tab.new`, since `<mod>.<command>` only
  reaches shown copies).
- GitHub only serves a job's log once the job has finished: its log view says so and
  polls until it's there, plus "Open in browser" for live output. GitLab logs refresh
  live.
- Send to agent: the editable prompt is the review step, so **Send** types it into the
  chosen agent and submits it. The picker lists agents running in this space, then
  "new" ones from `knownAgents()`, the one used last on top.
- Installation: copy into `~/.config/herdr-app/mods/`, add a `ci` block to the
  `panel-body` stack of my `main-graph` layout, and a Better Tabs button for it.

## Left to the builder

- Exact provider interface shape (as long as runs/jobs/artifacts/log/actions are
  normalized and MR/issue calls can be added later).
- Log size handling within `exec` limits (tail, truncation note).
- How the full tab is reused (one per space vs one overall).
- Pixel sizes, beyond matching ci-dash's look.
