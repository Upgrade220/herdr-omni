const { test } = require("node:test");
const assert = require("node:assert/strict");
const { load } = require("./load.cjs");
const L = load(["views/locate.js"]);
const { parseOpen, fullTabs, spaceFullTabs, isVisible, mayTakeOpen, sideVisible, terminalLoc, nextLoc, lastLocUpdate } = L;
const plain = (x) => JSON.parse(JSON.stringify(x));

// Space s1: tab A has terminals in repo-a (pane pa) and repo-b (pane pb); tab F is a full tab.
const spaces = [{ id: "s1", machine: null, folder: "/home/u", tabs: [{ id: "A" }, { id: "F" }] }];
const panes = [
  { pane: "pa", terminal: "t1", tab: "A", cwd: "/w/repo-a", branch: "main" },
  { pane: "pb", terminal: "t2", tab: "A", cwd: "/w/repo-b", branch: "dev" },
  { pane: "pf", terminal: null, mod: "omni-forge", tab: "F", cwd: null, branch: null },
  { pane: "pl", terminal: null, mod: "omni-forge", tab: "A", cwd: null, branch: null },
];
const snapAt = (pane, tab) => ({
  focused: { space: "s1", tab, pane, terminal: panes.find((p) => p.pane === pane)?.terminal ?? null, cwd: panes.find((p) => p.pane === pane)?.cwd ?? null },
  panes,
  spaces,
});

test("parseOpen reads a watch key and rejects junk", () => {
  assert.deepEqual(plain(parseOpen('["gitlab","gl.test","g/p","12"]')), { kind: "gitlab", host: "gl.test", path: "g/p", runId: "12" });
  assert.equal(parseOpen("nope"), null);
  assert.equal(parseOpen(undefined), null);
  assert.equal(parseOpen('["github","github.com"]'), null);
});

test("fullTabs: tabs with only omni-forge panes", () => {
  assert.deepEqual(plain(fullTabs(panes)), ["F"]);
});

test("visible: own tab focused vs another tab", () => {
  assert.equal(isVisible({ focused: snapAt("pf", "F").focused, panes, windowActive: true }), true);
  assert.equal(isVisible({ focused: snapAt("pa", "A").focused, panes, windowActive: true }), false);
  // No full tab found: the window decides.
  const noFull = panes.filter((p) => p.tab !== "F");
  assert.equal(isVisible({ focused: snapAt("pa", "A").focused, panes: noFull, windowActive: true }), true);
  assert.equal(isVisible({ focused: snapAt("pa", "A").focused, panes: noFull, windowActive: false }), false);
});

test("terminalLoc is null on a mod pane", () => {
  assert.equal(terminalLoc(snapAt("pf", "F")), null);
  assert.equal(terminalLoc(snapAt("pl", "A")), null);
  assert.equal(terminalLoc(snapAt("pb", "A")).cwd, "/w/repo-b");
});

test("last-loc seeds a new tab instead of an arbitrary terminal", () => {
  const step = nextLoc({ loc: null, seenTerm: null, lastLoc: { cwd: "/w/repo-b", machine: null, branch: "dev" } }, snapAt("pf", "F"));
  assert.equal(step.move.cwd, "/w/repo-b");
  assert.equal(step.branch, "dev");
});

test("without last-loc, the focused terminal, then the tab/space fallback", () => {
  assert.equal(nextLoc({ loc: null }, snapAt("pb", "A")).move.cwd, "/w/repo-b");
  assert.equal(nextLoc({ loc: null }, snapAt("pf", "F")).move.cwd, "/w/repo-a");
});

test("a non-terminal focus keeps the location", () => {
  const loc = nextLoc({ loc: null }, snapAt("pb", "A"));
  for (const [pane, tab] of [["pf", "F"], ["pl", "A"]]) {
    const step = nextLoc({ loc: loc.move, seenTerm: loc.seenTerm }, snapAt(pane, tab));
    assert.equal(step.move, null);
    assert.equal(step.seenTerm, loc.seenTerm);
  }
});

