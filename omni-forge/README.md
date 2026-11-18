# omni-forge

CI for the repository you're working in, inside Herdr: GitHub Actions runs and GitLab pipelines, their jobs and logs, without switching to the browser. It follows the focused terminal's repo, the way [ci-dash](https://github.com/cybertron288/herdr-mods/tree/main/ci-dash) does, and works with github.com and any GitLab host `glab` is logged into.

This is part 1 of 4 (CI). Merge requests and pull requests, diffs with inline comments, and issues come later.

## What it does

- **Side list.** A narrow block in the right panel, next to Files, Changes and Git, opened by a **CI** button in the tab bar. It shows the newest runs of the focused terminal's repo, with a filter box, status chips with counts (All, Running, Failed, Passed, Other) and a **This branch** toggle that is on by default. Each row shows the status, title, number, branch, status pill and duration. Clicking a run opens it in the full tab.
- **Full tab.** Its own Herdr tab (`tab.new` with the mod). It has the same list with roomier rows: trigger, MR/PR number, author and age. It has its own tabs: **Runs** first, then a tab for each run and each job log you open (up to 8; the least recently used one closes first, and they close when the view switches repo). A run's detail shows GitLab stages and their jobs, or GitHub jobs and their steps, each with status and duration. On GitLab a job that produced artifacts has its own **Artifacts** button; GitHub doesn't say which job uploaded an artifact, so there they're listed under the run.
- **This branch on GitLab** includes merge-request pipelines (`refs/merge-requests/<iid>/head`) and shows them under the MR's source branch with an `MR !n` pill.
- **Job log.** It opens as a tab inside the full view, full width. ANSI colours are kept. GitLab section markers and runner 18+ timestamps are cleaned up, and the log jumps to the first error. A running GitLab job's log refreshes every 5 seconds. GitHub serves a job's log only once the job has finished, so until then the tab says so and offers Open in browser.
- **Notifications.** You get one when a watched run finishes (passed or failed), and clicking it opens the run. Watched runs are:
  - running or pending runs on the current branch;
  - any run you open while it's running, pending or waiting on a manual job.

  They keep being checked every 30 seconds while the CI view is hidden.
- **Polling.** The list refreshes only while it is shown: every 5 seconds while a run is live, otherwise every 30 seconds. After an error the interval doubles each time, up to 5 minutes.

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

## Development

In `mods/omni-forge/`:

- `main.js` picks the part from `props.view`: `side` (the default), `full`, `log`, or `send` (the dialog).
- `forge/`: `detect.js` (the remote and forge kind), `cli.js` (runs `gh`/`glab` and turns failures into errors with hints), `github.js` and `gitlab.js` (one normalised provider interface), `model.js`.
- `ci/`: `log.js` (log cleanup), `poller.js` (polling cadence), `watch.js` (watched runs and notifications).
- `views/`:
  - `repo.js`: the shared base, which follows the terminal, loads the list, holds the filters and runs the watch tick;
  - `side.js`, `full.js`, `detail.js`, `log.js`, `send.js`;
  - `locate.js`: location and visibility rules;
  - `runs.js`: filtering and formatting;
  - `ui.js`: the look.
- `actions/agent.js`: the Send to agent prompt and the agent picker.

```sh
node --test tests/*.test.cjs
herdr-app check "$PWD/mods/omni-forge"
```

The tests load the mod's files in a `vm` with Herdr stubbed, and every fixture is synthetic.

## Credits

The look (pills, status chips, filter box, rows, detail layout) and the icons in `icons/` are adapted from [cybertron288/herdr-mods `ci-dash`](https://github.com/cybertron288/herdr-mods/tree/main/ci-dash), MIT licensed, Copyright (c) cybertron288. The rest is my own, under the [MIT licence](LICENSE).
