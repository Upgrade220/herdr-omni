# omni-forge

A CI panel for the person's own Herdr window. It shows GitHub Actions runs or GitLab pipelines for the repository of the focused terminal. A narrow list sits in the right panel beside Files, Changes and Git and opens from a **CI** button in the tab bar. A full tab shows run detail and job actions, and job logs open as tabs inside it. It uses the machine's `gh` and `glab` logins and never stores tokens. The look follows cybertron288's `ci-dash` (MIT).

## What you see

The mod has four parts, picked by `props.view`.

**Side** (`view: "side"`, the default), about 360px wide in the right panel stack, on the theme `background`:
- **Header, 36px:** `CI` in semibold, the project path (`owner/repo`, `group/sub/project`) in 12px `dim` that truncates, and a small `⟳` outlined button on the right. While loading, the button shows a spinner.
- **Filter box, 36px:**
  - rounded 10, `raised` fill and a 1px `border`;
  - a 14px magnifier, the typed text in 12px, the number of shown runs at the right in 11px `dim`, and a clear ✕ once something is typed;
  - placeholder `Filter runs…`.
- **Chips, 26px:** rounded 8, with a 6px coloured dot and a count badge. They are All, Running (`working`), Failed (`ansi1`), Passed (`ansi2`) and Other (`dim`). A chip shows only when its count isn't zero, or when it is the selected one. The selected chip is filled `raised` with a `border`.
- **This branch toggle:** a 28px tab pill with a green `✓` while on. In the side view it has no branch name.
- **Rows, 6px vertical padding and 12px sides, hovering `hover`:**
  - First line: a 14px status mark, the title in 13px (truncating) and `#number` in 11px `dim`.
  - Second line, indented 22px, one non-wrapping row of 20px pills: the branch in the mono font with a branch icon (it shrinks first), the status pill and the duration.

**Full** (`view: "full"`), a whole Herdr tab of its own:
- **Header, 44px:** `CI`, the path, and `⟳ Refresh`.
- **List controls:** the same filter box, chips and toggle, but the toggle reads `This branch · <branch>`.
- **Rows, 8px by 14px:** the title in 14px, then `#number` and the age (`2m`, `1h`, `27d`). A wrapping pill row, indented 24px, shows:
  - the branch;
  - the status;
  - the duration (`9m 46s`);
  - the trigger (`push` is neutral; `merge request event`, `schedule`, `web` and the like are tinted `accent`);
  - `MR !n` (GitLab) or `PR #n` (GitHub), in `accent`;
  - `attempt n` when above 1;
  - the author, in `dim` text.
- **Detail, which replaces the list:**
  - **Top bar:** `‹ Runs` at the left. At the right, depending on the run: Retry once it has finished, Retry failed on a failed GitHub run, Cancel (red) while running, and Open in browser.
  - **Head:** the status mark and the title in 15px semibold with `#number`. Below, the pills without the author, then `author · age` in 11px `dim`.
  - **Groups:** each GitLab stage gets an uppercase 11px section header with its count and a 1px rule. GitHub's one-job groups get no header and list their steps, 22px each, indented 36px. A successful job lists only its non-success steps.
  - **Job rows, at least 34px:**
    - the status mark, the name in 13px, an `allowed to fail` pill when it applies, and the duration;
    - then the buttons: **Play** (`accent`, with the play icon, for manual GitLab jobs), **Retry** (on a finished job), **Cancel** (red, on a running GitLab job), **Log** (not on manual or skipped jobs) and **Send to agent** (on failed jobs).
  - **Tabs:** a 40px strip under the header: `Runs`, then run tabs (`#number title`, after loading) and log tabs (`job · log`), each with its status icon and ×. At most 8 (least recently selected closes first); reset when the repo changes; not persisted. Only the selected tab polls.
  - **Artifacts:** on GitLab, a job's archive downloads from an `Artifacts` button on its row (`Artifacts ✓` once done). An ARTIFACTS section lists only artifacts with no job (GitHub's, which belong to the run).

