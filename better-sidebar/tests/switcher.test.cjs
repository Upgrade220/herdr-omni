// herdr-omni: the Spaces | Agents | Files switcher reads which one shows from the layout.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const runtime = path.join(__dirname, "../mods/better-sidebar");

const context = {};
vm.createContext(context);
// Each file in its own scope, as a module is; its exports become globals for the next.
for (const file of ["views/find-node.js", "views/switcher-state.js"]) {
  const source = fs.readFileSync(path.join(runtime, file), "utf8").replace(/^import\s+[\s\S]*?;\n/gm, "");
  const names = [...source.matchAll(/^export (?:async )?(?:class|function|const) (\w+)/gm)].map((m) => m[1]);
  vm.runInContext(`Object.assign(globalThis, (() => { ${source.replaceAll("export ", "")}\nreturn { ${names.join(", ")} }; })());`, context);
}
const { switcherState, readTab, hasFilesStack } = context;

const tree = (active) => ({
  id: "root",
  type: "row",
  children: [
    {
      id: "sidebar",
      type: "column",
      children: [
        { id: "switcher", type: "block" },
        {
          id: "sidebar-body",
          type: "stack",
          active,
          children: [
            { id: "spaces", type: "block" },
            { id: "files", type: "block" },
          ],
        },
      ],
    },
  ],
});

test("the stack showing files gives Files, whatever the lists tab", () => {
  assert.equal(switcherState(tree("files"), "agents"), "files");
  assert.equal(switcherState(tree("files"), "spaces"), "files");
});

test("the stack showing the lists gives the lists tab", () => {
  assert.equal(switcherState(tree("spaces"), "agents"), "agents");
  assert.equal(switcherState(tree("spaces"), "spaces"), "spaces");
});

test("with no sidebar-body stack in the tree, the lists tab", () => {
  assert.equal(switcherState({ id: "root", children: [{ id: "sidebar" }] }, "agents"), "agents");
  assert.equal(switcherState(null, "spaces"), "spaces");
});

test("the shared tab wins, then the copy's own, then Spaces", () => {
  assert.equal(readTab("agents", "spaces"), "agents");
  assert.equal(readTab(undefined, "agents"), "agents");
  assert.equal(readTab("unread", null), "spaces");
  assert.equal(readTab("files", "agents"), "agents");
});

test("the Files stack is there only when sidebar-body holds a files child", () => {
  assert.ok(hasFilesStack(tree("spaces")));
  assert.ok(!hasFilesStack({ id: "root", children: [{ id: "files", type: "block" }] }));
  assert.ok(!hasFilesStack(null));
});
