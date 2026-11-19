#!/bin/sh
# Copies the mod into Herdr, which reloads it. A symlink loads the code but not the icons.
cd "$(dirname "$0")" && rsync -a --delete --exclude gpui-kit.d.ts --exclude herdr.d.ts --exclude jsconfig.json mods/git-graph/ "${HERDR_APP_HOME:-$HOME/.config/herdr-app}/mods/git-graph/"
