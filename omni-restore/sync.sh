#!/bin/sh
# Copies the mod into Herdr, which reloads it.
cd "$(dirname "$0")" && rsync -a --delete --exclude '*.d.ts' --exclude jsconfig.json mods/omni-restore/ "${HERDR_APP_HOME:-$HOME/.config/herdr-app}/mods/omni-restore/"
