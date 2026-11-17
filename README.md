# herdr-omni

My mods for the [Herdr app](https://herdr.dev): some written from scratch, some
taken from other people's mod repos and adjusted for how I work.

## Mods

| Mod | What it does | Based on |
|---|---|---|
| [better-sidebar](better-sidebar/) | Spaces and agents sidebar with branches, worktrees and PR status; folding tree | [munza/herdr-mods better-sidebar](https://github.com/munza/herdr-mods/tree/main/better-sidebar) |
| [omni-forge](omni-forge/) | GitHub Actions and GitLab CI for the focused terminal's repo: a side list, a full tab with job actions, logs beside it, notifications and Send to agent | own (look from [cybertron288/ci-dash](https://github.com/cybertron288/herdr-mods/tree/main/ci-dash)) |

## Install

Paste this into your agent inside Herdr, with the mod's folder name:

```text
Read ~/.config/herdr-app/AGENTS.md, then add this mod: https://github.com/Upgrade220/herdr-omni/tree/main/<mod-folder>
```

The agent reads the mod's `RECIPE.md` and files, tells you what it touches, copies it
into `~/.config/herdr-app/mods/` and checks it.

## Credits and licences

My own code is under the [MIT licence](LICENSE). Borrowed mods stay under their
authors' licences; each one's folder holds its `LICENSE`, and the table above links
to the original.
