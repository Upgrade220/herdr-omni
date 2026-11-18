# Tab titles instead of numbers

## Why

Tabs nobody named are called by their position ("1", "2"), and both the sidebar (Better
Sidebar) and the top tab bar (Better Tabs) show that name. The numbers say nothing about
what's in the tab.

## What changes (display only)

A tab someone named keeps its name. For a tab nobody named (`TabInfo.named === false`),
both bars show a label from its lead pane — its agent, else the focused pane, else its first
terminal:

1. its terminal title, with leading symbols stripped (e.g. Claude Code's spinning ✳), when
   it says something: not a path (`~/…`, `/…`, `C:\…`), not `user@host…`, not just the
   program's name or key;
2. else the program's name, unless it's a shell;
3. else the folder's name (a shell whose title is only a path);
4. a tab holding only a mod pane: that pane's title (the mod's name);
5. else Herdr's name ("1").

Long labels truncate as names do today; the full label is the tooltip. Nothing is written
to Herdr: its names stay "1", "2", and double-click rename works as before.

## Where

- Better Sidebar (`better-sidebar/`, already in this repo): tab rows and agent rows.
- Better Tabs: brought into this repo with `scripts/upstream.sh add better-tabs
  https://github.com/munza/herdr-mods.git`, with munza's LICENSE and NOTICE and a README
  credit; the tab pill shows the label. The installed copy is then replaced from the repo.
- The label function is duplicated in each mod (Herdr mods can't import each other).

## Approaches

- **B. Display-only change in both mods — chosen** (safer: Herdr's data untouched).
- A. A helper mod renaming unnamed tabs to their titles via `tab.rename` (one place, but
  writes real names that sync to other screens and need ownership tracking).

## Non-goals

Automatic renaming; changes to rename behaviour; restoring names across machines.
