// The Diff tab (props.view "diff"): one file's diff, inline or side by side, with syntax colours.
// One per space. Changes and commit details hand it a target through shared DIFF_OPEN; it records
// its own tab in DIFF_TABS so the next click selects it instead of opening another.
// Ported from better-changes (https://github.com/munza/herdr-mods, Apache-2.0).
import { div, image } from "gpui-kit";
import { h_flex, v_flex, Scrollbar, v_virtual_list } from "gpui-base";
import { exec, readTextFile, theme, settings, shared, setShared, focused, panes, spaces, run, checking } from "herdr";
import { READ, gitError } from "./git.js";
import { splitDiffRows, conflictRows } from "./diff-rows.js";
import { WHOLE_FILE_LINES, languageOf, syntaxColors, tokenizeLine } from "./syntax.js";
import { diffArgs, rowsFromDiff, untrackedRows, scopeLabel, statusOf, statOf, capRows, DIFF_LINES } from "./diff-target.js";
import { DIFF_TABS, DIFF_OPEN, DIFF_LAYOUT, DIFF_FULL, MOD, pendingTarget } from "./place.js";
import { followFileIcons, fileIcon, isLight } from "./file-icons.js";

const TICK_MS = 300;
const EMPTY = "Pick a file in Changes or in a commit to see its diff.";
const TEXT = { caption: 11, small: 12, body: 13 };
const BAR_H = 30, ROW_H = 28;
// In widths of the code font's size, so a diff looks the same at any terminal size.
const CHAR_WIDTH = 0.62;
const GUTTERS = 10;
const codeFont = () => settings().font_family ?? "JetBrains Mono";
const codeSize = () => settings().font_size ?? 14;
const rowHeight = () => Math.round(codeSize() * 1.5);
const scrollWidth = (rows) => Math.max(300, ...rows.map((row) => ((row.text ?? "").length * CHAR_WIDTH + GUTTERS) * codeSize()));
const markColor = (t, s) => (s === "A" ? t.ansi2 : s === "D" || s === "!" ? t.ansi1 : t.ansi3);
const MARK_NAME = { M: "Modified", A: "Added", D: "Deleted", U: "Untracked", "!": "Conflict" };
const working = (target) => target && target.source !== "commit";
const wholeFile = (target) => target?.source === "untracked" || target?.source === "conflict";

export class DiffView {
  init(cx) {
    this.ownTab = null;
    this.target = null; this.seenAt = 0; this.targetSeq = 0;
    this.rows = []; this.pairedRows = []; this.width = 300; this.splitOffset = 0;
    this.note = null; this.error = null; this.loading = false; this.truncated = false;
    this.status = "M"; this.stat = { add: 0, del: 0 }; this.conflictCount = 0;
    this.token = 0; this.shownFull = null;
    this.seenChange = shared("git-graph.changed");
    try {
      const saved = JSON.parse(localStorage.getItem("target"));
      if (typeof saved?.target?.path === "string" && typeof saved.target.root === "string") {
        this.target = saved.target; this.seenAt = Number(saved.at) || 0; this.targetSeq++;
      }
    } catch {
      // Nothing saved, or not ours: the empty message shows.
    }
    followFileIcons(this, cx);
    if (this.target) this.load(cx);
    cx.timer.every(TICK_MS, (cx) => this.tick(cx));
  }

  layout() { return shared(DIFF_LAYOUT) === "split" ? "split" : "inline"; }
  full() { return shared(DIFF_FULL) === true; }

  // The space holding our tab.
  spaceId() { return spaces().find((s) => (s.tabs ?? []).some((t) => t.id === this.ownTab))?.id ?? null; }

  // The root's size report: this copy is on screen (a copy in a hidden tab gets no layout), so the
  // focused tab, when it holds git-graph panes alone, is ours. Right after tab.new or tab.select it is.
  laidOut() {
    if (this.ownTab) return;
    const f = focused();
    const mine = f ? panes().filter((p) => p.tab === f.tab) : [];
    if (mine.length && mine.every((p) => p.mod === MOD)) this.ownTab = f.tab;
  }

