# Working on this repo

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
- `docs/screenshots/` holds images for the README.

## Borrowing a mod from another repo

Every borrowed mod keeps its git history and a link to where it came from, so
upstream fixes can still be pulled in.

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
2. Add a row to the README's mods table with a link to the original.
3. Say what I changed in the mod's `README.md`. Apache-2.0 asks for this.
