# Xcode dark theme (Xcode 15+ "Default (Dark)")

## Why

I love Xcode's dark look and want all of Herdr in it: the chrome, the terminals (Claude Code,
zsh, git) and the code in our mods (Diff tab, file viewer).

## What

- **A theme file**, `themes/xcode-dark.json` (kept in this repo, copied to
  `~/.config/herdr-app/themes/`), made active with Herdr's theme picker command. It sets:
  - background `#1F1F24`, text `#DFDFE0`, selection `#515B70`, cursor `#FFFFFF`;
  - the 16 terminal colours, Xcode's palette in each slot:

    | slot | colour | Xcode role |
    |---|---|---|
    | 0 black | `#414453` | (gutter grey) |
    | 1 red | `#FC6A5D` | strings |
    | 2 green | `#67B7A4` | functions |
    | 3 yellow | `#D0BF69` | numbers |
    | 4 blue | `#5482FF` | URLs |
    | 5 magenta | `#FC5FA3` | keywords |
    | 6 cyan | `#5DD8FF` | type declarations |
    | 7 white | `#DFDFE0` | plain text |
    | 8 bright black | `#6C7986` | comments |
    | 9 bright red | `#FF8170` | |
    | 10 bright green | `#78C2B3` | |
    | 11 bright yellow | `#FD8F3F` | preprocessor, attributes (orange) |
    | 12 bright blue | `#6699FF` | |
    | 13 bright magenta | `#A167E6` | other functions, properties (purple) |
    | 14 bright cyan | `#9EF1DD` | constants (mint) |
    | 15 bright white | `#FFFFFF` | |
  - `colors.dim` = `#6C7986`, Xcode's comment grey (the mods draw comments in `dim`).
- **Code colours in our mods take only theme colours** (nothing hardcoded); what changes is
  which theme colour each kind of code uses, to Xcode's layout. git-graph's and better-files'
  `syntaxColors` (identical today) become one named map, each line saying what it colours:

  | code | theme colour |
  |---|---|
  | keyword | magenta (ansi5) |
  | string | red (ansi1) |
  | number | yellow (ansi3) |
  | type | cyan (ansi6) |
  | function | green (ansi2) |
  | constant | bright cyan (ansi14) |
  | attribute (also preprocessor-like) | bright yellow (ansi11) |
  | property | bright magenta (ansi13) |
  | tag (HTML/JSX) | magenta (ansi5), as Xcode draws markup keywords |
  | comment | dim |

  The two mods keep identical copies (they can't import each other); a test fails if they
  differ.
- Claude Code: its own `/theme` → "dark (ANSI colours only)" makes it draw with these colours.
  That's a setting the person flips; not done here.

## Approaches

1. **Chosen:** one theme file + a new role-to-slot map in the mods, using theme colours only.
   Every theme colours code through its own palette; other themes now show strings in their
   red and types in their cyan.
2. Hardcode Xcode's code colours in the mods, switched on when the Xcode theme is detected by
   its colours. Fragile, rejected by the person ("reuse colours from the theme").
3. Theme file only: code views keep strings green / numbers red. Not Xcode inside code.

## Non-goals

A light variant; Claude Code's own theme; editing other apps.

## Added 2026-11-20: more themes, per-theme code colours

- Themes `xcode-11-dark` (Xcode 11–14) and `islands-dark` (JetBrains, from the IntelliJ
  Community sources) join `xcode-dark`. Settings' theme picker lists them; no extra selector.
- Islands colours code differently (strings green, keywords orange), so one fixed pairing
  can't fit every theme without wrecking terminal colours. Each theme may have
  `code-colors/<name>.json` naming each kind of code's colour; mods find the shown theme by
  matching theme() against themes/*.json (a mod can't ask the theme's name) and fall back to
  `CODE_COLORS`. Not inside the theme file: Herdr rejects unknown fields there.