test("a focused terminal with another cwd moves the location", () => {
  const first = nextLoc({ loc: null }, snapAt("pb", "A"));
  const step = nextLoc({ loc: first.move, seenTerm: first.seenTerm }, snapAt("pa", "A"));
  assert.equal(step.move.cwd, "/w/repo-a");
});

test("props.open's seed is not moved by the terminal focused when it opened", () => {
  const seed = { key: "open|gitlab|gl.test|g/p", cwd: null };
  const { seenTerm } = nextLoc({ loc: seed, seenTerm: null }, snapAt("pa", "A"));
  assert.equal(nextLoc({ loc: seed, seenTerm }, snapAt("pa", "A")).move, null);
  assert.equal(nextLoc({ loc: seed, seenTerm }, snapAt("pf", "F")).move, null);
  assert.equal(nextLoc({ loc: seed, seenTerm }, snapAt("pb", "A")).move.cwd, "/w/repo-b");
});

test("lastLocUpdate writes only on change and only for terminals", () => {
  const next = lastLocUpdate(null, snapAt("pa", "A"));
  assert.deepEqual(plain(next), { cwd: "/w/repo-a", machine: null, branch: "main" });
  assert.equal(lastLocUpdate(next, snapAt("pa", "A")), null);
  assert.equal(lastLocUpdate(next, snapAt("pf", "F")), null);
});

test("spaceFullTabs: full tabs of one space, in tab order", () => {
  const two = [...spaces, { id: "s2", tabs: [{ id: "G" }] }];
  const more = [...panes, { pane: "pg", terminal: null, mod: "omni-forge", tab: "G" }];
  assert.deepEqual(plain(spaceFullTabs(more, two, "s1")), ["F"]);
  assert.deepEqual(plain(spaceFullTabs(more, two, "s2")), ["G"]);
  assert.deepEqual(plain(spaceFullTabs(panes, spaces, "nope")), []);
});

// A synthetic layout: a sidebar, the tab area, and a right panel stack with Files and CI.
const tree = ({ panelHidden = false, active = "ci", sideProps } = {}) => ({
  id: "root", type: "row", children: [
    { id: "sidebar", type: "block", content: { mod: "better-sidebar" } },
    { id: "main", type: "block", content: { tab: "active" } },
    { id: "panel", type: "column", hidden: panelHidden, children: [
      { id: "panel-body", type: "stack", active, children: [
        { id: "files", type: "block", content: { mod: "better-files" } },
        { id: "ci", type: "block", content: { mod: "omni-forge", ...(sideProps ? { props: sideProps } : {}) } },
      ] },
    ] },
  ],
});

test("sideVisible: shown, panel hidden, another stack child active", () => {
  assert.equal(sideVisible(tree()), true);
  assert.equal(sideVisible(tree({ sideProps: { view: "side" } })), true);
  assert.equal(sideVisible(tree({ panelHidden: true })), false);
  assert.equal(sideVisible(tree({ active: "files" })), false);
});

test("sideVisible: a hidden block, a stack without active, no side block", () => {
  const t = tree();
  t.children[2].children[0].children[1].hidden = true;
  assert.equal(sideVisible(t), false);
  const first = tree();
  delete first.children[2].children[0].active;
  assert.equal(sideVisible(first), false); // the first child (files) shows
  first.children[2].children[0].children.reverse();
  assert.equal(sideVisible(first), true);
  assert.equal(sideVisible(tree({ sideProps: { view: "full" } })), false);
  assert.equal(sideVisible(null), false);
});

test("mayTakeOpen: only the copy whose own tab is the asked, focused tab", () => {
  const two = [...panes, { pane: "pg", terminal: null, mod: "omni-forge", tab: "G" }];
  const asked = { tab: "F", key: "k" };
  const onF = snapAt("pf", "F").focused;
  assert.equal(mayTakeOpen(asked, { focused: onF, panes: two, ownTab: "F" }), true);
  assert.equal(mayTakeOpen(asked, { focused: onF, panes: two, ownTab: "G" }), false);
  assert.equal(mayTakeOpen(asked, { focused: snapAt("pa", "A").focused, panes: two, ownTab: "F" }), false);
  // Own tab unknown: only when F is the one full tab anywhere.
  assert.equal(mayTakeOpen(asked, { focused: onF, panes: two, ownTab: null }), false);
  assert.equal(mayTakeOpen(asked, { focused: onF, panes, ownTab: null }), true);
  assert.equal(mayTakeOpen("k", { focused: onF, panes, ownTab: "F" }), false);
});

