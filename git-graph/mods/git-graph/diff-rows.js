// Ported from better-changes (https://github.com/munza/herdr-mods, Apache-2.0).
// Pure diff row logic: line numbers, split pairing and conflict blocks.

/**
 * Attach old/new line numbers to unified diff lines. Hunk headers reset both
 * counters; metadata such as "No newline at end of file" consumes neither.
 */
export function diffRows(lines) {
  let oldLine = 0;
  let newLine = 0;
  return lines.map((text) => {
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)/.exec(text);
    if (hunk) {
      oldLine = Number(hunk[1]);
      newLine = Number(hunk[2]);
      return { kind: "@", text };
    }

    const kind = text[0];
    if (kind === "-") return { kind, old: oldLine++, text: text.slice(1) };
    if (kind === "+") return { kind, next: newLine++, text: text.slice(1) };
    if (kind === " ") {
      return { kind, old: oldLine++, next: newLine++, text: text.slice(1) };
    }
    return { kind: "", text };
  });
}

/**
 * Align each replacement block by position, not textual similarity. Missing
 * counterparts become blank cells. Never pair across context or hunk boundaries.
 */
export function splitDiffRows(rows) {
  const paired = [];
  const removed = [];
  const added = [];

  function flushReplacement() {
    for (let index = 0; index < Math.max(removed.length, added.length); index++) {
      paired.push({
        kind: "pair",
        left: removed[index] ?? null,
        right: added[index] ?? null,
      });
    }
    removed.length = 0;
    added.length = 0;
  }

  for (const row of rows) {
    if (row.kind === "-") removed.push(row);
    else if (row.kind === "+") added.push(row);
    else {
      flushReplacement();
      // Context appears on both sides; headers and metadata span both columns.
      paired.push(row.kind === " " ? { kind: "pair", left: row, right: row } : row);
    }
  }
  flushReplacement();
  return paired;
}

const CONTEXT_LINES = 3;

// Split a conflicted file into its plain lines and its marked blocks, each line
// keeping its number in the file. A marker with no end stays plain text.
function conflictParts(text) {
  const lines = text
    .replace(/\n$/, "")
    .split("\n")
    .map((text, index) => ({ text, line: index + 1 }));
  const parts = [];
  let plain = [];
  for (let i = 0; i < lines.length; i++) {
    const block = /^<{7}( |$)/.test(lines[i].text) ? readBlock(lines, i) : null;
    if (!block) {
      plain.push(lines[i]);
      continue;
    }
    parts.push({ plain }, { block });
    plain = [];
    i = block.end;
  }
  parts.push({ plain });
  return parts;
}

// One block from its `<<<<<<<`: yours, the optional `|||||||` base, and incoming.
function readBlock(lines, start) {
  const block = { open: lines[start], yours: [], base: [], incoming: [], end: start };
  let section = block.yours;
  for (let i = start + 1; i < lines.length; i++) {
    const { text } = lines[i];
    if (section === block.yours && /^\|{7}( |$)/.test(text)) {
      block.baseMarker = lines[i];
      section = block.base;
    } else if (section !== block.incoming && text === "=======") {
      block.divider = lines[i];
      section = block.incoming;
    } else if (section === block.incoming && /^>{7}( |$)/.test(text)) {
      block.close = lines[i];
      block.end = i;
      return block;
    } else {
      section.push(lines[i]);
    }
  }
  return null;
}

/**
 * Rows for showing a conflicted file with its traditional markers: only the
 * blocks, with a few lines around each. `inline` keeps the file as it is;
 * `split` puts yours on the left and incoming on the right. Null if no markers.
 */
export function conflictRows(text) {
  const parts = conflictParts(text);
  const count = parts.filter((part) => part.block).length;
  if (!count) return null;
  const inline = [];
  const split = [];
  const context = (entry) => ({ kind: " ", old: entry.line, next: entry.line, text: entry.text });
  const marker = (entry) => ({
    kind: "marker",
    old: entry.line,
    next: entry.line,
    text: entry.text,
  });
  // Two blocks close together share the lines between them, so show those once.
  let shownUpTo = 0;
  const addContext = (entries) => {
    for (const entry of entries) {
      if (entry.line <= shownUpTo) continue;
      shownUpTo = entry.line;
      inline.push(context(entry));
      split.push({ kind: "pair", left: context(entry), right: context(entry) });
    }
  };
  let number = 0;
  parts.forEach((part, index) => {
    if (!part.block) return;
    number++;
    const { open, yours, baseMarker, base, divider, incoming, close } = part.block;
    const before = parts[index - 1].plain;
    const after = parts[index + 1].plain;
    const heading = { kind: "@", text: `Conflict ${number} of ${count} · line ${open.line}` };
    inline.push(heading);
    split.push(heading);
    addContext(before.slice(-CONTEXT_LINES));

    inline.push(marker(open));
    for (const entry of yours)
      inline.push({ kind: "yours", next: entry.line, old: entry.line, text: entry.text });
    if (baseMarker) {
      inline.push(marker(baseMarker));
      for (const entry of base)
        inline.push({ kind: "base", next: entry.line, old: entry.line, text: entry.text });
    }
    inline.push(marker(divider));
    for (const entry of incoming)
      inline.push({ kind: "incoming", next: entry.line, old: entry.line, text: entry.text });
    inline.push(marker(close));

    split.push({ kind: "pair", left: marker(open), right: marker(close) });
    for (let i = 0; i < Math.max(yours.length, incoming.length); i++) {
      const left = yours[i] && { kind: "yours", old: yours[i].line, text: yours[i].text };
      const right = incoming[i] && {
        kind: "incoming",
        next: incoming[i].line,
        text: incoming[i].text,
      };
      split.push({ kind: "pair", left: left ?? null, right: right ?? null });
    }
    split.push({ kind: "pair", left: marker(divider), right: marker(divider) });

    shownUpTo = close.line;
    addContext(after.slice(0, CONTEXT_LINES));
  });
  return { inline, split, count };
}
