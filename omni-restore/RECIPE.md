# omni-restore

A mod for the person's own Herdr window. After a reboot, logout or herdr-core crash, Herdr's
terminals come back as bare shells in the same tabs. This mod remembers the Claude Code session that
ran in each one and types `cd <folder> && claude <same flags> --resume <id>` into the new shell.

## What it touches

- Reads: `hc get <t> --json` for Herdr terminals whose agent is Claude Code, and
  `~/.claude/sessions/<pid>.json` (Claude Code's own record of a running session's id).
- Writes: `~/.config/herdr-app/data/omni-restore/sessions.json` only.
- Types into a terminal only after it was lost and came back with a new, idle shell (`hc send`).
- Needs a block in the layout (it runs only while its block is there): a 56px block beside
  `workspace-status` in the status bar; see README.

## Install

1. Copy `mods/omni-restore/` to `~/.config/herdr-app/mods/omni-restore/` (`./sync.sh`).
2. `herdr-app check ~/.config/herdr-app/mods/omni-restore` must pass.
3. In the person's layout, replace the `workspace-status` block with a row of it (weight 1) and an
   `omni-restore` block (56px). Back the layout file up first.
4. `herdr-app status` shows no errors; the status bar shows `↻ N`.

## Done when

- `sessions.json` lists each running Claude terminal with its session id.
- A test terminal (labelled into a throwaway space) running Claude, killed with `kill -9` on its
  shell and Claude, comes back with `claude … --resume <same id>`.
- Quitting Claude in a terminal drops its record and nothing restarts.
