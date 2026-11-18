# git-graph: one Git mod with changes, commit and a full tab

Borrowed from [rabeeh-ta/herdr-git-graph](https://github.com/rabeeh-ta/herdr-git-graph)
(v0.3.3, MIT). Parts ported from git-panel in
[LaiqianDS/herdr-mods](https://github.com/LaiqianDS/herdr-mods) (Apache-2.0, itself
a rework of Herdr's shipped `changes` mod).

## Why

Two Git mods are installed (git-graph and git-panel) and neither fits on its own. Each
has parts I love; I want them in one mod, in the side panel and in a full tab, so I
can drop the other one. git-panel also forces its own `file-icons` mod on me.

## What I keep

**From git-graph** (unchanged in look and behaviour):
- the commit tree: lanes, colours, branch/tag bubbles;
- the Remotes toggle and the All branches / Current switch;
- the bubble at the top naming the branch I'm on;
- clicking a commit opens the details strip: subject, description, hash, parents,
  author, date, changed files each with +/− and a total; a file opens its diff;
- right-click menus, dialogs, fetch, settings, Manygit (folders holding several repos).

**From git-panel** (ported in):
- unstaged and staged changes visible at once, with stage / unstage / stage all /
  unstage all / discard (discard asks first);
- clicking a changed file shows its diff;
- a list ↔ tree toggle for changed files;
- a commit box (title, optional description, Commit / Commit all), hidden until
  asked for;
- clicking the branch bubble opens a branch list with search: click to switch, a
  remote branch gets a tracking local branch, typing a new name offers "Create branch".

**New:**
- **Copy the hash:** in the details strip, the hash is clickable and copies the full
  hash ("Copied" shown briefly). The existing right-click "Copy commit hash" stays.
- **Two tabs in the side panel** (variant C, chosen): `Changes N` and `Graph`, each
  filling the panel. The header above them (branch bubble, ⤢ Full, fetch, refresh,
  settings) is shared.
- **⤢ Full:** closes the side panel and opens a tab named **Git** (git-graph's graph
  icon in both tab bars) showing the full view; if the space already has a Git tab,
  it is selected instead of opening another.

## Full view

Changes on the left, graph on the right, in one tab:

```
┌ ⑂ main ▾  ↑1                                         ⇣  ⟳  ⚙ ┐
│ ▸ Commit…             │ All branches · Current · Remotes        │
│ UNSTAGED 3   ☰/🌲 + ↶ │ ● fix totals   main  origin/main   2h   │
│  M cart.js  src/shop  │ ● add coupons                       5h   │
│  ?  coupon.js         │ ├● wip login   feature/login        1d   │
│ STAGED 1          −   │ ...                                      │
│  A login.js           │ ─ Commit 1a2b3c4d ─────────────────── × ─│
│ (diff of a clicked    │ Fix totals rounding                      │
│  file opens here)     │ Commit 1a2b3c4d… ⧉   Author …  Date …    │
│                       │ 3 files  +12 −4                          │
└───────────────────────┴──────────────────────────────────────────┘
```

The Changes column has a fixed default width (about 320 px), draggable and remembered.
The graph keeps its wide columns (author, hash) as today.

## Which repo

Both views follow the repo of the last terminal I focused, as the CI tab does: the
full tab, whose focused pane is the graph itself, keeps the repo of the terminal I
was in before; coming back after focusing a terminal in another worktree shows that
worktree. (My call, mirrored from omni-forge; git-graph today falls back to the
space's folder there, which is wrong for worktrees.)

## Icons

- File rows use **better-icons** (already installed, used by better-files and
  better-changes), read the same way those mods do. Without it, rows show the status
  letter only, no icon, nothing to install.
- The few UI glyphs git-panel adds (plus, minus, undo, list, list-tree, arrows) are
  copied into git-graph's own `icons/` folder (Lucide, ISC, already credited there).
- After this ships, `git-panel` and `file-icons` can be uninstalled (my call: I'll
  offer, not do it).

## Updates

The "Update Graph" prompt asks an agent to reinstall from rabeeh's repo, which would
overwrite this copy. It now says to run `scripts/upstream.sh sync git-graph` in
herdr-omni and then `git-graph/sync.sh` (a new install script, as better-sidebar has),
so updates merge into this copy. The release check itself stays.

## Layout (`main-graph`)

The `source` (git-panel) and `graph` buttons and panels become one **Git** button and
panel showing git-graph's side view. Nothing else in the layout changes.

## Approaches

1. **Chosen:** bring git-graph in with `scripts/upstream.sh add git-graph
   https://github.com/rabeeh-ta/herdr-git-graph.git .` and port git-panel's parts in.
   The parts I like most stay intact with their tests, and rabeeh's fixes can still be
   pulled; pulls may conflict where `graph.js` is touched. New code goes in new files
   (changes view, branch picker, commit box, full layout); `graph.js` gets hooks only.
2. A new mod from scratch copying pieces from both: cleanest, own name, but no more
   upstream pulls and more work. Dropped.
3. Start from git-panel and add the graph: its history view is far plainer, so most of
   git-graph would be rebuilt inside one 42 KB file. Dropped.

## Decided

- The mod keeps the name `git-graph` (the layout, icons and shared keys use it).
- Keep its LICENSE; credit both authors in the root README and the mod's README
  ("Changes in herdr-omni" section, as for better-sidebar/better-tabs). Keep the
  Apache-2.0 notice for ported git-panel code in the files that carry it.
- Tests go in its `tests/` next to rabeeh's (node `--test`); `herdr-app check` passes.
- Neutral examples only in committed files.
- Never run write actions (commit, checkout, discard, push, fetch) against real
  projects while testing; use a scratch repo.

## Non-goals

- No push/pull/stash buttons beyond what git-graph's menus already offer.
- No changes to the graph's look, the details strip or Manygit beyond what's above.
- No inline diff comments or MR/PR features (those belong to omni-forge).

## Calls made after the builder check

- **Diff in the side panel:** clicking a changed file on the Changes tab replaces the
  file list with its diff and a "← Changes" back link (as the details strip does with
  "← Files"); Esc goes back too. The full view shows it under the Changes column.
- **Baseline:** a fresh `upstream.sh add` of rabeeh's `main`; the installed copy is
  replaced by the repo's after install (`git-graph/sync.sh`). If the installed copy
  differs from upstream v0.3.3, the differences are listed before they're dropped.
- **Full tab:** opened by ⤢ only (`tab.new` with the mod and `props.view: "full"`),
  as omni-forge does; the layout gets no tab entry. `main.js` picks the view from
  `props.view` (side / full) alongside the existing `props.role` overlays.
- **Layout:** editing `main-graph.json` (merge `source` and `graph` into one Git
  button and panel) is part of the work. git-panel stays installed until removed by hand.
- **Manygit:** stage and commit act on the repo the graph shows. While the Manygit
  list is shown (no single repo open), the Changes tab says "Open a repository to see
  its changes".
- **Changes N** counts changed files (unique paths, staged or not, untracked included).
- **Refresh:** the Changes tab reads status in git-graph's existing refresh and folder
  watch; git-panel's own 10 s timer isn't ported.
- **better-icons:** read through munza's `file-icons.js`, copied in as better-changes
  does (reads `mods/better-icons/icons.json`; null when absent → no icon).

## Left to the builder

- How the side copy and the full copy share state (selected tab, commit box text) and
  how ⤢ hands the repo over (omni-forge's `OPEN`/last-location pattern is the model).
- Exact widths, the copy feedback, and where the list/tree toggle sits.