  // ---- the tick: registration, new targets, refreshes ------------------------------

  tick(cx) {
    if (checking() || !this.ownTab) return;
    const space = this.spaceId();
    if (!space) return;
    const map = shared(DIFF_TABS) ?? {};
    if (map[space] !== this.ownTab) setShared(DIFF_TABS, { ...map, [space]: this.ownTab });
    const entry = pendingTarget(shared(DIFF_OPEN), space, this.seenAt);
    if (entry?.target) { this.show(entry, cx); return; }
    const changed = shared("git-graph.changed");
    const full = this.full();
    if (changed !== this.seenChange) {
      this.seenChange = changed;
      if (working(this.target)) { this.load(cx); return; }
    }
    if (this.target && !wholeFile(this.target) && full !== this.shownFull) this.load(cx);
  }

  // A new target from Changes or a commit: kept for a restart, named on the tab, loaded.
  show(entry, cx) {
    this.seenAt = entry.at;
    const same = JSON.stringify(entry.target) === JSON.stringify(this.target);
    this.target = entry.target;
    try { localStorage.setItem("target", JSON.stringify({ target: entry.target, at: entry.at })); } catch { /* not kept */ }
    const name = String(entry.target.path ?? "").split("/").pop();
    if (name) run("tab.rename", { id: this.ownTab, name });
    if (!same) { this.targetSeq++; this.splitOffset = 0; this.rows = []; this.pairedRows = []; this.note = null; this.error = null; }
    this.load(cx);
  }

  // ---- loading ----------------------------------------------------------------------

  // full: the Full file setting, when the caller has just changed it.
  load(cx, full = this.full()) {
    const target = this.target;
    if (!target) return;
    const token = ++this.token;
    this.shownFull = full;
    this.loading = true;
    cx.notify();
    cx.spawn(async (cx) => {
      let result;
      try {
        result = await this.read(target, full);
      } catch (e) {
        result = { error: String(e?.message ?? e) };
      }
      // A newer pick, refresh or toggle started since: its result is the one to show.
      if (token !== this.token) return;
      this.loading = false;
      this.apply(result);
      cx.notify();
    });
  }

  // { rows, paired?, conflicts?, status, stdout? } | { message } | { error }
  async read(target, full) {
    const { root, on, path } = target;
    if (target.source === "untracked") {
      const text = await readTextFile(`${root}/${path}`, { on });
      return { ...untrackedRows(text), status: "U" };
    }
    if (target.source === "conflict") return { ...(await this.readConflict(target)), status: "!" };
    const args = diffArgs(target, full);
    const r = await exec("git", [...READ, ...args], { cwd: root, on });
    if (r.code !== 0) return { error: gitError(r) };
    return { ...rowsFromDiff(r.stdout), status: statusOf(target, r.stdout) };
  }

  // What to show for a conflicted file: its marked blocks, or a sentence when there are none,
  // as when one side deleted the file.
  async readConflict({ root, on, path }) {
    const stages = await exec("git", [...READ, "--literal-pathspecs", "ls-files", "-u", "-z", "--", path], { cwd: root, on });
    if (stages.code !== 0) return { error: gitError(stages) };
    const present = new Set(stages.stdout.split("\0").filter(Boolean).map((entry) => entry.split(/\s+/)[2]));
    if (!present.has("2")) return { message: "Conflict: deleted on your side, changed on the incoming side." };
    if (!present.has("3")) return { message: "Conflict: changed on your side, deleted on the incoming side." };
    const text = await readTextFile(`${root}/${path}`, { on });
    if (text === null) return { message: "Conflict: cannot read this file. It may be binary or too large." };
    if (text.includes("\0")) return { message: "Conflict: binary file, no text diff." };
    const found = conflictRows(text);
    return found
      ? { rows: found.inline, paired: found.split, conflicts: found.count }
      : { message: "No conflict markers left. Stage the file to mark it resolved." };
  }

