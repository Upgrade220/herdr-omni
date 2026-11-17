# better-sidebar: folding tree and main-checkout node

Borrowed from [munza/herdr-mods `better-sidebar`](https://github.com/munza/herdr-mods/tree/main/better-sidebar)
(v3.3.0), used here in the `lists` view (`main-graph` layout).

## Why

The Spaces tab lists every tab of every space at once, so it gets long. When a
space has worktrees, the main checkout's tabs sit at the same level as the
worktree rows, which reads as if they belong to the space rather than to one
checkout of it. I want a list I can fold down to the spaces, opening only what I'm
working on, and a clear split between the main checkout and each worktree.

## What changes (Spaces tab of `props.view: "lists"`)

**Folding**
- Every row with children gets a chevron: a space, the main-checkout node, a
  worktree. Clicking the chevron folds/unfolds; clicking elsewhere on the row
  selects as today.
- Defaults: rows whose children are tabs start folded. So a space without
  worktrees starts folded; a space with worktrees starts open one level (its
  main-checkout node and worktrees visible), and those start folded.
- A folded row shows a status dot at its right: the most urgent status inside it,
  blocked > done > working, in the theme's status colors. Idle shows nothing.
- The space / node / worktree holding the shown tab opens by itself, and stays
  open afterwards (never auto-folds).
- Fold choices persist across restarts (localStorage, like `machines.folded`).

**Main-checkout node**
- Only when a space has at least one worktree nested under it: a node above the
  worktrees, named after the branch the main checkout is on (`main`, `detached`),
  holding the main checkout's tabs, joined by the same tree rails.
- A space without nested worktrees keeps its tabs directly under it.

```
▾ H herdr-omni
  ├ ▸ ⑂ main                      ●
  ├ ▸ ⑂ fix-login      #42
  └ ▸ ⑂ docs
▸ S shop-service                  ·
```

**Unchanged:** Pinned group on top, the Agents tab, the compact rail, the
`combined: false` and standalone `spaces` views, PR badges, drag reorder, menus,
`setAgentOrder` (follows the drawn order: agents in folded rows keep their place
in the order, so next/prev agent still reaches them).

## Non-goals

- No change to the standalone `spaces` view or the Agents tab.
- No auto-folding when you leave a row.
- Worktrees whose main space isn't open stay top-level, as upstream.

## Approaches

1. Edit `lists.js` / `spaces.js` in place: smallest diff, but conflicts on the
   functions upstream keeps reworking.
2. **Chosen:** new `views/folds.js` with fold state, defaults, auto-open, status
   aggregation and the main-checkout node; `lists.js` / `spaces.js` get a few
   one-line hooks. Upstream syncs conflict only on those lines.
3. A separate `tree` view copied from `Lists`: no conflicts, but upstream fixes
   never reach it. Dropped.

## Decided

- Mod keeps the name `better-sidebar` (renaming touches asset paths, settings
  file and shared keys, each a sync conflict).
- Added with `scripts/upstream.sh add better-sidebar https://github.com/munza/herdr-mods.git`;
  installed into `~/.config/herdr-app/mods/` with its `sync.sh` (rsync).
- Tests for folding go next to upstream's in `tests/` (node `--test`), and
  `herdr-app check` must pass.

## Left to the builder

- Exact chevron icon/size and placement (reuse `icons/chevron-*.svg`).
- Fold-state key shape (e.g. space id, `<space id>:main`).
- Whether the space row still shows the branch beside its name when the
  main-checkout node shows it too (upstream already hides `main`/`master`).
