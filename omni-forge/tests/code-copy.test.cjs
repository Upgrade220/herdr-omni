// omni-forge colours code with git-graph's highlighter; mods can't import each other, so it keeps
// copies, which must stay identical.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const mine = (f) => path.join(__dirname, "../mods/omni-forge/code", f);
const theirs = (f) => path.join(__dirname, "../../git-graph/mods/git-graph", f);

for (const f of ["syntax.js", "theme-code.js"]) {
  test(`code/${f} is git-graph's ${f}`, { skip: !fs.existsSync(theirs(f)) && "git-graph not here" }, () => {
    assert.equal(fs.readFileSync(mine(f), "utf8"), fs.readFileSync(theirs(f), "utf8"));
  });
}
