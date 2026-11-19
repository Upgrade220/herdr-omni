import { test } from "node:test";
import assert from "node:assert/strict";
import { terminalLoc, fallbackLoc, pickLoc, gitTabs, sidePanelId, withModIcon, lastLocUpdate, MOD_ICON, diffTabOf, openDiffPlan, pendingTarget, claimTab, registerDiffTab, PENDING_MS } from "../mods/git-graph/place.js";

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

test("lastLocUpdate: a new terminal location is recorded, the same one or none is not", () => {
  assert.deepEqual(lastLocUpdate(null, at("pa", "A")), { cwd: "/w/main", on: null });
  assert.deepEqual(lastLocUpdate({ cwd: "/w/feature", on: null }, at("pa", "A")), { cwd: "/w/main", on: null });
  assert.equal(lastLocUpdate({ cwd: "/w/main", on: null }, at("pa", "A")), null);
  assert.equal(lastLocUpdate({ cwd: "/w/main" }, at("pa", "A")), null);
  // Focus on a git-graph pane: nothing to record.
  assert.equal(lastLocUpdate({ cwd: "/w/feature", on: null }, at("pg", "G")), null);
});

test("diffTabOf: the recorded tab only while it is still in the space", () => {
  assert.equal(diffTabOf({ s1: "G" }, spaces, "s1"), "G");
  assert.equal(diffTabOf({ s1: "gone" }, spaces, "s1"), null);
  assert.equal(diffTabOf({ s2: "H" }, spaces, "s1"), null);
  assert.equal(diffTabOf(null, spaces, "s1"), null);
});

test("openDiffPlan: selects a live tab, else asks for a new one named after the file", () => {
  const target = { path: "src/shop/cart.js" };
  const live = openDiffPlan({ map: { s1: "G" }, spaces, spaceId: "s1", target, now: 5 });
  assert.deepEqual(live, { select: "G", newTab: null, open: { s1: { target, at: 5 } } });
  const none = openDiffPlan({ map: { s1: "gone" }, spaces, spaceId: "s1", target, now: 6 });
  assert.deepEqual(none, { select: null, newTab: { name: "cart.js" }, open: { s1: { target, at: 6, pendingTab: { at: 6, before: ["A", "G"] } } } });
});

test("openDiffPlan: second click within the pending window updates target without newTab", () => {
  const first = { path: "a.js" }, second = { path: "b/c.js" };
  const one = openDiffPlan({ map: {}, spaces, spaceId: "s1", target: first, now: 1000 });
  const two = openDiffPlan({ map: {}, open: one.open, spaces, spaceId: "s1", target: second, now: 1000 + PENDING_MS - 1 });
  assert.deepEqual(two, { select: null, newTab: null, open: { s1: { target: second, at: 1000 + PENDING_MS - 1, pendingTab: { at: 1000, before: ["A", "G"] } } } });
  // Past the window the first tab never showed up: ask again, with today's tabs as `before`.
  const late = openDiffPlan({ map: {}, open: one.open, spaces, spaceId: "s1", target: second, now: 1000 + PENDING_MS + 1 });
  assert.deepEqual(late.newTab, { name: "c.js" });
  assert.deepEqual(late.open.s1.pendingTab, { at: 1000 + PENDING_MS + 1, before: ["A", "G"] });
  // A pending tab in another space doesn't hold this one back.
  const other = openDiffPlan({ map: {}, open: { s2: one.open.s1 }, spaces, spaceId: "s1", target: second, now: 1001 });
  assert.deepEqual(other.newTab, { name: "c.js" });
});

test("registerDiffTab: registration doesn't overwrite a live recorded tab", () => {
  const sp = [{ id: "s1", tabs: [{ id: "D1" }, { id: "D2" }] }];
  assert.equal(registerDiffTab({ s1: "D1" }, sp, "s1", "D2"), null);
  assert.equal(registerDiffTab({ s1: "D1" }, sp, "s1", "D1"), null);
  assert.deepEqual(registerDiffTab({ s1: "gone", s9: "X" }, sp, "s1", "D2"), { s1: "D2", s9: "X" });
  assert.deepEqual(registerDiffTab(null, sp, "s1", "D2"), { s1: "D2" });
});

