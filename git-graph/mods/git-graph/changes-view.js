// The Changes tab: staged and unstaged files (as a list or a tree), stage, unstage and
// discard (after a confirm bar), and a folded commit box. A file opens in the space's Diff tab.
// The graph owns it: it feeds each status read through update() and draws render() under its header.
// Ported from git-panel (https://github.com/LaiqianDS/herdr-mods, Apache-2.0), itself from Herdr's shipped changes mod.
import { div, svg, image } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, TextareaState, Textarea } from "gpui-base";
import { exec, shared, setShared } from "herdr";
import { gitError } from "./git.js";
import { splitChanges, changeCount, fileTree, visibleRows, stageArgs, stageAllArgs, unstageArgs, unstageAllArgs,
  discardPlan, commitPlan, commitLabel, swapDraft, rowSource, pushPlan } from "./changes.js";
import { openDialog } from "./act.js";
import { openDiff } from "./diff-open.js";
import { followFileIcons, fileIcon, isLight } from "./file-icons.js";
import { icon } from "./menu.js";
import { VIEW_KEY } from "./place.js";

const MAX_ROWS = 1000;
// The side tab strip's height (its border inside it): the graph counts it above its list.
export const TAB_H = 34;
const markColor = (t, s) => (s === "A" ? t.ansi2 : s === "D" || s === "!" ? t.ansi1 : t.ansi3);
const MARK_NAME = { M: "Modified", A: "Added", D: "Deleted", U: "Untracked", "!": "Conflict" };

export class ChangesView {
  // owner: the graph, which gives { root, on, head, files, state, handle, refreshNow(cx) }.
  init(owner, cx) {
    this.owner = owner;
    this.root = null; this.files = []; this.hasHead = false; this.staged = []; this.work = [];
    this.tree = localStorage.getItem("tree") === "true";
    this.commitOpen = localStorage.getItem("commitOpen") === "true";
    this.collapsed = new Set(); this.hot = null; this.asking = null; this.error = null; this.busy = false;
    this.title = ""; this.drafts = new Map();
    this.input = InputState.new({ placeholder: "Commit title · Enter to commit" });
    this.body = TextareaState.new({ placeholder: "Description (optional)" });
    this.body.set_auto_grow(2, 6);
    this.input.on("change", (_e, cx) => {
      const had = Boolean(this.title.trim());
      this.title = this.input.value();
      if (had !== Boolean(this.title.trim())) cx.notify();
    });
    this.input.on("submit", (_e, cx) => this.commit(cx));
    for (const [state, name] of [[this.input, "typingTitle"], [this.body, "typingBody"]]) {
      state.on("focus", (_e, cx) => { this[name] = true; cx.notify(); });
      state.on("blur", (_e, cx) => { this[name] = false; cx.notify(); });
    }
    followFileIcons(this, cx);
  }

  // A status read.
  update(files, hasHead) {
    this.files = files; this.hasHead = hasHead;
    ({ staged: this.staged, work: this.work } = splitChanges(files));
  }

  // Another folder in the graph: start from what it holds now, with that repo's commit draft.
  sync() {
    const o = this.owner;
    if (this.root === o.root) return;
    const draft = swapDraft(this.drafts, this.root, o.root, { title: this.input.value(), body: this.body.value() });
    this.title = draft.title; this.input.set_value(draft.title); this.body.set_value(draft.body);
    this.root = o.root; this.asking = null; this.error = null; this.collapsed.clear();
    this.update(o.files ?? [], Boolean(o.head));
  }

  count() { this.sync(); return changeCount(this.files); }
  view() { return shared(VIEW_KEY) === "changes" ? "changes" : "graph"; }

  // Esc: the confirm bar, then the commit fields. False when there was nothing to close.
  escape() {
    if (this.asking) { this.asking = null; return true; }
    if (this.typingTitle || this.typingBody) { this.owner.handle.focus(); return true; }
    return false;
  }

  // Runs git's argument lists in order, stopping at the first failure; then every graph copy reads again.
  run(list, cx, ok) {
    if (this.busy || !this.root || !list) return;
    const root = this.root, on = this.owner.on;
    this.busy = true; this.error = null; this.asking = null; this.hot = null;
    cx.spawn(async (cx) => {
      try {
        for (const args of list) {
          const r = await exec("git", args, { cwd: root, on });
          if (r.code !== 0) { if (this.root === root) this.error = gitError(r); return; }
        }
        ok?.();
      } catch (e) {
        if (this.root === root) this.error = String(e?.message ?? e);
      } finally {
        this.busy = false; this.pushing = false;
        setShared("git-graph.changed", Date.now());
        this.owner.refreshNow(cx);
        cx.notify();
      }
    });
    cx.notify();
  }

