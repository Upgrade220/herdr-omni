# herdr-omni

My mods for the [Herdr app](https://herdr.dev): some written from scratch, most
taken from other people's mod repos and adjusted for how I work. Every borrowed mod
keeps its git history and a live link to where it came from, so upstream fixes can
still be pulled in.

## Mods

| Mod | What it does | Based on |
|---|---|---|
| _none yet_ | | |

## Install

Paste this into your agent inside Herdr, with the mod's folder name:

```text
Read ~/.config/herdr-app/AGENTS.md, then add this mod: https://github.com/Upgrade220/herdr-omni/tree/main/<mod-folder>
```

The agent reads the mod's `RECIPE.md` and files, tells you what it touches, copies it
into `~/.config/herdr-app/mods/` and checks it.

## Layout

Each folder is one mod, laid out the way [herdr.dev/mods](https://herdr.dev/mods)
expects:

```
<name>/
  mods/<name>/   the mod: mod.json, main.js, …
  RECIPE.md      the brief an agent can build the mod from
  README.md      what it does, for people
  preview.png    a screenshot
  LICENSE        the upstream licence, for borrowed mods
```

Other files at the root:

- `upstreams.tsv` lists where each borrowed mod comes from (repo, folder, branch).
- `scripts/upstream.sh` adds a mod from another repo and syncs its updates.
- `docs/screenshots/` holds images for this README.

## Borrowing a mod from another repo

```bash
# copy cybertron288's filetree into ./filetree, with its history
scripts/upstream.sh add filetree https://github.com/cybertron288/herdr-mods.git

# a different folder name upstream, or a different branch
scripts/upstream.sh add my-sidebar https://github.com/munza/herdr-mods.git better-sidebar main

# later: merge their new commits into my edited copy
scripts/upstream.sh sync filetree
scripts/upstream.sh sync --all
```

The script uses `git subtree`: it splits the upstream folder into its own history,
merges that into `./<name>/`, and records the source in `upstreams.tsv`. My edits
are ordinary commits; a sync is an ordinary merge, and conflicts are resolved the
usual way.

After adding a mod:

1. Keep its upstream `LICENSE` (and `NOTICE`, for Apache-2.0) inside its folder.
2. Add a row to the table above with a link to the original.
3. Say what I changed in the mod's `README.md`. Apache-2.0 asks for this.

## Credits and licences

My own code is under the [MIT licence](LICENSE). Borrowed mods stay under their
authors' licences; each one's folder holds its `LICENSE`, and the table above links
to the original.
