# git-graph: a Diff tab (inline or side by side)

Ported from munza's better-changes
([munza/herdr-mods](https://github.com/munza/herdr-mods/tree/main/better-changes),
Apache-2.0): its diff view, syntax colours and side-by-side rows.

## Why

I want to read changes properly: a whole tab, side by side or inline, with colours. Today
git-graph shows a diff squeezed into the side panel (Changes) or the commit details strip,
and for a real diff I need better-changes, a second Git mod. One Git mod should do it.

This is the first of two projects; the second is a VS Code-style Files panel (its own
panel, sharing the git colours and opening this same Diff tab). Not covered here.

## What changes

**A Diff tab.** One per space, reused, named after the file it shows (`cart.js`), with
git-graph's graph icon. It shows one file's diff:

- **Inline** or **Side by side**, switched in the tab's header; the choice is remembered
  for every diff (shared, so all Diff tabs and restarts keep it).
- Syntax colours, line numbers, added/removed lines tinted, as better-changes draws them.
- **Full file**: the whole file with its changes marked instead of only the changed hunks;
  a toggle in the header, remembered like Inline / Side by side.
- Conflicted files show their conflict blocks (yours | incoming side by side).
- Header: status letter, path, `+a −d`, and what is compared: `unstaged`, `staged`,
  `untracked`, or `commit <short sha>` with its subject.
- Long diffs stop at better-changes' line limit with a note.

**Where it opens from:**
- **Changes** (side panel and the full Git tab's Changes column): clicking a file opens
  it in the Diff tab (unstaged → working tree vs index, staged → index vs HEAD, untracked
  → the whole file as added). The in-panel diff with "← Changes" goes away.
- **Commit details** (graph): clicking a changed file opens that file's diff for that
  commit (vs its first parent, as better-changes does for merges). The details strip's
  own diff view ("← Files") goes away.
- The "Uncommitted changes" row's files open like Changes' files.

**Behaviour:**
- Opening a file reuses the space's Diff tab and selects it, or opens one beside the
  current tab. The side panel stays open, so I can click through files one by one.
- The Diff tab follows its file: when the working tree changes it re-reads it (a closed
  or no-longer-changed file says "No changes in this file").
- The tab remembers its file across a restart, as better-changes' does.
- Closing it is the normal tab close.

## Approaches

1. **Chosen:** port better-changes' diff view, syntax colours and row builders into
   git-graph (credited, Apache-2.0), as a `view: "diff"` of the same mod. Proven look,
   commit diffs and conflicts included; munza's later fixes are carried over by hand.
2. Drive better-changes' own diff tab from git-graph through its shared state: no copy,
   but git-graph would depend on another mod's undocumented internals. Dropped.
3. A new diff tab on git-graph's own diff code: small, but no syntax colours or conflict
   views to start with. Dropped.

## Decided / my calls

- The ported code goes into new files (`diff-view.js`, `syntax.js`, and row builders in a
  pure module), each with the credit line `Ported from better-changes
  (https://github.com/munza/herdr-mods, Apache-2.0).`; `graph.js` and `changes-view.js`
  only get the hooks that open the tab. *(my call)*
- Inline / Side by side and Full file are git-graph's own shared keys
  (`git-graph.diff-layout`, `git-graph.diff-full`), independent of better-changes. *(my call)*
- File icons in the Diff tab's header come from better-icons, as elsewhere. *(my call)*
- better-changes' pane-header integration (drawing into a layout's custom pane header) is
  not ported; the tab draws its own header. *(my call)*
- The side panel stays open when a diff opens (unlike the CI Full button), because diffs
  are read file after file. *(my call)*
- Tests: the pure row builders and diff-argument choices get node tests with throwaway
  repos (as git-graph's other tests); `herdr-app check` passes.

## Calls made after the builder check

- **Remote spaces and Manygit:** the tab works for both. Its target is
  `{ root, on, path, source }` (`source`: `unstaged` | `staged` | `untracked` |
  `conflict` | `commit` with hash, short sha and subject); git runs through git-graph's
  `exec(..., { cwd: root, on })`, as everywhere else in the mod.
- **Which tab is the space's Diff tab:** git-graph records `{ [spaceId]: tabId }` in a
  shared key (`git-graph.diff-tabs`), as better-changes does; a recorded tab that no
  longer exists counts as none. Opening selects it, else runs `tab.new` with
  `{ name: <file name>, mod: "git-graph", props: { view: "diff" } }`. The target travels
  in a shared key per space (`git-graph.diff-open`), which the Diff tab copy picks up.
- **File states:**
  - a file listed both staged and unstaged opens the side of the row clicked;
  - deleted → every line removed; added/untracked → every line added;
  - status runs with `--no-renames`, so a rename shows as a delete and an add;
  - binary → "Binary file, no text diff";
  - a commit: `git show --diff-merges=first-parent` for that file (a root commit
    shows its files as added).
- **Full file:** applies to unstaged, staged and commit diffs; for untracked files and
  conflicts the toggle is hidden (the whole file or the conflict blocks show anyway).
- **Refresh:** working-tree diffs re-read when git-graph's `git-graph.changed` stamp or
  its folder watch fires (no polling of its own); commit diffs never re-read.
- **Side panel:** stays open and unchanged; it's a layout panel, independent of tabs.
- **Empty tab** (restored with no target, or its target gone): "Pick a file in Changes
  or in a commit to see its diff." The tab can be closed like any tab and is reopened by
  the next file click.

## Non-goals

- Staging, discarding or committing from the Diff tab.
- Editing the file, line comments, review notes.
- Amend and the unpushed-commits list from better-changes (could come later; with them
  better-changes could be removed from the layout).
- The Files panel (next project).

## Left to the builder

- How the Diff tab copy learns which file to show (a shared key per space, as
  better-changes and omni-forge's OPEN do) and how restart restore is stored.
- Exact header layout and the empty/loading states.
