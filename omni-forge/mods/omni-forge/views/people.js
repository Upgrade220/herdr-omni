// PeoplePicker: edits a list of usernames (reviewers or assignees) for the MR page. Shows the
// chosen people as removable chips, an input that searches via `search(query)` (debounced, never per
// keystroke) and the matches to click. Save hands back the full desired list; Cancel discards.
// No cx is stored; the input state is created here, in the constructor path.
import { div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { button } from "./ui.js";

export const SEARCH_MS = 300;

export class PeoplePicker {
  constructor({ initial = [], search, onSave, onCancel, placeholder = "Search people" }) {
    this.list = [...initial];
    this.matches = []; // [{ username, name }]
    this.error = null;
    this.searching = false;
    this.search = search;
    this.onSave = onSave;
    this.onCancel = onCancel;
    this.seq = 0; // answers older than the last keystroke are dropped
    this.task = null;
    this.input = InputState.new({ placeholder });
    this.input.on("change", (_e, cx) => this.typed(cx));
  }

  // The query changed: wait SEARCH_MS of quiet, then ask. A blank query asks nothing.
  typed(cx) {
    const mine = ++this.seq;
    this.task?.cancel?.();
    this.task = null;
    const query = this.input.value().trim();
    this.searching = false;
    if (!query) { this.matches = []; this.error = null; cx.notify(); return; }
    this.task = cx.timer.after(SEARCH_MS, (cx) => this.run(cx, query, mine));
  }

  run(cx, query, mine) {
    if (mine !== this.seq) return;
    this.searching = true;
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        const found = await this.search(query);
        if (mine !== this.seq) return;
        this.matches = found ?? [];
        this.error = null;
      } catch (e) {
        if (mine !== this.seq) return;
        this.matches = [];
        this.error = e;
      } finally {
        if (mine === this.seq) this.searching = false;
        cx.notify();
      }
    });
  }

  add(username, cx) {
    if (!this.list.includes(username)) this.list.push(username);
    this.matches = [];
    this.seq++;
    this.input.set_value("");
    cx.notify();
  }

  remove(username, cx) {
    this.list = this.list.filter((u) => u !== username);
    cx.notify();
  }

  render(t, ids, { busy = false } = {}) {
    const chosen = new Set(this.list);
    const shown = this.matches.filter((m) => !chosen.has(m.username));
    return v_flex().id(ids).flex_none().mx(14).my(4).p(10).gap(8).rounded(8).bg(t.raised)
      .child(h_flex().gap(6).flex_wrap()
        .children(this.list.length
          ? this.list.map((u, i) => h_flex().id(`${ids}-chip-${i}`).h(22).px(8).gap(6).items_center().rounded(6).bg(t.hover).text_size(12).text_color(t.foreground)
            .child(u)
            .child(div().id(`${ids}-remove-${i}`).cursor_pointer().text_color(t.muted).on_click((_e, cx) => this.remove(u, cx)).child("×")))
          : [div().text_size(12).text_color(t.dim).child("Nobody yet")]))
      .child(h_flex().h(30).px(8).items_center().rounded(6).bg(t.background).border_1().border_color(t.border)
        .child(Input.new(this.input).h_full().flex_1().min_w(0).text_size(12).text_color(t.foreground)))
      .when(this.searching, (e) => e.child(div().text_size(11).text_color(t.dim).child("Searching…")))
      .when(Boolean(this.error), (e) => e.child(div().text_size(11).text_color(t.ansi1).child(String(this.error?.message ?? this.error))))
      .children(shown.map((m, i) => h_flex().id(`${ids}-match-${i}`).min_h(26).px(8).gap(8).items_center().rounded(6).cursor_pointer().hover((s) => s.bg(t.hover))
        .on_click((_e, cx) => this.add(m.username, cx))
        .child(div().text_size(12).text_color(t.foreground).child(m.username))
        .child(div().min_w(0).truncate().text_size(11).text_color(t.dim).child(m.name ?? ""))))
      .child(h_flex().gap(8)
        .child(button(t, `${ids}-save`, "Save", (cx) => this.onSave([...this.list], cx), { primary: true, disabled: busy }))
        .child(button(t, `${ids}-cancel`, "Cancel", (cx) => this.onCancel(cx))));
  }
}
