// herdr-omni: which of Spaces, Agents and Files the sidebar shows. Files is a child of
// the `sidebar-body` stack, beside the lists block; Spaces or Agents is the lists tab.
import { findNode } from "./find-node.js";

export const STACK = "sidebar-body";
export const LISTS = "spaces";
export const FILES = "files";
// The lists tab, shared so the switcher and the lists block agree.
export const TAB_KEY = "better-sidebar.tab";
export const TABS = ["spaces", "agents"];

// The shared tab, else this copy's own (kept from before the key), else Spaces.
export function readTab(sharedTab, ownTab) {
  if (TABS.includes(sharedTab)) return sharedTab;
  return TABS.includes(ownTab) ? ownTab : "spaces";
}

export function hasFilesStack(tree) {
  return Boolean(findNode(tree, STACK)?.children?.some((c) => c.id === FILES));
}

export function switcherState(tree, listsTab) {
  return findNode(tree, STACK)?.active === FILES ? "files" : listsTab;
}
