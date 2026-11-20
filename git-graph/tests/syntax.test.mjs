// syntaxColors: which theme colour each kind of code takes (Xcode's layout), from the theme only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { syntaxColors } from "../mods/git-graph/syntax.js";

const theme = Object.fromEntries([...Array(16).keys()].map((i) => [`ansi${i}`, `#slot${i}`]));
theme.dim = "#dim";

test("code takes Xcode's layout of theme colours", () => {
  assert.deepEqual(syntaxColors(theme), {
    keyword: "#slot5",
    string: "#slot1",
    number: "#slot3",
    type: "#slot6",
    function: "#slot2",
    constant: "#slot14",
    attribute: "#slot11",
    property: "#slot13",
    tag: "#slot5",
    comment: "#dim",
  });
});

test("better-files keeps the same map", { skip: !existsSync(new URL("../../better-files/mods/better-files/syntax.js", import.meta.url)) && "better-files not here" }, () => {
  const map = (path) => {
    const src = readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
    const start = src.indexOf("export const CODE_COLORS");
    return src.slice(start, src.indexOf("\n};\n", start));
  };
  assert.equal(map("../../better-files/mods/better-files/syntax.js"), map("../mods/git-graph/syntax.js"));
});
