# herdr-omni

My mods for the [Herdr app](https://herdr.dev): some written from scratch, some
taken from other people's mod repos and adjusted for how I work.

## Mods

| Mod | What it does | Based on |
|---|---|---|
| [better-sidebar](better-sidebar/) | Spaces and agents sidebar with branches, worktrees and PR status; folding tree | [munza/herdr-mods better-sidebar](https://github.com/munza/herdr-mods/tree/main/better-sidebar) |
| [omni-forge](omni-forge/) | GitHub Actions and GitLab CI for the focused terminal's repo: a side list, a full tab with job actions, logs beside it, notifications and Send to agent | own (look from [cybertron288/ci-dash](https://github.com/cybertron288/herdr-mods/tree/main/ci-dash)) |
| [better-files](better-files/) | File browser that opens files in the centre pane, with a filter, Git marks and Send to agent; lives as a Files tab in the sidebar | [munza/herdr-mods better-files](https://github.com/munza/herdr-mods/tree/main/better-files); git extras from [cybertron288/herdr-mods filetree](https://github.com/cybertron288/herdr-mods/tree/main/filetree) (MIT) |
| [better-tabs](better-tabs/) | Tab bar with draggable, wrapping tabs and a toolbar of panel buttons; unnamed tabs show their title | [munza/herdr-mods better-tabs](https://github.com/munza/herdr-mods/tree/main/better-tabs) |
| [git-graph](git-graph/) | Git graph of the focused terminal's repo; changes, commit and full-tab views | [rabeeh-ta/herdr-git-graph](https://github.com/rabeeh-ta/herdr-git-graph) (MIT); changes/commit code ported from git-panel in [LaiqianDS/herdr-mods](https://github.com/LaiqianDS/herdr-mods) (Apache-2.0) |

## Themes

| Theme | What it is |
|---|---|
| [xcode-dark](themes/xcode-dark.json) | Xcode 15+ "Default (Dark)" |
| [xcode-11-dark](themes/xcode-11-dark.json) | Xcode 11–14 "Default (Dark)" (the one the JetBrains Xcode-Dark plugins copy) |
| [islands-dark](themes/islands-dark.json) | JetBrains Islands Dark, colours from the IntelliJ Community repo (`ManyIslandsDark.theme.json`, `IslandSchemeDark.xml`, Darcula's console colours) |
| [github-dark](themes/github-dark.json) | GitHub Dark Default (GitHub's VS Code theme) |
| [one-dark-pro](themes/one-dark-pro.json) | One Dark Pro, from its VS Code theme file |
| [dracula](themes/dracula.json) | Dracula, from its official Ghostty theme |
| [tokyo-night](themes/tokyo-night.json) | Tokyo Night (Night), from folke/tokyonight.nvim's Ghostty extra |
| [catppuccin-mocha](themes/catppuccin-mocha.json) | Catppuccin Mocha, from its official Ghostty theme |

Copy `themes/*.json` to `~/.config/herdr-app/themes/` and `code-colors/*.json` to `~/.config/herdr-app/code-colors/`, then pick a theme in Settings. In Claude Code, `/theme` → "dark (ANSI colours only)" follows the theme too.

Code in git-graph (Diff tab) and better-files (file viewer) is coloured from the theme: `code-colors/<theme>.json` names each kind of code's colour (`keyword`, `string`, `number`, `type`, `function`, `constant`, `attribute`, `property`, `tag`, `comment`; a hex colour or a theme colour name). A theme without one uses `CODE_COLORS` in each mod's `syntax.js`: keywords magenta, strings red, numbers yellow, types cyan, functions green. Herdr refuses unknown fields in a theme file, so the code colours live in their own folder.

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
