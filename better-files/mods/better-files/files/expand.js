// herdr-omni: which folders Expand all opens. Pure: the tools view walks the tree with it.
import { skipped } from "./recent.js";
import { isIgnored } from "./git-extras.js";

// Folders opened by one Expand all; the tree itself draws at most 5,000 rows.
export const EXPAND_MAX = 300;

// The folders under `parent` worth opening: not node_modules and the other heavy folders the
// filter skips, not dotfolders while dotfiles are hidden, not folders Git ignores.
export function childFolders(entries, parent, { dotfiles, ignored }) {
  const out = [];
  for (const entry of entries ?? []) {
    if (!entry.dir) continue;
    if (!dotfiles && entry.name.startsWith(".")) continue;
    const rel = parent ? `${parent}/${entry.name}` : entry.name;
    if (skipped(rel)) continue;
    if (ignored && isIgnored(ignored, `${rel}/`)) continue;
    out.push(rel);
  }
  return out;
}