  discard(changes, cx) {
    const plan = discardPlan(changes);
    if (!plan) return;
    this.asking = plan;
    cx.notify();
  }

  commit(cx) {
    const list = commitPlan(this.title, this.body.value(), this.staged.length, this.conflicted());
    if (!list || this.busy || !(this.staged.length + this.work.length)) return;
    const root = this.root;
    // Done after a switch to another repo: the committed draft is the one kept for `root`.
    this.run(list, cx, () => { if (this.root !== root) { this.drafts.delete(root); return; } this.title = ""; this.input.set_value(""); this.body.set_value(""); });
  }

  conflicted() { return this.work.some((f) => f.s === "!"); }

  // herdr-omni: Push beside the commit box; Publish opens the push dialog to pick a remote.
  pushPlan() {
    const o = this.owner;
    return pushPlan({ current: o.current, upstream: o.upstream, ahead: o.ahead, remotes: o.remoteNames });
  }

  push(cx) {
    const plan = this.pushPlan();
    if (!plan?.enabled || this.busy) return;
    if (plan.dialog) { if (this.owner.ctx) openDialog(plan.dialog, this.owner.ctx); return; }
    this.pushing = true;
    this.run(plan.args, cx, () => {});
  }

  setTree(tree, cx) { this.tree = tree; localStorage.setItem("tree", String(tree)); cx.notify(); }
  setCommitOpen(open, cx) { this.commitOpen = open; localStorage.setItem("commitOpen", String(open)); cx.notify(); }
  flip(key, cx) { this.collapsed.has(key) ? this.collapsed.delete(key) : this.collapsed.add(key); cx.notify(); }

  // Rows show their buttons only while hovered; GPUI has no group hover, so the row id is kept here.
  hover(id, on, cx) {
    const next = on ? id : this.hot === id ? null : this.hot;
    if (next === this.hot) return;
    this.hot = next;
    cx.notify();
  }

  show(kind, f) {
    if (this.root) openDiff({ root: this.root, on: this.owner.on ?? null, path: f.path, source: rowSource(kind, f) });
  }

  // ---- drawing

  // Under the graph's header: Changes (with how many files changed) and Graph.
  sideTabs(t) {
    const view = this.view(), n = this.owner.root ? this.count() : 0;
    const tab = (id, label, badge) => h_flex().id(`graph-tab-${id}`).h(24).px(9).gap(6).items_center().rounded(6).cursor_pointer().text_size(12)
      .text_color(view === id ? t.foreground : t.muted).when(view === id, (e) => e.bg(t.selected))
      .hover((s) => s.bg(t.hover).text_color(t.foreground))
      .on_click((_e, cx) => { if (this.view() !== id) { setShared(VIEW_KEY, id); cx.notify(); } })
      .child(label)
      .when(badge > 0, (e) => e.child(div().flex_none().px(6).rounded(8).bg(t.hover).text_size(10).text_color(t.muted).child(String(badge))));
    return h_flex().h(TAB_H).flex_none().px(8).gap(4).items_center().border_b(1).border_color(t.border)
      .child(tab("changes", "Changes", n)).child(tab("graph", "Graph", 0));
  }

