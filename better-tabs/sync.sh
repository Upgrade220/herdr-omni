#!/bin/sh
# Copies the mod into Herdr, which reloads it. A symlink loads the code but not the icons.
# herdr-omni: the installed mod.json's `settings` (your choices) survive the copy.
cd "$(dirname "$0")" || exit 1
dest="${HERDR_APP_HOME:-$HOME/.config/herdr-app}/mods/better-tabs"
kept=$(node -e 'try { const s = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).settings; if (s) process.stdout.write(JSON.stringify(s)); } catch {}' "$dest/mod.json" 2>/dev/null)
rsync -a --delete --exclude gpui-kit.d.ts --exclude herdr.d.ts --exclude jsconfig.json mods/better-tabs/ "$dest/"
[ -n "$kept" ] && node -e 'const fs = require("fs"); const f = process.argv[1]; const m = JSON.parse(fs.readFileSync(f, "utf8")); m.settings = JSON.parse(process.argv[2]); fs.writeFileSync(f, JSON.stringify(m, null, 2) + "\n");' "$dest/mod.json" "$kept"
exit 0
