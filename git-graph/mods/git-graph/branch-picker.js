// The branch picker: a click on the header's branch drops a search box and the branches
// under it; Enter takes the exact match, else creates the branch typed.
// The graph owns it: it toggles it from the header and draws render() under the header.
// Ported from git-panel (https://github.com/LaiqianDS/herdr-mods, Apache-2.0), itself from Herdr's shipped changes mod.
import { div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { exec, setShared, notify } from "herdr";
import { READ, gitError } from "./git.js";
import { BRANCH_REFS, parseBranches, filterBranches, validBranchName, switchArgs, createArgs } from "./branches.js";
import { icon } from "./menu.js";

export class BranchPicker {
  // owner: the graph, which gives { root, on, state, current, head, handle, refreshNow(cx) }.
  init(owner, cx) {
    this.owner = owner;
    this.open = false; this.root = null; this.list = []; this.loading = false; this.busy = false; this.query = "";
    this.filter = InputState.new({ placeholder: "Switch to or create a branch" });
    this.filter.on("change", (_e, cx) => { this.query = this.filter.value(); cx.notify(); });
    this.filter.on("submit", (_e, cx) => {
      // Still loading: an existing name would read as new and `switch -c` would fail.
      if (this.loading) return;
      const q = this.query.trim(), match = this.list.find((b) => b.name === q);
      match ? this.pick(match, cx) : this.create(q, cx);
    });
  }

  // Another repository, or another branch checked out (from a terminal, say), closes it:
  // its list and its "current" were read for the old one, and a pending load is dropped.
  sync() {
    const o = this.owner;
    if (this.open && (this.root !== o.root || this.current !== o.current)) { this.open = false; this.token = null; this.loading = false; }
  }

  // Open for the repository on show, with the header's branch bubble there to hang from.
  shown() {
    this.sync();
    const o = this.owner;
    return this.open && (o.state === "ready" || o.state === "empty") && Boolean(o.current || o.head);
  }

  toggle(cx) {
    if (this.shown()) { this.close(cx); return; }
    const o = this.owner, root = o.root, on = o.on, current = o.current;
    if (!root) return;
    this.open = true; this.root = root; this.current = current; this.list = []; this.loading = true; this.query = ""; this.filter.set_value("");
    const token = this.token = {};
    cx.spawn(async (cx) => {
      let list = [], error = null;
      try {
        const r = await exec("git", [...READ, ...BRANCH_REFS], { cwd: root, on });
        if (r.code !== 0) error = gitError(r); else list = parseBranches(r.stdout, current);
      } catch (e) { error = String(e?.message ?? e); }
      if (this.token !== token) return;
      this.list = list; this.loading = false;
      if (error) { this.open = false; notify({ title: "Couldn't list the branches", body: error, level: "error" }); }
      cx.notify();
    });
    this.filter.focus();
    cx.notify();
  }

  close(cx) {
    this.open = false; this.token = null;
    this.owner.handle.focus();
    cx.notify();
  }

  // Esc closes it. False when it wasn't showing.
  escape() {
    if (!this.shown()) { this.open = false; return false; }
    this.open = false; this.token = null;
    this.owner.handle.focus();
    return true;
  }

  pick(b, cx) {
    if (b.current) { this.close(cx); return; }
    this.run(switchArgs(b), cx);
  }

  create(name, cx) { this.run(createArgs(name), cx); }

  // Switching closes the picker; a failure goes to a notification and leaves it open.
  run(args, cx) {
    if (!args || this.busy || !this.root) return;
    const root = this.root, on = this.owner.on;
    this.busy = true;
    cx.spawn(async (cx) => {
      try {
        const r = await exec("git", args, { cwd: root, on });
        if (r.code !== 0) notify({ title: "Couldn't switch branches", body: gitError(r), level: "error" });
        else if (this.root === root) { this.open = false; this.token = null; this.owner.handle.focus(); }
      } catch (e) {
        notify({ title: "Git didn't run", body: String(e?.message ?? e), level: "error" });
      } finally {
        this.busy = false;
        setShared("git-graph.changed", Date.now());
        this.owner.refreshNow(cx);
        cx.notify();
      }
    });
    cx.notify();
  }

  row(id, glyph, glyphColor, label, labelColor, note, fn, t) {
    return h_flex().id(id).h(26).flex_none().px(8).gap(6).items_center().rounded(6).cursor_pointer()
      .hover((s) => s.bg(t.hover)).active((s) => s.bg(t.selected)).on_click((_e, cx) => fn(cx))
      .child(svg(icon(glyph)).size(12).flex_none().text_color(glyphColor))
      .child(div().flex_1().min_w(0).truncate().text_color(labelColor).child(label))
      .when(Boolean(note), (e) => e.child(div().flex_none().text_size(11).text_color(t.dim).child(note ?? "")));
  }

  render(t) {
    const q = this.query.trim();
    const rows = filterBranches(this.list, q).map((b) => this.row(`branch-${b.local ? "l" : "r"}-${b.name}`, "branch", b.current ? t.accent : t.dim,
      b.name, b.current ? t.accent : b.local ? t.foreground : t.muted, b.current ? "current" : null, (cx) => this.pick(b, cx), t));
    if (!this.loading && validBranchName(q) && !this.list.some((b) => b.local && b.name === q))
      rows.unshift(this.row("branch-create", "plus", t.accent, `Create branch ${q}`, t.foreground, null, (cx) => this.create(q, cx), t));
    const empty = this.loading ? "Loading branches…" : this.busy ? "Switching…" : "No matching branch";
    return v_flex().flex_none().p(8).gap(6).border_b(1).border_color(t.border).bg(t.raised + "66")
      .child(div().id("branch-filter").w_full().h(30).px(10).flex().items_center().rounded(8).border_1().border_color(t.accent)
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation()).child(Input.new(this.filter).h_full().text_size(12).text_color(t.foreground)))
      .child(v_flex().id("branch-list").flex_none().h(Math.min(208, Math.max(1, rows.length) * 28)).overflow_y_scrollbar().gap(2)
        .children(rows.length ? rows : [h_flex().h(26).px(8).items_center().text_size(12).text_color(t.dim).child(empty)]));
  }
}