  apply(result) {
    this.error = result.error ?? null;
    this.note = result.message ?? null;
    this.status = result.status ?? statusOf(this.target, "");
    this.conflictCount = result.conflicts ?? 0;
    if (!result.rows) {
      this.rows = []; this.pairedRows = []; this.truncated = false; this.stat = { add: 0, del: 0 };
      return;
    }
    // Git's counts for a conflict are of the markers, so they would mislead.
    this.stat = result.conflicts ? { add: 0, del: 0 } : statOf(result.rows);
    if (result.paired) {
      this.rows = result.rows; this.pairedRows = result.paired; this.truncated = false;
    } else {
      const capped = capRows(result.rows);
      this.rows = capped.rows; this.pairedRows = splitDiffRows(capped.rows); this.truncated = capped.truncated;
    }
    this.width = scrollWidth(this.rows);
  }

  // ---- drawing ----------------------------------------------------------------------

  render(_cx) {
    const t = theme();
    const root = v_flex().id("git-graph-diff").size_full().min_h(0).overflow_hidden().bg(t.background).text_color(t.foreground).text_size(TEXT.body)
      .on_size_change((_size, _cx) => this.laidOut());
    if (!this.target) return root.child(this.notice(EMPTY, t));
    const split = this.layout() === "split";
    root.child(this.header(t));
    if (this.error || this.note) root.child(this.message(this.error || this.note, t, Boolean(this.error)));
    if (this.loading && !this.rows.length && !this.note && !this.error) root.child(this.message("Loading diff…", t));
    if (this.rows.length) {
      if (split) root.child(this.columnTitles(t));
      root.child(this.diffRows(split, t));
    }
    if (this.truncated) root.child(this.message(`Showing the first ${DIFF_LINES.toLocaleString()} lines.`, t));
    return root;
  }

  notice(text, t) {
    return v_flex().flex_1().min_h(0).items_center().justify_center().px(28).pb(40)
      .child(div().max_w(320).text_center().text_size(TEXT.small).text_color(t.muted).child(text));
  }

  message(text, t, error = false) {
    return div().flex_none().p(8).text_size(TEXT.small).whitespace_normal().text_color(error ? t.ansi1 : t.dim).child(text);
  }

  // Status letter, icon, path, +a −d, what is compared, then Inline | Side by side and Full file.
  header(t) {
    const target = this.target;
    const parts = target.path.split("/"), name = parts.pop();
    const pic = fileIcon(this.fileIcons, `${target.root}/${target.path}`, { light: isLight(t.background) });
    const { add, del } = this.stat;
    return h_flex().h(BAR_H).flex_none().px(10).gap(8).items_center().border_b(1).border_color(t.border).text_size(TEXT.small)
      .child(div().id("diff-status").w(12).flex_none().text_center().text_size(TEXT.caption).font_semibold().text_color(markColor(t, this.status))
        .tooltip(MARK_NAME[this.status] ?? this.status).child(this.status))
      .when(Boolean(pic), (e) => e.child(image(pic).size(14).flex_none()))
      .child(div().flex_none().max_w(260).truncate().font_medium().child(name))
      .when(parts.length > 0, (e) => e.child(div().flex_shrink_1().min_w(0).truncate().text_color(t.dim).child(parts.join("/"))))
      .child(h_flex().flex_none().gap(5).text_size(TEXT.caption)
        .when(add > 0, (e) => e.child(div().text_color(t.ansi2).child(`+${add}`)))
        .when(del > 0, (e) => e.child(div().text_color(t.ansi1).child(`−${del}`))))
      .child(div().flex_1().min_w(0).truncate().text_size(TEXT.caption).text_color(t.muted).child(scopeLabel(target)))
      .child(this.layoutSwitch(t))
      .when(!wholeFile(target), (e) => e.child(this.textButton("diff-full-file", "Full file", this.full(), t, (cx) => {
        const full = !this.full();
        setShared(DIFF_FULL, full);
        this.load(cx, full);
      })));
  }

