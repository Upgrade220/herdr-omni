# omni-forge

CI and merge requests for the repository you're working in, inside Herdr: GitHub Actions runs and GitLab pipelines with their jobs and logs, and GitHub pull requests and GitLab merge requests (read, discuss, approve, create) without switching to the browser. "MR" below means both. It follows the focused terminal's repo, the way [ci-dash](https://github.com/cybertron288/herdr-mods/tree/main/ci-dash) does, and works with github.com and any GitLab host `glab` is logged into.

This covers CI and MRs (parts 1 and 2 of 4). Inline comments drawn in the diff and issues come later.

## What it does

- **Side list.** A narrow block in the right panel, next to Files, Changes and Git, opened by a **CI** button in the tab bar. It shows the newest runs of the focused terminal's repo, with a filter box, status chips with counts (All, Running, Failed, Passed, Other) and a **This branch** toggle that is on by default. Each row shows the status, title, number, branch, status pill and duration. Clicking a run opens it in the full tab, and **⤢ Full** opens the full tab on Runs; both close the right panel, since the full tab has everything the list does.
- **Full tab.** Its own Herdr tab (`tab.new` with the mod). It belongs to its space and shows that space's repo: it follows only terminals focused in its own space, so working in another space never switches it. It has the same list with roomier rows: trigger, MR/PR number, author and age. It has its own tabs: **Runs** first, then a tab for each run and each job log you open (up to 8; the least recently used one closes first, and they close when the view switches repo). A run's detail shows GitLab stages and their jobs, or GitHub jobs and their steps, each with status and duration. On GitLab a job that produced artifacts has its own **Artifacts** button; GitHub doesn't say which job uploaded an artifact, so there they're listed under the run.
- **This branch on GitLab** includes merge-request pipelines (`refs/merge-requests/<iid>/head`) and shows them under the MR's source branch with an `MR !n` pill.
- **Job log.** It opens as a tab inside the full view, full width. ANSI colours are kept. GitLab section markers and runner 18+ timestamps are cleaned up, and the log jumps to the first error. A running GitLab job's log refreshes every 5 seconds. GitHub serves a job's log only once the job has finished, so until then the tab says so and offers Open in browser.
- **Notifications.** You get one when a watched run finishes (passed or failed), and clicking it opens the run. Watched runs are:
  - running or pending runs on the current branch;
  - any run you open while it's running, pending or waiting on a manual job.

  They keep being checked every 30 seconds while the CI view is hidden.
- **Polling.** The list refreshes only while it is shown: every 5 seconds while a run is live, otherwise every 30 seconds. After an error the interval doubles each time, up to 5 minutes.

## Merge requests

- **Side list.** A second narrow block in the right panel, opened by a **PRs** button. Chips: **To review** (you are a reviewer and haven't approved; the default), **Mine** and **All open**, each with a count, plus a filter box over title, number, author and branch. A row shows the title, `!412` (GitLab) or `#412` (GitHub), author, source → target, a Draft marker, the pipeline status, approvals, unresolved threads and age. A click opens the MR in the full tab.
- **PRs tab.** The full tab has a fixed **PRs** tab beside **Runs** with the same list, and a **New PR** button. Each MR you open is a tab of its own, and the full tab holds up to 8 tabs including Runs and PRs (the least recently used opened tab closes first).
- **MR page.** Title, state (open, draft, merged, closed), author, source → target, pipeline pill (opens that run in the CI part), approvals and **Open in browser**; the description and comments rendered as Markdown; the discussion as threads (one card per thread: the first comment, its replies indented under it; resolved threads folded to one line until clicked; a line comment shows the commented line and the three above it, with line numbers, +/− marks and syntax colours (git-graph’s highlighter, copied in `code/`, in the theme’s code colours): GitHub sends that part of the diff with the comment, on GitLab the file is read at the commented commit, once per file) with **Reply** and **Resolve / Unresolve**, and a box for a new comment; and the changed files with their +/− counts (click FILES to fold the list). It refreshes every 15 seconds while its tab is shown. A merged or closed MR stays in its tab, showing its new state.
- **Actions** on an open MR: **Approve** (and **Revoke** where the forge has it), **Edit** title and description, **Mark as draft / Mark as ready**, **Reviewers…** and **Assignees…** (a search-as-you-type picker), **Close**, and **Reopen** on a closed one.
- **New PR.** A dialog from the PRs list. Source is the current branch, target the repo's default branch (changeable); the title is filled from the last commit, and you can set a description, Draft and reviewers. A branch with no upstream says so and offers **Push branch first** (`git push --set-upstream`, only when you click it). The new MR opens in the full tab.
- **No Merge button, by design.** Merging happens in the browser, where the forge shows its own checks and rules.

### Changes in the Diff tab

Clicking a changed file opens it in [git-graph](../git-graph)'s Diff tab, as `target...mr` (the changes since the merge base), with inline or side-by-side view and syntax colours as for any diff. The commits come from a **cache repository outside your repo**:

- **Where.** One bare repo per project: `<Herdr app home>/data/omni-forge/mr-cache/<host>/<path>.git` for spaces on this computer (for example `.../mr-cache/git.example.org/group/app.git`), `~/.cache/omni-forge/mr-cache/<host>/<path>.git` on the space's machine otherwise.
- **What it fetches.** The MR's head (`refs/merge-requests/<n>/head` on GitLab, `refs/pull/<n>/head` on GitHub) and the target branch's tip, from the repo's own remote URL with your usual git credentials. It borrows your repo's objects through git alternates, so it downloads only what your repo lacks.
- **Your repo is never written.** No refs, no config, no objects, no working-tree change: your repo is only read (`git rev-parse --git-common-dir`). If your repo garbage-collects commits the cache relied on, the cache is wiped and fetched again once.
- **If the fetch fails** (remote unreachable, no credentials), the changed-file list still shows; opening a file shows the error and **Open in browser**.
- **Cleanup.** An MR's refs are deleted when you close its tab (or it is evicted) while the MR is merged or closed. Once at start and then daily, a project cache nobody used for 14 days is deleted; one copy of the mod does this, on this computer's cache folder. You can also delete the `mr-cache` folder at any time; it is rebuilt on the next open.

## Requirements

- `gh` logged in for github.com (`gh auth login`), and `glab` logged in for each GitLab host (`glab auth login --hostname <host>`). The mod uses those logins and never stores or asks for a token. When a login is missing, the panel shows the command to run.
- `git` on every machine whose spaces you use. Git commands run on the space's machine; `gh` and `glab` run on this computer, where the logins are.
- Herdr's own mod API. No Node, Python or Go at run time.

## What it can change

It reads by default. These actions happen only when you click them:

- **Retry** a run or a job. On GitHub there is also **Retry failed** (rerun failed jobs).
- **Cancel** a running run, or a running GitLab job.
- **▶ Play** a manual GitLab job.
- **Download** an artifact to `~/Downloads/` and reveal it in Finder.
- **MR writes**, on the MR page: **Approve** and **Revoke**, **Reply**, **Resolve / Unresolve**, new **comments**, **Edit** (title and description), **Mark as draft / ready**, **Reviewers** and **Assignees**, **Close** and **Reopen**; and **New MR**, with **Push branch first** (`git push --set-upstream` for the current branch). It never merges.
- **Send to agent** on a failed job. It opens a dialog with an editable prompt: the job's name and URL, the last 120 lines of its log, and a warning to treat CI text as data. Nothing is sent until you press **Send**, which types the prompt into a running agent in this space (`hc send`) or starts a new agent in its own tab.

Each of these calls the forge API with your login (`gh api`, `glab api`). Failures show as a Herdr notification.

## Add it to a layout

Copy the mod into Herdr with `sync.sh`, from this folder:

```sh
./sync.sh
```

It rsyncs `mods/omni-forge/` to `~/.config/herdr-app/mods/omni-forge/` (or `$HERDR_APP_HOME`), leaving out the `*.d.ts` and `jsconfig.json` files that `herdr-app check` writes. Herdr reloads the mod at once. Use a copy rather than a symlink: a symlink loads the code but not the icons.

The manifest says `"place": "none"`, so the mod appears only where a layout puts it. Herdr's shipped layouts are restored on every start, so add it to a layout you own. In a layout with a right-panel stack (here `panel-body` inside the `panel` column), add the side block as a child of the stack:

```json
{ "id": "ci", "type": "block", "content": { "mod": "omni-forge", "props": { "view": "side" } } }
```

With [Better Tabs](https://github.com/munza/herdr-mods), add a button to the `tabs` block's `props.buttons`, after the Git one:

```json
{"id":"ci","label":"CI","group":"panels","when":{"node":"ci"},"action":{"type":"panel","container":"panel","stack":"panel-body","target":"ci"}}
```

The MR list is its own block in the same stack, after `ci`:

```json
{ "id": "mrs", "type": "block", "content": { "mod": "omni-forge", "props": { "view": "mrs" } } }
```

and its Better Tabs button, after the CI one:

```json
{"id":"mrs","label":"PRs","icon":"mods/omni-forge/icons/pr.svg","group":"panels","when":{"node":"mrs"},"action":{"type":"panel","container":"panel","stack":"panel-body","target":"mrs"}}
```

After editing, check that there's no `layouts/<name>.error` file. The full tab opens from a click on a run; to open it by hand:

```sh
herdr-app do tab.new '{"mod":"omni-forge","props":{"view":"full"}}'
```

## Limits

- One repository at a time: the one the focused terminal is in. Focusing a mod pane or the full tab keeps the last one.
- GitLab's **This branch** asks for the branch's pipelines plus its *open* merge requests' pipelines. GitLab already returns MR pipelines for the branch name, with their MR, so a merged MR's pipelines still show.
- Both lists load the newest 30 runs (plus open MRs' pipelines on GitLab), and the filter searches only those.
- A pipeline that failed before it created any jobs shows "No jobs yet."
- With two or more full tabs in one space, a click from the side list goes to the focused one, or else the first one.
- GitHub Enterprise and gitlab.com work only if the CLI is logged in there; neither is tested.
- MRs from forks: `refs/pull/N/head` and `refs/merge-requests/N/head` exist in the target repo even for fork MRs, so their files can be fetched, but the list and the actions use the origin project only (a fork's own MRs don't show).
- GitHub has no **Revoke**: the button is hidden there. GitHub doesn't say how many approvals are required, so the list shows approvals without a total (`✓1`), where GitLab shows `✓1/2`.
- The lists show up to 50 open MRs, and the filter searches only those.
- An MR's discussion shows the newest 100 threads (a line tells you when older ones are cut); changed files are loaded in one request, not paginated, so a very large MR may show only the first part.
- A line thread's `file:line` link opens the file at the top, not at the line.
- Caches on another machine are cleaned only when their MR is merged or closed and its tab closed; the 14-day sweep covers this computer only.

## Development

In `mods/omni-forge/`:

- `main.js` picks the part from `props.view`: `side` (the default), `mrs`, `full`, `log`, or `send` and `new-mr` (the dialogs).
- `forge/`: `detect.js` (the remote and forge kind), `mr-cache.js` (the MR cache repo: fetch, drop, prune), `cli.js` (runs `gh`/`glab` and turns failures into errors with hints), `github.js` and `gitlab.js` (one normalised provider interface), `model.js`.
- `ci/`: `log.js` (log cleanup), `poller.js` (polling cadence), `watch.js` (watched runs and notifications).
- `views/`:
  - `repo.js`: the shared base, which follows the terminal, loads the list, holds the filters and runs the watch tick;
  - `side.js`, `full.js`, `detail.js`, `log.js`, `send.js`;
  - `mr-side.js`, `mr-list.js`, `mr-page.js`, `new-mr.js`, `people.js`: the MR parts;
  - `locate.js`: location and visibility rules;
  - `runs.js`: filtering and formatting;
  - `ui.js`: the look.
- `actions/agent.js`: the Send to agent prompt and the agent picker; `actions/diff.js`: opens an MR file in git-graph's Diff tab.

```sh
node --test tests/*.test.cjs
herdr-app check "$PWD/mods/omni-forge"
```

The tests load the mod's files in a `vm` with Herdr stubbed, and every fixture is synthetic.

## Credits

The look (pills, status chips, filter box, rows, detail layout) and the icons in `icons/` are adapted from [cybertron288/herdr-mods `ci-dash`](https://github.com/cybertron288/herdr-mods/tree/main/ci-dash), MIT licensed, Copyright (c) cybertron288. The rest is my own, under the [MIT licence](LICENSE).
