# omni-forge, part 2: merge requests and pull requests

Part 2 of omni-forge (part 1, CI: `2026-11-18-forge-ci-design.md`). GitLab merge requests and
GitHub pull requests, called "MRs" below for both, inside Herdr. Part 3 (comments drawn inside
the Diff tab, new line comments there) and part 4 (issues) come later.

## Why

I both review teammates' MRs and follow my own until they merge, and both send me to the
browser today: to read and answer discussions, resolve threads, approve, see what changed,
open an MR, mark it ready, ask for reviewers. I want that in Herdr, next to the terminal and
the CI view, in the same look.

## What

### Scope

- **One repo at a time, like CI**: the focused terminal's repo, same detection, same forge
  (`gh` for github.com, `glab` for any GitLab host it is logged into). No cross-project inbox.
- Open MRs only. Merged and closed ones are reached through the browser (an MR I'm looking at
  that gets merged or closed stays open in its tab, showing its new state).

### MR list (side block and full tab)

- **Chips**: **To review** (I'm a reviewer and haven't approved; default), **Mine** (I'm the
  author), **All open**, each with a count. A filter box searches title, number, author, branch.
- **Row**: title, `!412` / `#412`, author, source → target branch, Draft marker, pipeline
  status (the CI status pill), approvals (`✓1/2`; GitHub: approving reviews / required when
  known), unresolved threads (`💬3`), age (last update).
- Click a row: the MR opens in the full tab. Side is a glanceable list, as in CI.

```
side                                  full tab
┌ MRs  group/app                ⟳ ┐   ┌ MRs  group/app                                     ⟳ ┐
│ 🔍 Filter…                      │   │ To review 2   Mine 3   All open 9                     │
│ To review 2  Mine 3  All 9      │   │ ● Fix totals rounding        !412  ana  fix/sums → main│
│ ● Fix totals rounding     !412  │   │   ✓ pipeline  ✓1/2  💬3  2h                            │
│   ✓1/2  💬3  ● pipeline   2h    │   │ ◌ Draft: new export          !409  me   export → main │
└─────────────────────────────────┘   └────────────────────────────────────────────────────────┘
```

### MR page (full tab)

- **Header**: title, number, state (open / draft / merged / closed), author, source → target,
  pipeline pill (click: opens that run in the CI part of the full tab), approvals,
  **Open in browser**.
- **Description** (Markdown shown as readable text; editable, see lifecycle).
- **Discussion**: threads in order, each with its replies, author, age; **Reply**, and
  **Resolve / Unresolve** on resolvable threads. Line threads show a `file:line` link that
  opens that file in the Diff tab (scrolled to the line where the Diff tab can). A box at the
  end writes a new general comment. System notes ("added 1 commit", "approved") shown dimmed
  or left out.
- **Changed files**: list with +/− counts; a click opens the file in the Git mod's Diff tab,
  showing `target...mr` (see "Changes in the Diff tab").
- **Approve / Revoke approval.** (GitHub: Approve submits an approving review; "Revoke" there
  is dismissing my own review where the API allows it, otherwise hidden.)

### Lifecycle (no merge)

