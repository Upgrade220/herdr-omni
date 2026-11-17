// Shared test loader: evaluates mod files in one vm context and returns their exports.
// Usage: load(["forge/detect.js", "forge/cli.js"], { extra: globals }) -> { name: value, ... }
// Paths are relative to mods/omni-forge/. `import` statements are stripped; each file runs in its
// own scope, and its exports become globals for the files after it.
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const root = path.join(__dirname, "../mods/omni-forge");

function load(files, globals = {}) {
  const context = { console, URL, URLSearchParams, setTimeout, clearTimeout, ...globals };
  vm.createContext(context);
  const exported = {};
  for (const file of files) {
    const source = fs.readFileSync(path.join(root, file), "utf8").replace(/^import\s+[\s\S]*?;\n/gm, "");
    const names = [...source.matchAll(/^export (?:async )?(?:class|function|const|let) (\w+)/gm)].map((m) => m[1]);
    const out = vm.runInContext(`(() => { ${source.replaceAll(/^export /gm, "")}\nreturn { ${names.join(", ")} }; })()`, context);
    Object.assign(context, out);
    Object.assign(exported, out);
  }
  return exported;
}

module.exports = { load };