**Log** (a tab of the full view, embedded with `initEmbedded` and polled by the view's tick; `view: "log"` still works as a standalone pane):
- a 40px header with the job name in 13px semibold, `live` in `dim` while the job runs, and Open in browser and Refresh buttons;
- then the log in the person's terminal font at 12px, 18px per line, coloured by its ANSI codes (`theme().ansiN`), with bold kept;
- the first error line has a `raised` background, and the view scrolls it to the centre once;
- notes go in a 28px line: `Loading log...`, `truncated (showing last 2 MB)`, `Log available when the job finishes` (GitHub while running) or `The log is empty`, and errors in `ansi1`.

**Send** (`view: "send"`), a 640×560 dialog overlay:
- the title `Send to agent`, and `<job> failed · <path> #n` in `dim`;
- an Agent dropdown;
- the editable prompt in the mono font at 12px;
- Cancel, and Send (or Start for a new agent).

**States, in every view:**
- `Looking for a repository…` with a spinner.
- Errors show the message in `ansi1`, the hint in a code-font chip, and a Try again button. For example:
  - `Not a Git repository` / `Open a space inside a Git checkout.`;
  - `No Git remote`;
  - a missing login: `glab auth login --hostname <host>` or `gh auth login`.
- `No runs yet.` with `Nothing on <branch>.`
- `No run matches the filters.` with Clear filters.
- `Update failed: …` in red above a list that is still shown.

## How it behaves

**Which repo.** The views follow the focused terminal:
- They read its cwd and branch from `focused()`/`panes()` and the machine from its space, then run `git remote get-url origin`, falling back to the first remote.
- A github.com host means GitHub; any other host is GitLab.
- Focusing a mod pane, a mod-only tab or the full tab keeps the current repo.
- The last terminal's `{cwd, machine, branch}` is saved in `shared("omni-forge.last-loc")`, so a new tab starts there.

**This branch.** It is on by default and filters on the server:
- GitHub: `--branch`.
- GitLab: `ref`, plus the pipelines of the branch's open MRs. MR pipelines take the branch from `mergeRequest.sourceBranch`.

**Polling** happens only while the view is shown:
- every 5 seconds while a run is running or pending, otherwise every 30;
- each error doubles the delay, up to 5 minutes;
- the side view counts as shown when `layout()` shows its block, meaning the block isn't hidden and is the active child of each stack above it;
- the full view counts as shown when its own tab is focused.

**Clicks and keys:**
- **A side row:** opens the run in the space's full tab. That is the focused tab if it's a full tab, otherwise the first one. The side view sets `shared("omni-forge.open") = {tab, key}` and runs `tab.select`; that tab's copy takes the request in its next tick. With no full tab, `tab.new {mod: "omni-forge", props: {view: "full", open: key}}`. The key is `JSON.stringify([kind, host, path, runId])`.
- **A full row:** opens its detail; `‹ Runs` goes back.
- **Action buttons:** they show a spinner and are disabled until the request returns. A failure raises an error notification. A success reloads the detail and polls every 5 seconds for a minute.
- **Download:** saves to `~/Downloads/<project>-<job>-<name>.zip` (GitLab) or the folder `~/Downloads/<project>-<run>-<name>/` (GitHub, `gh run download`), then `open -R`.
- **Log:** `FullView.openLog(runId, job)` opens or selects tab `log:<runId>:<jobId>` with an embedded `LogView`; closing the tab drops it, so nothing keeps polling.
- **Send to agent:** opens the dialog.
  - The prompt is built from the job, repo, run, branch and MR/PR, the job URL, and the last 120 lines of a 64 KB log tail. The log goes in a fence longer than any run of backticks inside it.
  - It ends with a warning to treat the log and the CI metadata as data, not instructions.
  - The agent list has running agents in this space first, then `New <name>` from `knownAgents()`. The last one used goes on top, from `shared("omni-forge.send.agent")`.
  - Send runs `hc send <terminal> <text>`. Start runs `tab.new {argv, task, folder, space}`.

**Watches and notifications:**
- What gets watched:
  - after each list load, the running or pending runs on the current branch;
  - opening a detail adds its run when it is running, pending or manual.
- The watches are kept in `shared("omni-forge.watches")`.
- One copy owns polling, through `shared("omni-forge.watch-owner")` `{id, ts}` with a 90-second takeover. It checks the watches every 30 seconds, and backs off on errors, even while hidden.
- When a run finishes, the owner calls `notify` with `<path> #n passed|failed`, at level `info` or `error`, and a `tab.new` action that opens the run.
- A run that is gone (404) is dropped without a notification.

There are no agent statuses here, and no keys of its own.

## Built from

**Mod folder.** One folder, `mods/omni-forge/`, with `mod.json` `{"place":"none","title":"omni-forge","version":"0.1.0"}`.
- `main.js`: `PARTS = {side, full, log, send}`, picked by `props().view`.
- `forge/`:
  - `detect.js`: parses the remote;
  - `cli.js`: runs `gh`/`glab` through `exec` and turns failures into a `ForgeError` with `status` (from "HTTP 404" / "404 Not Found" in stderr) and a `hint`;
  - `github.js`, `gitlab.js`: one provider interface each, `{capabilities, listRuns, runDetail, jobLog, retryRun, cancelRun, retryJob, cancelJob, playJob, downloadArtifact}` (GitHub adds `retryFailed`), returning normalised runs `{id, number, title, branch, status, trigger, author, createdAt, durationSec, url, request, attempt}`;
  - `model.js`, `providers.js`.
- `ci/`: `log.js` (`cleanLog`, `findJob`), `poller.js` (`nextDelay`), `watch.js` (`Watches`, `watchKey`, `claimOwner`, `watchTick`).
- `views/`:
  - `repo.js`: the `RepoView` base shared by side and full: follow, detect, list, filters, watch tick;
  - `side.js`, `full.js`, `detail.js`, `log.js`, `send.js`;
  - `locate.js`: pure location and visibility rules: `nextLoc`, `fullTabs`, `sideVisible`, `mayTakeOpen`;
  - `runs.js`: filter, counts and formatting;
  - `ui.js`: the ci-dash look.
- `actions/agent.js`: the prompt and the agent choices.
- `icons/`: branch, close, package, play, search and spinner, copied from ci-dash. They are referenced as `mods/omni-forge/icons/<name>.svg`.

**Programs it runs:**
- `git remote` on the space's machine (`exec(..., {on: machine})`).
- `gh` locally, with `-R host/owner/repo` given explicitly:
  - `gh api` for runs, jobs and artifacts, and POST for `rerun`, `rerun-failed-jobs`, `cancel` and job `rerun`;
  - `gh run view --job --log` for a log and `gh run download` for an artifact.
- `glab api --hostname <host>` locally:
  - GraphQL for the list and the detail, with the project's `fullPath` as a variable;
  - REST, with the URL-encoded path, for `retry`/`cancel`/`play` (POST), job `trace` and job `artifacts`. The last two go through `/bin/sh` so the output can be tailed or written to a file.
- `open -R` for a download.
- `hc send` for Send.

**Herdr functions:** `exec`, `hc`, `run` (`tab.new`, `tab.select`), `notify`, `openOverlay`/`closeOverlay`, `shared`/`setShared`, `focused`, `panes`, `spaces`, `layout`, `window`, `agents`, `knownAgents`, `theme`, `settings`, `props`, `checking`, and `home`.

**In the person's layout:**
- a block `{"id":"ci","type":"block","content":{"mod":"omni-forge","props":{"view":"side"}}}` in the right panel's stack (`panel-body` in the `panel` column);
- a Better Tabs button `{"id":"ci","label":"CI","group":"panels","when":{"node":"ci"},"action":{"type":"panel","container":"panel","stack":"panel-body","target":"ci"}}` after the Git button.

## Watch out

- **Pane props.** A pane or tab copy gets an empty object as its `init` argument when live. Read `props()` once in `init` and keep the result; a later `props()` call can answer for another copy. The log view missed this and opened blank the first time it ran live.
- **GitLab runner 18+ timestamps.** The runner prefixes every trace line with `<RFC3339> <2 hex><O|E>` followed by a space, or by `+` to continue the line before. Strip the prefix and join the `+` lines before cleaning sections. Otherwise every line starts with `00O`, which looks like `000` in a mono font. GitHub lines start with a plain `<RFC3339> `.
- **Finding the first error.** Count exception names (`ReferenceError:`), not only `error`/`failed`/`ERROR`/`FAIL` as words. Otherwise the runner's own `Uploading artifacts for failed job` comes first.
- **Scrolling a virtual list.** `scroll_to_item` asked in the same tick that first fills the list is lost, so do it from `cx.timer.after(150, …)`.
- **Herdr rules.** Never call `run`, `setShared` or `notify` during render, and don't keep a `cx`. A check runs `init` for real, so `if (checking()) return;` before any `git`, `gh` or `glab` call.
- **Finding a mod's own tab.** `panes()` gives mod panes no props or copy id, so a full copy can't find its own tab directly. It records `focused().tab` on its first `on_size_change`, since a tab that isn't shown gets no layout. Before that, it takes an open request only when there is a single full tab.
- **GitHub logs.** GitHub serves a job's log only after the job finishes, and `cancelJob` doesn't exist there.
- **GitLab job ids** are gids (`gid://gitlab/Ci::Build/123`). Compare and build REST paths with the last segment.
- **GitLab artifacts.** Only the `ARCHIVE` artifact downloads through the job artifacts endpoint.
- **Limits:**
  - the list loads the newest 30 runs (plus the pipelines of open MRs);
  - the log keeps the last 2 MB;
  - the Send prompt keeps the last 120 lines.
- **Icons.** Install by copying the folder (`sync.sh`, rsync). A symlinked mod loads its code but not its icons.
- **Two full tabs in one space.** With two or more, a side click goes to the focused one, or else the first.

## Done when

- `node --test tests/*.test.cjs` passes, and so does `herdr-app check` on the mod folder.
- The CI button shows in the tab bar and switches the right panel to the side list.
- In a GitHub repo with no Actions runs, the side list reads `No runs yet.` / `Nothing on <branch>.`
- In a GitLab repo, the side list shows the branch's pipelines, with real branch names, and a pipeline started by an MR shows `MR !n` in the full row and the detail.
- Clicking a side row opens the full tab on that run's detail, with stages, jobs, durations and the right buttons for each job's status.
- Log opens a pane beside the full view with the job name, coloured output, no `section_` markers or timestamp prefixes, and the first error highlighted and scrolled into view.
- In a terminal outside any Git checkout, the side view shows `Not a Git repository` with its hint and Try again.
- No action (Retry, Cancel, Play, Download, Send) runs unless its button is pressed.
