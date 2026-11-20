// herdr-omni: code colours from the theme in use. Beside themes/<name>.json, a file
// code-colors/<name>.json may name the colour of each kind of code ("#rrggbb", or a theme
// colour name such as "ansi5" or "dim"); without one, code takes CODE_COLORS' pairing of the
// theme's colours. (Herdr refuses unknown fields in a theme file, so they can't live there.)
// A mod can't ask which theme is shown, so the theme file whose colours match theme() is the
// one. Kept identical in git-graph and better-files; a test checks.
import { appHome, exec, readTextFile, theme } from "herdr";
import { CODE_COLORS } from "./syntax.js";

const LOOK_MS = 2000;
const norm = (color) => String(color ?? "").toLowerCase().replace(/^(#[0-9a-f]{6})ff$/, "$1");

// The colours that tell themes apart: background, text and the 16 terminal colours.
export function signature(t) {
  return [t.background, t.foreground, ...[...Array(16).keys()].map((i) => t[`ansi${i}`])].map(norm).join(",");
}

const fileSignature = (data) =>
  [data.background, data.foreground, ...(data.ansi ?? [])].map(norm).join(",");

// The code colours of the theme shown now, or null. files: [{ data: theme file, code }].
export function matchTheme(t, files) {
  const want = signature(t);
  const found = (files ?? []).find((f) => f?.data && fileSignature(f.data) === want);
  return found?.code ?? null;
}

// Each kind of code's colour: the theme file's own choice, else the pairing.
export function codeColorsFrom(t, code) {
  return Object.fromEntries(
    Object.entries(CODE_COLORS).map(([kind, name]) => {
      const own = code?.[kind];
      const color = typeof own === "string" ? (own.startsWith("#") ? own : t[own]) : null;
      return [kind, color ?? t[name]];
    }),
  );
}

// Keeps view.themeCode current: reads themes/*.json when the theme's colours change, checked
// every 2 s (never while drawing). Redraws the view when the result changes.
export function followThemeCode(view, cx) {
  view.themeCode ??= null;
  let seen = null;
  const look = (cx) => {
    const sig = signature(theme());
    if (sig === seen) return;
    seen = sig;
    cx.spawn(async (cx) => {
      const files = await readThemes().catch(() => []);
      if (seen !== sig) return;
      const code = matchTheme(theme(), files);
      if (JSON.stringify(code) === JSON.stringify(view.themeCode)) return;
      view.themeCode = code;
      cx.notify();
    });
  };
  look(cx);
  cx.timer.every(LOOK_MS, look);
}

// Only themes that have code colours are read.
async function readThemes() {
  const home = appHome();
  const r = await exec("sh", ["-c", 'for f in "$1"/code-colors/*.json; do [ -f "$f" ] && printf "%s\\0" "${f##*/}"; done', "themes", home]);
  if (r.code !== 0) return [];
  const names = r.stdout.split("\0").filter(Boolean);
  const files = await Promise.all(
    names.map(async (name) => {
      try {
        const [data, code] = await Promise.all([
          readTextFile(`${home}/themes/${name}`),
          readTextFile(`${home}/code-colors/${name}`),
        ]);
        return { data: JSON.parse(data), code: JSON.parse(code) };
      } catch {
        return null;
      }
    }),
  );
  return files.filter(Boolean);
}