- **New MR**: from the MR list. Source: the current branch; target: the repo's default
  branch (changeable in the form). Title pre-filled from the last commit, description, Draft
  on/off, reviewers. If the branch has no upstream, the form says so and offers to push it
  first (as the Git mod's Publish branch does: pick the remote, set upstream). On success the
  new MR opens in the full tab.
- On an MR page: **edit title and description**, **Mark as ready / Mark as draft**, add and
  remove **reviewers** and **assignees**, **Close / Reopen**.
- **No Merge button** (anti-goal). Merging happens in the browser.
- Not included: labels, milestones, changing the target branch of an existing MR.

### Changes in the Diff tab (approach A, cache outside the repo)

- The MR's commits are fetched into a **cache repository outside the user's repo**: one bare
  repo per project, `<appHome>/data/omni-forge/mr-cache/<host>/<path>.git` for spaces on this
  computer, `~/.cache/omni-forge/mr-cache/<host>/<path>.git` on the space's machine otherwise
  (git runs where the space lives).
- The cache borrows the user's repo objects through git's **alternates** (read-only link to
  `<repo>/.git/objects`, worktrees resolved with `git rev-parse --git-common-dir`), so a fetch
  only downloads what the user's repo lacks. Nothing is written to the user's repo: no refs,
  no config, no objects, no working-tree change.
- Fetched refs: the MR head (`refs/merge-requests/<iid>/head` on GitLab, `refs/pull/<n>/head`
  on GitHub) and the target branch's current tip, from the repo's remote URL (the same one
  detection uses), with the user's usual git credentials.
- The Diff tab gets a new target source, e.g. `{ source: "range", gitDir, base, head, path }`,
  running `git --git-dir=<cache> diff <base>...<head> -- <path>`; everything else in the Diff
  tab (inline / side-by-side, syntax colours, full file) works as today. The handoff is the
  existing one (shared-state claim / new Diff tab with `props.target`), so the Git mod stays
  forge-agnostic and works without omni-forge.
- **Missing objects** (the user's repo garbage-collected commits the cache relied on): any git
  error naming missing objects wipes that project's cache and fetches again, once.
- **Cleanup**: an MR's refs are deleted from the cache when it is merged or closed; a project
  cache unused for 14 days is deleted; checked when omni-forge starts and once a day.
- **Fallback (B)** when the fetch fails (remote unreachable from that machine, no git
  credentials): the changed-file list still shows, and opening a file says the fetch failed,
  with the error and **Open in browser**. (Rendering the forge's own patch text is not built in
  part 2.)

### Where it lives in Herdr

- Same mod, `omni-forge`. A new side view `mrs` (`props.view: "mrs"`) as its own block in the
  right panel stack, next to CI, with a Better Tabs **MRs** button.
- The full tab gets a fixed **MRs** tab beside **Runs**; each opened MR is an item tab, sharing
  the existing cap of 8 item tabs (least recently used closes first).
- Polling like CI: only while shown; every 30 s; an open MR page every 15 s; back off on
  errors. No notifications in part 2.

## Goals / non-goals / anti-goals

- Goals: everything above, on github.com and any GitLab host `glab` is logged into.
- Non-goals (part 2): comments drawn in the Diff tab and new line comments (part 3); issues
  (part 4); a cross-project inbox; labels, milestones; suggestions/applying suggested changes;
  MR templates beyond whatever the forge fills in.
- Anti-goals: a Merge button; writing anything into the user's repo for viewing changes;
  storing tokens; herdr-forge's look.

## Constraints

- Everything in part 1's constraints (Herdr mod rules, `exec` limits, `gh`/`glab` on this
  computer, git on the space's machine, no tokens stored).
- Mods can't import each other: the Diff tab handoff goes through shared state / tab props, as
  better-files' Show diff already does.
- Testing touches only throwaway repos and fake CLI output; never write actions against real
  projects or real MRs.
- Public repo: no employer hosts or project names in code, tests, fixtures or docs; examples
  use `git.example.org` and `group/app`.

## Approaches

How an MR's changes reach the Diff tab:

- **A. Fetch the MR's commits and diff with git — chosen**, with the fetch going into a cache
  repo outside the user's repo (the person asked for that). Full files of any size, exact line
  numbers for part 3's comments, reuses the Diff tab as is. Costs a fetch on first open and a
  cache to clean up.
- B. Diff text from the forge API handed to the Diff tab: nothing fetched, but both forges cut
  big diffs (GitHub drops large patches, GitLab collapses "too large"), no whole-file context,
  and the Diff tab needs a text mode. Kept only as the failure message's escape (browser).
- C. omni-forge draws its own diff: duplicates the Diff tab; rejected.

Where MRs live: inside omni-forge (chosen) rather than a separate mod, because mods can't
share code and MRs need omni-forge's forge layer, repo detection, polling, views and the
MR↔pipeline link.

## Decided (my calls, open to correction)

- "To review" is the default chip.
- The MR side list is its own right-panel block with its own **MRs** button, not a toggle
  inside the CI block.
- GitHub "approvals required" shown only when branch protection tells us; otherwise `✓n`.
- System notes are hidden except approvals and new commits, shown dimmed.
- The New MR form's reviewers field searches project members (GitLab) / collaborators
  (GitHub) by name as you type.
- Cache cleanup at 14 days unused.
- **Forks**: the same remote and project as CI (prefer `origin`), no fork handling. My GitLab
  MRs live in the project itself; GitHub fork workflows (PRs on `upstream`) are out of part 2.
- **GitHub pipeline pill**: the PR's combined checks on its head commit (`statusCheckRollup`);
  a click opens the newest workflow run for that commit in the CI part, or the browser when
  there is none.
- **"To review" on GitLab**: reviewers, approvals and unresolved counts come from one GraphQL
  query per list refresh (no per-MR calls); GitHub likewise from one `gh api graphql` query.
- **The Git mod is in scope**: git-graph's Diff tab gains the `range` source (in `diffArgs`,
  `targetFromProps`, the header label), with a test; omni-forge keeps a copy of the handoff
  keys with a test that they match git-graph's, as better-files does. For a range target,
  `root` and `on` stay the user's repo and its machine (so the Diff tab is the same space's);
  `gitDir` is the cache.
- **Merged/closed MR still open in a tab**: its cached refs are kept until that tab closes,
  so its file links keep working; cleanup removes them after.
- **Range**: always `target...head` (merge base), even if the forge's own diff base differs
  after a rebase or target change.
- **Remote-machine spaces**: the fetch runs only on the space's machine; no local fallback.

## Left to the builder

- Provider interface shape for MRs, discussions and actions (normalized like `model.js`).
- GitLab GraphQL vs REST per call; GitHub `gh api` REST/GraphQL per call.
- How the Diff tab's new source shows its header (e.g. `!412 · src/a.js`).
- Pixel sizes, beyond matching the CI views.