test("isVisible: a known own tab decides", () => {
  const two = [...panes, { pane: "pg", terminal: null, mod: "omni-forge", tab: "G" }];
  assert.equal(isVisible({ focused: snapAt("pf", "F").focused, panes: two, windowActive: true, ownTab: "G" }), false);
  assert.equal(isVisible({ focused: snapAt("pf", "F").focused, panes: two, windowActive: true, ownTab: "F" }), true);
});

test("sidePanelId: the side block's container that sits in a row", () => {
  const { sidePanelId } = load(["views/locate.js"]);
  const graph = { id: "root", type: "row", children: [
    { id: "work", type: "column", children: [
      { id: "work-body", type: "row", children: [
        { id: "main", type: "block", content: { tab: "active" } },
        { id: "panel", type: "column", children: [
          { id: "panel-body", type: "stack", active: "files", children: [
            { id: "files", type: "block", content: { mod: "better-files" } },
            { id: "ci", type: "block", content: { mod: "omni-forge", props: { view: "side" } } },
          ] },
        ] },
      ] },
    ] },
  ] };
  assert.equal(sidePanelId(graph), "panel");
  assert.equal(sidePanelId({ id: "root", type: "row", children: [{ id: "x", type: "block", content: { mod: "files" } }] }), null);
  assert.equal(sidePanelId({ id: "root", type: "row", children: [{ id: "ci", type: "block", content: { mod: "omni-forge" } }] }), "ci");
});

test("withModIcon adds omni-forge's icon once and keeps the others", () => {
  const { withModIcon } = load(["views/locate.js"]);
  const added = withModIcon({ "better-changes": "mods/better-changes/icons/file.svg" });
  assert.equal(added["omni-forge"], "mods/omni-forge/icons/ci.svg");
  assert.equal(added["better-changes"], "mods/better-changes/icons/file.svg");
  assert.equal(withModIcon(added), null); // already there: nothing to write
  assert.equal(withModIcon(undefined)["omni-forge"], "mods/omni-forge/icons/ci.svg");
});

test("mrKey and parseOpen round-trip; the array form is unchanged", () => {
  const { mrKey, parseOpen, MRS_KEY } = load(["views/locate.js"]);
  const key = mrKey({ kind: "gitlab", host: "git.example.org", path: "group/app", url: "x" }, 12);
  assert.equal(key, '{"kind":"gitlab","host":"git.example.org","path":"group/app","mr":12}');
  assert.deepEqual({ ...parseOpen(key) }, { kind: "gitlab", host: "git.example.org", path: "group/app", mr: "12" });
  assert.deepEqual({ ...parseOpen('["gitlab","h","p","3"]') }, { kind: "gitlab", host: "h", path: "p", runId: "3" });
  assert.equal(parseOpen('{"kind":"gitlab","host":"h","path":"p"}'), null);
  assert.equal(MRS_KEY, "mrs");
});

test("sideVisible and sidePanelId take the view name", () => {
  const { sideVisible, sidePanelId } = load(["views/locate.js"]);
  const t = { id: "root", type: "row", children: [
    { id: "main", type: "block", content: { tab: "active" } },
    { id: "panel", type: "stack", children: [{ id: "mrs", type: "block", content: { mod: "omni-forge", props: { view: "mrs" } } }] },
  ] };
  assert.equal(sideVisible(t, "mrs"), true);
  assert.equal(sideVisible(t), false);
  assert.equal(sidePanelId(t, "mrs"), "panel");
  assert.equal(sidePanelId(t), null);
});
