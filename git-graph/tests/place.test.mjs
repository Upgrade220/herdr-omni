import { test } from "node:test";
import assert from "node:assert/strict";
import { terminalLoc, fallbackLoc, pickLoc, gitTabs, sidePanelId, withModIcon, MOD_ICON } from "../mods/git-graph/place.js";

// Space s1: tab A has a terminal in /w/main (pane pa) and a git-graph pane (pl, mixed tab);
// tab G holds only git-graph (pg). Space s2 has no terminals.
const spaces = [
  { id: "s1", machine: null, folder: "/home/u", tabs: [{ id: "A" }, { id: "G" }] },
  { id: "s2", machine: "vps", folder: "/srv/app", tabs: [{ id: "H" }] },
];
const panes = [
  { pane: "pa", terminal: "t1", tab: "A", cwd: "/w/main" },
  { pane: "pl", terminal: null, mod: "git-graph", tab: "A", cwd: null },
  { pane: "pg", terminal: null, mod: "git-graph", tab: "G", cwd: null },
  { pane: "ph", terminal: null, mod: "git-graph", tab: "H", cwd: null },
];
const at = (pane, tab, space = "s1") => {
  const p = panes.find((x) => x.pane === pane);
  return { focused: { space, tab, pane, terminal: p?.terminal ?? null, cwd: p?.cwd ?? null }, panes, spaces };
};

test("focus on the Git tab itself keeps the last terminal's repo", () => {
  assert.deepEqual(pickLoc(at("pg", "G"), { cwd: "/w/feature", on: null }), { cwd: "/w/feature", on: null });
});

test("focus on a terminal wins over last", () => {
  assert.deepEqual(pickLoc(at("pa", "A"), { cwd: "/w/feature" }), { cwd: "/w/main", on: null });
});

test("no last, mod pane: a terminal of the tab, else the space folder", () => {
  assert.deepEqual(pickLoc(at("pl", "A"), null), { cwd: "/w/main", on: null });
  assert.deepEqual(pickLoc(at("pg", "G"), null), { cwd: "/w/main", on: null }); // via the space's tabs
  assert.deepEqual(pickLoc(at("ph", "H", "s2"), null), { cwd: "/srv/app", on: "vps" });
  assert.equal(pickLoc({ focused: null, panes, spaces }, null), null);
});

test("terminalLoc: null on a mod pane; machine from a layout terminal address or the space", () => {
  assert.equal(terminalLoc(at("pl", "A")), null);
  const layout = { focused: { space: "s1", tab: "A", pane: null, terminal: "vps/t3", cwd: "/r/x" }, panes, spaces };
  assert.deepEqual(terminalLoc(layout), { cwd: "/r/x", on: "vps" });
  const remote = { focused: { space: "s2", tab: "H", pane: "px", terminal: "t1", cwd: null }, panes: [{ pane: "px", terminal: "t1", tab: "H", cwd: "/r/y" }], spaces };
  assert.deepEqual(terminalLoc(remote), { cwd: "/r/y", on: "vps" });
  assert.deepEqual(fallbackLoc(at("pg", "G")), { cwd: "/w/main", on: null });
});

test("gitTabs ignores a tab mixing a terminal and git-graph", () => {
  assert.deepEqual(gitTabs(panes, spaces, "s1"), ["G"]);
  assert.deepEqual(gitTabs(panes, spaces, "s2"), ["H"]);
  assert.deepEqual(gitTabs(panes, spaces, "nope"), []);
});

test("sidePanelId finds the panel in a trimmed main-graph tree", () => {
  const tree = { id: "root", type: "row", children: [
    { id: "sidebar", type: "column", children: [{ id: "spaces", type: "block", content: { mod: "sidebar" } }] },
    { id: "work", type: "column", children: [
      { id: "tabs", type: "block", content: { mod: "tabs" } },
      { id: "work-body", type: "row", children: [
        { id: "main", type: "block", content: { tab: "active" } },
        { id: "panel", type: "column", children: [
          { id: "panel-body", type: "stack", active: "files", children: [
            { id: "files", type: "block", content: { mod: "files" } },
            { id: "graph", type: "block", content: { mod: "git-graph" } },
          ] },
        ] },
      ] },
    ] },
  ] };
  assert.equal(sidePanelId(tree), "panel");
  const full = { id: "r", type: "row", children: [{ id: "g", type: "block", content: { mod: "git-graph", props: { view: "full" } } }] };
  assert.equal(sidePanelId(full), null);
  assert.equal(sidePanelId({ id: "r", type: "row", children: [{ id: "g", type: "block", content: { mod: "git-graph" } }] }), "g");
});

test("withModIcon adds the icon once", () => {
  const added = withModIcon({ other: "x.svg" });
  assert.equal(added["git-graph"], MOD_ICON);
  assert.equal(added.other, "x.svg");
  assert.equal(withModIcon(added), null);
});