  button(id, glyph, tip, fn, t) {
    return div().id(id).size(22).flex_none().flex().items_center().justify_center().rounded(5).cursor_pointer().text_color(t.muted)
      .hover((s) => s.bg(t.hover).text_color(t.foreground)).active((s) => s.bg(t.selected)).tooltip(tip)
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => { cx.stop_propagation(); fn(cx); })
      .child(svg(icon(glyph)).size(14));
  }

  picture(path, t, opts) {
    const pic = fileIcon(this.fileIcons, path, { ...opts, light: isLight(t.background) });
    return pic ? image(pic).size(16).flex_none() : null;
  }

  section(title, n, actions, t) {
    return h_flex().h(28).flex_none().px(8).gap(2).items_center().bg(t.raised).rounded(6)
      .child(h_flex().flex_1().min_w(0).gap(6).items_center()
        .child(div().font_semibold().text_size(12).truncate().child(title))
        .child(div().flex_none().px(6).rounded(8).bg(t.hover).text_size(10).text_color(t.muted).child(String(n))))
      .children(actions);
  }

  fileRow(f, kind, depth, flat, t) {
    const parts = f.path.split("/"), name = parts.pop(), id = `${kind}-${f.path}`, mark = f.fresh ? "U" : f.s;
    const shown = this.hot === id && !this.busy, pic = this.picture(f.path, t, {});
    const row = h_flex().id(`row-${id}`).h(26).flex_none().pl(8 + depth * 14).pr(4).gap(4).items_center().rounded(6)
      .hover((s) => s.bg(t.hover)).on_hover((on, cx) => this.hover(id, on, cx))
      .child(h_flex().id(`file-${id}`).flex_1().min_w(0).h_full().gap(6).items_center().cursor_pointer().on_click(() => this.show(kind, f))
        .when(Boolean(pic), (e) => e.child(pic))
        .child(div().min_w(0).truncate().text_color(markColor(t, f.s)).when(f.s === "D", (e) => e.line_through()).child(name))
        .when(flat && parts.length > 0, (e) => e.child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.dim).child(parts.join("/")))));
    // Invisible until hovered: the pointer is on the row before it can reach the button.
    const action = (glyph, tip, fn) => this.button(`${glyph}-${id}`, glyph, tip, fn, t).opacity(shown ? 1 : 0);
    if (kind === "staged") row.child(action("minus", "Unstage changes", (cx) => this.run(unstageArgs([f.path], this.hasHead), cx)));
    if (kind === "work" && f.s !== "!") row.child(action("undo", f.fresh ? "Delete file" : "Discard changes", (cx) => this.discard([f], cx)));
    if (kind === "work") row.child(action("plus", f.s === "!" ? "Stage (mark resolved)" : "Stage changes", (cx) => this.run(stageArgs([f.path]), cx)));
    return row.child(div().id(`mark-${id}`).w(16).flex_none().text_center().text_size(11).font_semibold().text_color(markColor(t, f.s)).tooltip(MARK_NAME[mark]).child(mark));
  }

  fileRows(files, kind, t, empty) {
    if (!files.length) return [h_flex().h(26).flex_none().px(10).items_center().text_size(12).text_color(t.dim).child(empty)];
    const shown = files.slice(0, MAX_ROWS);
    const more = files.length > MAX_ROWS ? [div().px(10).py(4).text_size(11).text_color(t.dim).child(`Showing the first ${MAX_ROWS} of ${files.length} files`)] : [];
    if (!this.tree) return [...shown.map((f) => this.fileRow(f, kind, 0, true, t)), ...more];
    const scope = `${kind}:`;
    const closed = new Set([...this.collapsed].filter((k) => k.startsWith(scope)).map((k) => k.slice(scope.length)));
    return [...visibleRows(fileTree(shown), closed).map((r) => {
      if (r.kind === "file") return this.fileRow(r.change, kind, r.depth, false, t);
      const open = !closed.has(r.path), pic = this.picture(r.path, t, { dir: true, open });
      return h_flex().id(`dir-${scope}${r.path}`).h(26).flex_none().pl(6 + r.depth * 14).pr(6).gap(4).items_center().rounded(6).cursor_pointer()
        .hover((s) => s.bg(t.hover)).on_click((_e, cx) => this.flip(scope + r.path, cx))
        .child(svg(icon(open ? "chevron-down" : "chevron-right")).size(12).flex_none().text_color(t.dim))
        .when(Boolean(pic), (e) => e.child(pic))
        .child(div().min_w(0).truncate().text_color(t.muted).child(r.name));
    }), ...more];
  }

  // Folded by default to one "Commit…" row; open, a title (Enter commits), a description and the button.
  commitBox(t) {
    const fold = h_flex().id("changes-commit-fold").h(30).flex_none().px(10).gap(6).items_center().cursor_pointer().text_size(12)
      .text_color(this.commitOpen ? t.foreground : t.muted).hover((s) => s.bg(t.hover).text_color(t.foreground))
      .on_click((_e, cx) => this.setCommitOpen(!this.commitOpen, cx))
      .child(svg(icon(this.commitOpen ? "chevron-down" : "chevron-right")).size(12).flex_none().text_color(t.dim))
      .child(div().flex_1().child(this.commitOpen ? "Commit" : "Commit…"))
      .when(Boolean(this.pushPlan()), (e) => e.child(this.pushButton(t)));
    const box = v_flex().flex_none().border_b(1).border_color(t.border).child(fold);
    if (!this.commitOpen) return box;
    const changes = this.staged.length + this.work.length;
    const conflicted = this.conflicted();
    const enabled = Boolean(this.title.trim() && !this.busy && changes && !conflicted);
    const field = (id, focused) => div().id(id).w_full().px(10).rounded(8).border_1().border_color(focused ? t.accent : t.border)
      .when(!focused, (e) => e.hover((s) => s.border_color(t.input))).cursor_text().on_mouse_down("left", (_e, cx) => cx.stop_propagation());
    return box.child(v_flex().px(10).pb(10).gap(8)
      .child(field("commit-title", this.typingTitle).h(32).flex().items_center().child(Input.new(this.input).h_full().text_size(12).text_color(t.foreground)))
      .child(field("commit-body", this.typingBody).py(6).child(Textarea.new(this.body).w_full().text_size(12).text_color(t.foreground)))
      .child(h_flex().id("commit").w_full().h(30).items_center().justify_center().rounded(8).text_size(12).font_medium()
        .bg(enabled ? t.solid : t.raised).text_color(enabled ? t.solid_foreground : t.dim)
        .when(enabled, (e) => e.cursor_pointer().hover((s) => s.opacity(0.88)))
        .when(!enabled && !this.busy && changes > 0 && !conflicted && !this.title.trim(), (e) => e.tooltip("Write a commit title first"))
        .when(conflicted && !this.busy, (e) => e.tooltip("Stage each conflicted file once it's resolved"))
        .on_click((_e, cx) => { if (enabled) this.commit(cx); })
        .child(this.busy ? "Working…" : commitLabel(this.staged.length, this.work.length, conflicted))));
  }

  pushButton(t) {
    const plan = this.pushPlan(), on = plan.enabled && !this.busy;
    return h_flex().id("changes-push").h(22).px(8).gap(4).flex_none().items_center().rounded(6).text_size(11.5)
      .border_1().border_color(t.border).text_color(on ? t.foreground : t.dim)
      .when(on, (e) => e.cursor_pointer().hover((s) => s.bg(t.raised)))
      .tooltip(plan.tooltip ?? `Push ${this.owner.current} to ${this.owner.upstream}`)
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => { cx.stop_propagation(); this.push(cx); })
      .child(svg(icon("push")).size(12).flex_none())
      .child(this.busy && this.pushing ? "Pushing…" : plan.ahead ? `${plan.label} ↑${plan.ahead}` : plan.label);
  }

  lists(t) {
    const clean = !this.staged.length && !this.work.length;
    const staged = this.staged.length ? [
      this.section("Staged", this.staged.length, [this.button("changes-unstage-all", "minus", "Unstage all", (cx) => this.run(unstageAllArgs(this.hasHead), cx), t)], t),
      ...this.fileRows(this.staged, "staged", t),
      div().h(6).flex_none(),
    ] : [];
    const actions = [this.button("changes-view", this.tree ? "list" : "list-tree", this.tree ? "View as list" : "View as tree", (cx) => this.setTree(!this.tree, cx), t),
      ...(this.work.length ? [this.button("changes-discard-all", "undo", "Discard all", (cx) => this.discard(this.work, cx), t),
        this.button("changes-stage-all", "plus", "Stage all", (cx) => this.run(stageAllArgs(), cx), t)] : [])];
    return v_flex().id("changes-list").flex_1().min_h(0).p(6).gap(2).overflow_y_scrollbar()
      .children(staged)
      .child(this.section("Unstaged", this.work.length, actions, t))
      .children(this.fileRows(this.work, "work", t, clean ? "Working tree clean" : "No unstaged changes"));
  }

  notice(text, t) {
    return v_flex().flex_1().min_h(0).items_center().justify_center().px(28).pb(40)
      .child(div().max_w(280).text_center().text_size(12).text_color(t.muted).child(text));
  }

  render(t) {
    this.sync();
    const o = this.owner;
    if (o.state === "workspace" || !o.root) return this.notice("Open a repository to see its changes", t);
    return v_flex().flex_1().min_h(0)
      .child(this.commitBox(t)).child(this.lists(t))
      .when(Boolean(this.asking), (e) => e.child(h_flex().flex_none().pl(10).pr(6).py(6).gap(6).items_center().bg(t.ansi1 + "14").border_t(1).border_color(t.border)
        .child(div().flex_1().min_w(0).text_size(12).text_color(t.foreground).child(this.asking?.text ?? ""))
        .child(div().id("changes-ask-no").h(26).px(10).flex().items_center().rounded(6).cursor_pointer().text_size(12).hover((s) => s.bg(t.hover))
          .on_click((_e, cx) => { this.asking = null; cx.notify(); }).child("Cancel"))
        .child(div().id("changes-ask-yes").h(26).px(10).flex().items_center().rounded(6).cursor_pointer().text_size(12).bg(t.ansi1).text_color(t.background)
          .hover((s) => s.opacity(0.88)).on_click((_e, cx) => this.run(this.asking?.list, cx)).child("Discard"))))
      .when(Boolean(this.error), (e) => e.child(h_flex().flex_none().pl(10).pr(6).py(4).gap(6).items_start().bg(t.ansi1 + "14").border_t(1).border_color(t.border)
        .child(div().flex_1().min_w(0).py(3).text_size(11).text_color(t.ansi1).child(this.error ?? ""))
        .child(div().id("changes-error-close").px(6).py(1).rounded(4).text_color(t.dim).cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground))
          .on_click((_e, cx) => { this.error = null; cx.notify(); }).child("×"))));
  }
}
