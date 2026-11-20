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

// theme-code.js imports herdr; its pure part is loaded without the imports.
import { CODE_COLORS } from "../mods/git-graph/syntax.js";
const tc = (() => {
  const src = readFileSync(fileURLToPath(new URL("../mods/git-graph/theme-code.js", import.meta.url)), "utf8")
    .replace(/^import\s+[\s\S]*?;$/gm, "").replace(/^export /gm, "");
  return new Function("CODE_COLORS", `${src}\nreturn { signature, matchTheme, codeColorsFrom };`)(CODE_COLORS);
})();

const ansi = ["#000000", "#f0524f", "#5c962c", "#a68a0d", "#3993d4", "#a771bf", "#00a3a3", "#808080",
  "#595959", "#ff4050", "#4fc414", "#e5bf00", "#1fb0ff", "#ed7eed", "#00e5e5", "#ffffff"];
const shown = { background: "#191A1C", foreground: "#bcbec4", dim: "#7a7e85",
  ...Object.fromEntries(ansi.map((c, i) => [`ansi${i}`, c])) };
const islands = { background: "#191a1c", foreground: "#BCBEC4", ansi };
const islandsCode = { keyword: "#cf8e6d", string: "#6aab73", comment: "dim", type: "foreground" };

test("the theme whose colours are shown gives its code colours (case and alpha ignored)", () => {
  const other = { data: { background: "#1f1f24", foreground: "#dfdfe0", ansi }, code: { keyword: "#fc5fa3" } };
  const withAlpha = { ...shown, background: "#191a1cff" };
  assert.deepEqual(tc.matchTheme(withAlpha, [other, { data: islands, code: islandsCode }]), islandsCode);
});

test("no matching theme: no code colours", () => {
  assert.equal(tc.matchTheme(shown, [{ data: { ...islands, background: "#000001" }, code: islandsCode }]), null);
});

test("a theme's own code colours win; names are theme colours; the rest keep the pairing", () => {
  const colors = tc.codeColorsFrom({ ...shown, foreground: "#bcbec4" }, islandsCode);
  assert.equal(colors.keyword, "#cf8e6d");
  assert.equal(colors.string, "#6aab73");
  assert.equal(colors.comment, "#7a7e85");
  assert.equal(colors.type, "#bcbec4");
  assert.equal(colors.number, shown.ansi3);
});

test("without code colours, code takes the pairing", () => {
  assert.deepEqual(tc.codeColorsFrom(shown, null), syntaxColors(shown));
});

test("better-files keeps the same theme-code.js", { skip: !existsSync(new URL("../../better-files/mods/better-files/theme-code.js", import.meta.url)) && "better-files not here" }, () => {
  const read = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
  assert.equal(read("../../better-files/mods/better-files/theme-code.js"), read("../mods/git-graph/theme-code.js"));
});