  layoutSwitch(t) {
    const now = this.layout();
    const option = (id, label) => this.textButton(`diff-layout-${id}`, label, now === id, t, (cx) => {
      if (this.layout() === id) return;
      setShared(DIFF_LAYOUT, id);
      cx.notify();
    });
    return h_flex().flex_none().gap(2).p(2).rounded(6).border_1().border_color(t.border)
      .child(option("inline", "Inline")).child(option("split", "Side by side"));
  }

  textButton(id, label, active, t, onClick) {
    return h_flex().id(id).h(20).flex_none().px(6).items_center().rounded(4).text_size(TEXT.caption)
      .text_color(active ? t.foreground : t.dim).when(active, (e) => e.bg(t.selected))
      .cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground))
      .on_click((_e, cx) => { cx.stop_propagation(); onClick(cx); })
      .child(label);
  }

  columnTitles(t) {
    const conflict = this.conflictCount > 0;
    return h_flex().h(ROW_H).flex_none().items_center().border_b(1).border_color(t.border).text_size(TEXT.caption).text_color(t.muted)
      .child(div().flex_1().px(12).child(conflict ? "Yours" : "Before"))
      .child(div().flex_1().h_full().flex().items_center().px(12).border_l(1).border_color(t.border).child(conflict ? "Incoming" : "After"));
  }

  diffRows(split, t) {
    const rows = split ? this.pairedRows : this.rows;
    const listId = `diff-${this.targetSeq}-${split ? "split" : "inline"}`;
    const list = v_virtual_list(listId, rows.length, rowHeight(), (i) => String(i),
      (range) => rows.slice(range.start, range.end).map((row) => (split ? this.splitRow(row, t) : this.inlineRow(row, t)))).size_full();
    return div().flex_1().min_h(0).relative().font_family(codeFont()).text_size(codeSize())
      .child(split ? this.scrollsTogether(list) : this.scrollsSideways(list))
      .child(Scrollbar.vertical(listId).viewport_from_layout().absolute().inset_0());
  }

  // Side by side moves both columns with one offset, keeping the line numbers still.
  // The shell wires input listeners on a plain div only, so the list is wrapped.
  scrollsTogether(list) {
    return div().id("diff-split").size_full().child(list).on_scroll_wheel((e, cx) => {
      const delta = e.delta.x || (e.modifiers?.shift ? e.delta.y : 0);
      if (!delta) return;
      const furthest = Math.max(0, (this.width || 300) - 160);
      this.splitOffset = Math.max(0, Math.min(furthest, this.splitOffset - delta));
      cx.stop_propagation();
      cx.notify();
    });
  }

  scrollsSideways(list) {
    return div().id("diff-x").size_full().overflow_x_scrollbar()
      .child(div().w_full().min_w(this.width || 300).h_full().child(list));
  }

  // The text colour and background of a row, by what kind of line it is.
  rowLook(kind, t) {
    const tinted = (color) => ({ color, background: `${color}26` });
    if (kind === "+" || kind === "incoming") return tinted(t.ansi2);
    if (kind === "-") return tinted(t.ansi1);
    if (kind === "yours") return tinted(t.accent);
    if (kind === "base") return { color: t.dim, background: null };
    if (kind === "marker") return { color: t.foreground, background: t.raised };
    return { color: t.foreground, background: null };
  }

  inlineRow(row, t) {
    if (row.kind === "@") return div().h(rowHeight()).px(12).w_full().bg(t.raised).text_color(t.accent).child(row.text);
    const { color, background } = this.rowLook(row.kind, t);
    const gutter = (value) => div().w(codeSize() * 3.5).flex_none().text_right().text_color(t.dim).child(value === undefined ? "" : String(value));
    const sign = row.kind === "+" || row.kind === "-" ? row.kind : "";
    return h_flex().h(rowHeight()).w_full().gap(8).items_center()
      .when(Boolean(background), (el) => el.bg(background))
      .when(!this.conflictCount, (el) => el.child(gutter(row.old)))
      .child(gutter(row.next))
      .child(div().w(codeSize()).flex_none().text_color(color).child(sign))
      .child(div().flex_1().min_w(0).whitespace_nowrap().child(this.codeText(row, color, t)));
  }

  splitRow(row, t) {
    if (row.kind !== "pair")
      return div().h(rowHeight()).px(12).w_full().bg(t.raised).text_color(row.kind === "@" ? t.accent : t.dim).truncate().child(row.text);
    const side = (entry, line, right) => {
      const { color, background } = this.rowLook(entry?.kind, t);
      const sign = entry?.kind === "+" || entry?.kind === "-" ? entry.kind : "";
      return h_flex().flex_1().min_w(0).h_full().gap(6).items_center().overflow_hidden()
        .when(right, (el) => el.border_l(1).border_color(t.border))
        .when(Boolean(background), (el) => el.bg(background))
        .when(!entry, (el) => el.bg(t.raised))
        .child(div().w(codeSize() * 3.5).flex_none().text_right().text_color(t.dim).child(entry ? String(line ?? "") : ""))
        .child(div().w(codeSize()).flex_none().text_color(color).child(sign))
        .child(div().flex_1().min_w(0).overflow_hidden()
          .child(div().w(this.width || 300).flex_none().ml(-this.splitOffset).whitespace_nowrap().child(this.codeText(entry, color, t))));
    };
    return h_flex().h(rowHeight()).w_full()
      .child(side(row.left, row.left?.old, false))
      .child(side(row.right, row.right?.next, true));
  }

  // Worked out once per diff, since rows are drawn on every scroll. The old and new sides
  // each carry their own open comment or string, and a hunk header starts both afresh. A
  // huge diff, or one the lexer fails on, is left to `runsOf`, a row at a time.
  highlightRows() {
    const language = languageOf(this.target?.path ?? "");
    const runs = new Map();
    let before = null;
    let after = null;
    try {
      if (this.rows.length <= WHOLE_FILE_LINES)
        for (const row of this.rows) {
          if (row.kind === "@" || row.kind === "marker") { before = after = null; continue; }
          if (!["+", "-", " ", "yours", "incoming"].includes(row.kind)) continue;
          const result = tokenizeLine(row.text ?? "", language, row.kind === "-" ? before : after);
          runs.set(row, result.runs);
          if (row.kind === "-") before = result.state;
          else if (row.kind === " ") before = after = result.state;
          else after = result.state;
        }
    } catch {
      runs.clear();
    }
    this.syntaxFor = this.rows;
    this.syntaxRuns = runs;
  }

  // A conflict's side-by-side rows are copies, so they miss the map and start fresh.
  runsOf(row) {
    if (["@", "marker", "base", ""].includes(row.kind)) return null;
    if (this.syntaxFor !== this.rows) this.highlightRows();
    const runs = this.syntaxRuns.get(row);
    if (runs) return runs;
    try {
      return tokenizeLine(row.text ?? "", languageOf(this.target?.path ?? "")).runs;
    } catch {
      return [{ text: row.text ?? "", kind: null }];
    }
  }

  // Text that isn't a token takes the theme's own colour on a change: the background and
  // the sign already say it was added or removed.
  codeText(row, color, t) {
    const runs = row ? this.runsOf(row) : null;
    if (!runs) return div().text_color(color).child(row?.text || " ");
    const colors = syntaxColors(t);
    return h_flex().children(runs.map((r) => div().flex_none().whitespace_nowrap().text_color(colors[r.kind] ?? t.foreground).child(r.text || " ")));
  }
}
