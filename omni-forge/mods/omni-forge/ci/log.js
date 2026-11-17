// Pure CI log cleanup: strips GitLab section markers, \r overwrites, GitHub timestamps and
// non-colour escapes; turns SGR colours into spans. `fg` is an ansi index 0..15 (theme().ansiN).

const ERROR = /(^|\b)(error|failed|ERROR|FAIL)\b|##\[error\]/;
const SECTION = /section_(?:start|end):\d+:[^\r\n\x1b]*\r?(?:\x1b\[0K)?/g;
const STAMP = /^\d{4}-\d\d-\d\dT[\d:.]+Z /;
const ESCAPE = /\x1b\[([0-9;?]*)([A-Za-z])|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[()][A-Z0-9]|\x1b[=>78]/g;

export function cleanLog(text) {
  const lines = [];
  let firstError = null;
  let fg;
  let bold = false;

  for (const rawLine of String(text ?? "").split("\n")) {
    let line = rawLine.replace(STAMP, "");
    const hadMarker = SECTION.test(line);
    SECTION.lastIndex = 0;
    line = line.replace(SECTION, "");
    line = line.replace(/\r+$/, "");
    const cr = line.lastIndexOf("\r");
    if (cr >= 0) line = line.slice(cr + 1);
    if (hadMarker && line.replace(ESCAPE, "") === "") continue;

    const spans = [];
    let plainText = "";
    const push = (t) => {
      if (!t) return;
      plainText += t;
      const last = spans[spans.length - 1];
      if (last && last.fg === fg && !!last.bold === bold) last.text += t;
      else spans.push({ text: t, ...(fg !== undefined && { fg }), ...(bold && { bold: true }) });
    };

    let at = 0;
    for (const m of line.matchAll(ESCAPE)) {
      push(line.slice(at, m.index));
      at = m.index + m[0].length;
      if (m[2] !== "m") continue;
      for (const code of (m[1] === "" ? "0" : m[1]).split(";").map(Number)) {
        if (code === 0) { fg = undefined; bold = false; }
        else if (code === 1) bold = true;
        else if (code === 22) bold = false;
        else if (code === 39) fg = undefined;
        else if (code >= 30 && code <= 37) fg = code - 30;
        else if (code >= 90 && code <= 97) fg = code - 90 + 8;
      }
    }
    push(line.slice(at));

    if (firstError === null && ERROR.test(plainText)) firstError = lines.length;
    lines.push({ spans });
  }
  // A trailing newline leaves one empty final line; drop it.
  if (lines.length && lines[lines.length - 1].spans.length === 0) lines.pop();
  return { lines, firstError };
}
