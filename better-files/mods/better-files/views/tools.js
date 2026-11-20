// The tree's tools, beside the filter: dotfiles, expand all (herdr-omni) and collapse all.
import { foldersTo } from "../files/filter.js";
import { childFolders, EXPAND_MAX } from "../files/expand.js";
import { gitOn } from "../files/reads.js";
import { IconButton } from "./ui.js";

const DOTFILES = "better-files.dotfiles";

// Shown unless turned off, and remembered on this computer. Storage can be missing or
// refuse, and then the choice lasts until Herdr restarts.
export function savedDotfiles() {
  try {
    return localStorage.getItem(DOTFILES) !== "false";
  } catch {
    return true;
  }
}

export const toolMethods = {
  toggleDotfiles(cx) {
    this.dotfiles = !this.dotfiles;
    try {
      localStorage.setItem(DOTFILES, String(this.dotfiles));
    } catch {
      // Not remembered, but still applied.
    }
    cx.notify();
  },

  // A marker in a folder that closes moves to the folder at the top.
  collapseAll(cx) {
    this.folders.clear();
    if (this.cursor?.includes("/")) this.cursor = foldersTo(this.cursor, false)[0];
    cx.notify();
  },

  // herdr-omni: opens every folder, breadth first, reading the ones not read yet. Leaves out
  // node_modules and the other heavy folders, Git-ignored ones, and dotfolders while dotfiles
  // are hidden; stops after EXPAND_MAX folders.
  expandAll(cx) {
    const { root, on, key } = this;
    if (!root || this.expanding) return;
    this.expanding = true;
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        const queue = [""];
        let opened = 0;
        while (queue.length && opened < EXPAND_MAX && this.key === key) {
          const parent = queue.shift();
          if (!this.entries.has(parent)) await this.loadFolder(parent, root, on, key);
          if (this.key !== key) return;
          const ignored = gitOn() ? this.ignoredSet : null;
          for (const rel of childFolders(this.entries.get(parent), parent, { dotfiles: this.dotfiles, ignored })) {
            if (opened >= EXPAND_MAX) break;
            this.folders.add(rel);
            queue.push(rel);
            opened++;
          }
          cx.notify();
        }
      } catch (e) {
        if (this.key === key) this.treeError = e.message ?? String(e);
      } finally {
        this.expanding = false;
        cx.notify();
      }
    });
  },

  toolButtons() {
    const filtering = Boolean(this.filterText());
    return [
      IconButton({
        id: "files-tool-dotfiles",
        icon: this.dotfiles ? "eye" : "eye-off",
        label: this.dotfiles ? "Hide dotfiles" : "Show dotfiles",
        small: true,
        onClick: (cx) => this.toggleDotfiles(cx),
      }),
      IconButton({
        id: "files-tool-expand",
        icon: "chevrons-up-down",
        label: "Expand all",
        small: true,
        disabled: filtering || !this.root || Boolean(this.expanding),
        onClick: (cx) => this.expandAll(cx),
      }),
      IconButton({
        id: "files-tool-collapse",
        icon: "chevrons-down-up",
        label: "Collapse all",
        small: true,
        disabled: filtering || this.folders.size === 0,
        onClick: (cx) => this.collapseAll(cx),
      }),
    ];
  },
};
