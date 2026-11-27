// Evaluates mod files in one vm context and returns their exports (imports stripped).
// Paths are relative to mods/omni-restore/.
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const root = path.join(__dirname, "../mods/omni-restore");

function load(files, globals = {}) {
  const context = { console, ...globals };
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
