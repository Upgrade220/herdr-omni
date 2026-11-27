# omni-restore

Brings Claude Code sessions back after a reboot.

Herdr keeps terminals alive while its window closes, updates or restarts its core. A reboot,
logout or core crash is different: each terminal comes back at the same address and in the same
tab, but as a bare shell, and the program that ran there is never started again. omni-restore
remembers which Claude Code session ran in each Herdr terminal and, once the shell is back, types

```sh
cd <folder> && claude <the same flags> --resume <session id>
```

into it.

## What you see

A small `↻ N` at the right end of the status bar: N Claude sessions remembered. Its tooltip says
the same and names the last terminal it resumed, or the error if something went wrong.

## How it works

- Every 10 seconds it asks herdr-core (`hc get <t> --json`) about each Herdr terminal whose agent is
  Claude Code. The foreground process gives the folder and the start command; Claude Code's own
  `~/.claude/sessions/<pid>.json` gives the session id (so `/resume` or `/clear` inside Claude are
  followed).
- Records go to `~/.config/herdr-app/data/omni-restore/sessions.json`: address, space, tab, folder,
  start command, session id, and the pid of the shell holding the terminal.
- A lost terminal comes back with a **new shell pid**. A new shell with nothing in front of it gets
  the resume command. The command keeps the original flags (`--model`, `--dangerously-skip-permissions`, …),
  drops an earlier `--resume`/`--continue`/`--session-id`, and drops a prompt typed on the command
  line (it is in the session already).
- The **same shell** with nothing in front means you quit Claude yourself: the record is dropped and
  nothing comes back.
- A new shell running something else (your program) for over 30 seconds is left alone and its
  record dropped. Shorter blips, such as the prompt's own `git status`, are waited out.
- A terminal the core can't be asked about (core still starting) keeps its record; one that is gone
  or finished drops it.
- If a resume fails (Claude doesn't start), it is not retried.

## Limits

- Claude Code only, and only terminals on this computer (a remote machine's session files are there).
- It works while the Herdr window is open: after a reboot, open Herdr and the sessions come back
  within about 10 seconds.
- Quitting Claude while the Herdr window is closed is still seen correctly (the shell pid didn't change).

## Install

```sh
./sync.sh        # copies mods/omni-restore into ~/.config/herdr-app/mods/
```

Then give it a block in your layout. It has to stay in the layout to run; the status bar is a good
place. Replace the status block with a row holding both:

```json
{
  "id": "status-row", "type": "row", "size": { "px": 28 }, "resizable": false,
  "children": [
    { "id": "status", "type": "block", "content": { "mod": "workspace-status" }, "size": { "weight": 1 } },
    { "id": "omni-restore", "type": "block", "content": { "mod": "omni-restore" }, "size": { "px": 56 } }
  ]
}
```

## Tests

```sh
node --test tests/*.test.cjs
```
