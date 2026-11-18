// Unnamed tabs show a label from their lead pane instead of "1", "2".
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../mods/better-sidebar/views/tab-label.js"), "utf8").replace(/^export /gm, "");
const context = {};
vm.createContext(context);
vm.runInContext(`${source}\nglobalThis.tabLabel = tabLabel;`, context);
const { tabLabel } = context;

const tab = (name, named = false) => ({ id: "T", name, named });
const term = (extra) => ({ pane: "p", tab: "T", terminal: "t1", cwd: "/w/herdr-omni", focused: false, ...extra });
const claude = { name: "Claude Code", key: "claude", agent: true, shell: false };
const zsh = { name: "zsh", key: "zsh", agent: false, shell: true };
const nvim = { name: "nvim", key: "nvim", agent: false, shell: false };

test("an agent's title, without its spinner glyph", () => {
  assert.equal(tabLabel(tab("1"), [term({ title: "✳ Fix totals", program: claude })]), "Fix totals");
});

test("a shell whose title is a path shows its folder", () => {
  assert.equal(tabLabel(tab("2"), [term({ title: "~/repos/x", program: zsh, cwd: "/w/x" })]), "x");
  assert.equal(tabLabel(tab("2"), [term({ title: "me@host: ~", program: zsh, cwd: "/w/y" })]), "y");
});

test("a program without a telling title shows the program", () => {
  assert.equal(tabLabel(tab("3"), [term({ title: "nvim", program: nvim })]), "nvim");
});

test("a named tab keeps its name", () => {
  assert.equal(tabLabel(tab("fix login", true), [term({ title: "✳ Something else", program: claude })]), "fix login");
});

test("a mod-only tab shows the mod's title", () => {
  assert.equal(tabLabel(tab("4"), [{ pane: "m", tab: "T", terminal: null, mod: "omni-forge", title: "omni-forge", cwd: null }]), "omni-forge");
});

test("the agent pane leads over a focused shell", () => {
  const panes = [term({ title: "~/w", program: zsh, focused: true }), term({ pane: "q", terminal: "t2", title: "✳ Review PR", program: claude })];
  assert.equal(tabLabel(tab("5"), panes), "Review PR");
});

test("nothing to go on keeps Herdr's name", () => {
  assert.equal(tabLabel(tab("6"), []), "6");
});

test("a tab named after its program (the + menu names agent tabs so) still shows the title", () => {
  assert.equal(tabLabel(tab("Claude Code", true), [term({ title: "✳ Fix totals", program: claude })]), "Fix totals");
});