// Space s3 before a click: Git tab "G3" and a terminal tab "T3". After tab.new: Diff tab "N".
const claimSpaces = [{ id: "s3", tabs: [{ id: "T3", name: "1" }, { id: "G3", name: "Git" }, { id: "N", name: "cart.js" }] }];
const claimPanes = [
  { pane: "t", terminal: "t3", tab: "T3" },
  { pane: "g", terminal: null, mod: "git-graph", tab: "G3" },
  { pane: "n", terminal: null, mod: "git-graph", tab: "N" },
];
const pend = (before, at = 100) => ({ s3: { target: { path: "x" }, at, pendingTab: { at, before } } });

test("claimTab: a fresh copy picks the new tab, never one present in `before`", () => {
  const focusedGit = { space: "s3", tab: "G3" };
  assert.equal(claimTab({ spaces: claimSpaces, panes: claimPanes, open: pend(["T3", "G3"]), born: 150, focused: focusedGit }), "N");
  // Every git-graph tab was there before: nothing to claim, even with the Git tab focused.
  assert.equal(claimTab({ spaces: claimSpaces, panes: claimPanes, open: pend(["T3", "G3", "N"]), born: 150, focused: focusedGit }), null);
});

test("claimTab: null when ambiguous", () => {
  const sp = [{ id: "s3", tabs: [...claimSpaces[0].tabs, { id: "N2", name: "b.js" }] }];
  const pn = [...claimPanes, { pane: "n2", terminal: null, mod: "git-graph", tab: "N2" }];
  assert.equal(claimTab({ spaces: sp, panes: pn, open: pend(["T3", "G3"]), born: 150, focused: { space: "s3", tab: "N" } }), null);
});

test("claimTab: a restored copy (no fresh pending entry) falls back to the focused Diff-only tab", () => {
  // An old pending entry, from long before this copy started: not ours to use.
  const old = pend(["T3", "G3"], 100);
  assert.equal(claimTab({ spaces: claimSpaces, panes: claimPanes, open: old, born: 100 + 60_000, focused: { space: "s3", tab: "N" } }), "N");
  assert.equal(claimTab({ spaces: claimSpaces, panes: claimPanes, open: {}, born: 5, focused: { space: "s3", tab: "N" } }), "N");
  // Never the Git tab, a terminal's tab, or another copy's recorded tab.
  assert.equal(claimTab({ spaces: claimSpaces, panes: claimPanes, open: {}, born: 5, focused: { space: "s3", tab: "G3" } }), null);
  assert.equal(claimTab({ spaces: claimSpaces, panes: claimPanes, open: {}, born: 5, focused: { space: "s3", tab: "T3" } }), null);
  assert.equal(claimTab({ spaces: claimSpaces, panes: claimPanes, open: {}, born: 5, focused: { space: "s3", tab: "N" }, taken: ["N"] }), null);
  assert.equal(claimTab({ spaces: claimSpaces, panes: claimPanes, open: {}, born: 5, focused: null }), null);
});

test("pendingTarget: only a newer entry for that space", () => {
  const open = { s1: { target: { path: "a" }, at: 10 } };
  assert.deepEqual(pendingTarget(open, "s1", 9), { target: { path: "a" }, at: 10 });
  assert.equal(pendingTarget(open, "s1", 10), null);
  assert.equal(pendingTarget(open, "s2", 0), null);
  assert.equal(pendingTarget(null, "s1", 0), null);
});

test("gitTabs leaves out excluded tabs (the Diff tab)", () => {
  assert.deepEqual(gitTabs(panes, spaces, "s1", ["G"]), []);
  assert.deepEqual(gitTabs(panes, spaces, "s2", ["G"]), ["H"]);
  assert.deepEqual(gitTabs(panes, spaces, "s2", undefined), ["H"]);
});
