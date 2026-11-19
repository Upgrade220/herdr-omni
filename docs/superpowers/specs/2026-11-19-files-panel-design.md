# Files in the left sidebar (better-files, adapted)

Borrowed from munza's better-files
([munza/herdr-mods](https://github.com/munza/herdr-mods/tree/main/better-files),
Apache-2.0), already in daily use. Ideas from cybertron288's filetree
([cybertron288/herdr-mods](https://github.com/cybertron288/herdr-mods/tree/main/filetree), MIT).

## Why

I want it to feel like VS Code: the file tree on the left, the file open in the middle, Git
on the right. Today Files shares the right-hand panel with Git and CI, so I can't see the
tree and Git at once, and better-files' "Show diff" points at better-changes, which is gone.
I also want to switch git info off and just browse files, or switch it on and see more of
it (as filetree does).

## What changes

**Where it lives (option B, chosen):** the left sidebar gets a third tab, **Files**, beside
**Spaces** and **Agents**. Picking Files shows the file tree in the sidebar instead of the
spaces list; picking Spaces or Agents brings them back. The Files button and the Files block
leave the top bar and the right-hand panel; Git and CI stay on the right.

```
[Spaces | Agents | Files] │ main: file tab, terminals… │ Git / CI
```

- The sidebar remembers the last tab across restarts (as it does for Spaces/Agents today).
- A key opens the Files tab and puts the keyboard in the tree: `cmd-shift-e`, as in VS Code
  (better-files' own focus action), if it's free.

**Git on / off:** one toggle in the Files header (a branch icon), remembered.
- **Off:** a plain tree and a plain file view: no colours or letters on rows, no changed-line
  tints in the viewer, no summary, ignored files shown like any other.
- **On:** everything better-files shows today, plus from filetree:
  - `+N −N` on changed files and a changed-file count on folders;
  - a summary line under the header: branch, `↑ahead ↓behind`, total `+N −N`, and a small
    bar of modified / new / deleted counts;
  - ignored files dimmed (the filter still leaves them out, as today).

**Diffs:** "Show diff" (right-click on a changed file) opens git-graph's Diff tab instead of
better-changes. With git off it's hidden.

**Everything else stays as better-files has it:** the filter that searches unopened folders,
dotfiles toggle, collapse all, keys, the shared preview tab and Keep tab, syntax colours,
Markdown and images, Open in your editor, Send to an agent, better-icons.

## Approaches

1. **Chosen:** bring better-files in with `scripts/upstream.sh add better-files
   https://github.com/munza/herdr-mods.git` and adapt it; adapt better-sidebar (already in the
   repo) for the third tab. Keeps munza's updates mergeable.
2. A new files mod from scratch in the VS Code shape: no upstream to merge, but rebuilds what
   better-files already does well. Dropped.
3. filetree (cybertron288) as the base: it has the git extras, but better-files has the viewer,
   filter, keys and agent menu I already use. Dropped; its extras are ported instead.

## Decided / my calls

- **Sidebar mechanics** *(my call)*: the sidebar's middle becomes a stack with two children,
  the existing better-sidebar lists block and a better-files block. The tab strip
  (Spaces | Agents | Files) moves into its own small better-sidebar block above that stack
  (a new `props.view: "switcher"`), so it stays visible whichever child shows; the lists block
  is told to hide its own strip. Clicking Files selects the files child; Spaces / Agents select
  the lists child and set its tab. Each mod keeps its own folder; the two only meet in the
  layout and through `layout.select`.
- The toggle and the extras live in new files in better-files (`git-extras.js`, a summary
  view) with small hooks in its tree and viewer, so munza's updates conflict only there.
- Git on/off is a shared key (`better-files.git`, default on) so the tree and every open
  file tab follow it.
- **Recent** (agent-neutral, chosen): the Files header gets **Tree | Recent**. Recent lists
  files changed on disk in the shown folder, newest first, with how long ago (`2m`), whoever
  changed them (any agent, an editor, me). It's fed by the folder watch better-files already
  runs, kept across restarts per folder (last 100), and skips `.git`, the folders the filter
  skips, and files Git ignores. A file that's gone since shows struck through. Click opens it
  like a tree row; right-click gives the same menu. Reads aren't shown (only changes).
- The layout (`main-graph`) is edited: the Files button and right-panel Files block go; the
  sidebar gets the switcher and the stack. Backed up first.
- Tests next to munza's (`node --test`); `herdr-app check` on both mods; credit and LICENSE
  kept, README "Changes in herdr-omni" sections.

## Calls made after the builder check

- **Width:** Files sits inside the existing sidebar, so it simply takes the sidebar's width
  and follows however the sidebar is resized today; Files does nothing about width itself.

- **Collapsed sidebar:** collapsing to the 44px rail always shows the rail (lists); the rail
  gets a Files icon that expands the sidebar on the Files tab.
- **Where files open:** better-files already opens files in the centre (a shared preview tab,
  Keep tab for a tab of its own); nothing of it stays in a side panel. Only its tree block
  moves into the sidebar.
- **Git on/off live:** the tree and open file tabs read `shared("better-files.git")` in render,
  so a change redraws every open view at once; no extra mechanism.
- **Key:** `cmd-shift-e` in `keys.json` runs a better-sidebar action that selects the Files
  child and then better-files' `better-files.focus`; if the key is taken, no key is bound and
  the README says how to bind one.
- **What's shown after a restart:** the stack's active child (from `layout()`) decides Files
  vs lists; the lists block's own saved tab decides Spaces vs Agents. The switcher highlights
  from those two.
- **Import:** `upstream.sh add better-files https://github.com/munza/herdr-mods.git` (a
  subfolder, as better-sidebar and better-tabs were added); differences between upstream
  HEAD and the installed copy are listed before the installed one is replaced.
- **Show diff → git-graph:** better-files can't import git-graph's code, so it uses
  git-graph's shared keys: finds the repo root with `git rev-parse --show-toplevel`, then
  selects the space's Diff tab (`git-graph.diff-tabs`) after writing `git-graph.diff-open`, or
  opens a new one with `tab.new { mod: "git-graph", props: { view: "diff", target } }`.
  git-graph's Diff tab learns to take `props.target` on start. Both mods are ours, so the
  keys are kept in step.

## Non-goals

- Creating, renaming, deleting or editing files (better-files leaves that to the editor on
  purpose).
- Moving Git or CI to the left.
- Showing which files an agent read (needs agent-specific hooks).

## Left to the builder

- Exact header and summary layout, the toggle's icon and placement.
- How the switcher learns which child is shown when the stack is changed elsewhere.
