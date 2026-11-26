// MrList: the MR data (polled), chip, filter box and rows shared by the side view and the full
// view's MRs tab. It knows only the `compact` flag; the owner supplies { provider, repo, gen,
// pollVisible() }. No cx is stored.
import { div } from "gpui-kit";
import { v_flex, h_flex, InputState } from "gpui-base";
import { nextDelay } from "../ci/poller.js";
import { ago } from "./runs.js";
import { MR_CHIPS, mrCounts, filterMrs, mrNumber } from "./mrs.js";
import { button, statusPill, pill, filterChip, searchBox, busyState, message, errorState } from "./ui.js";

export class MrList {
  constructor(owner) {
    this.owner = owner;
    this.me = "";
    this.mrs = [];
    this.loaded = false;
    this.busy = false;
    this.error = null;
    this.errors = 0;
    this.chip = "review";
    this.at = 0;
    this.filter = InputState.new({ placeholder: "Filter MRs" });
    this.filter.on("change", (_e, cx) => cx.notify());
  }

  tickDue(now = Date.now()) {
    return !this.busy && now >= this.at;
  }

  load(cx) {
    const { provider, gen } = this.owner;
    if (this.busy || !provider) return;
    this.busy = true;
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        const res = await provider.listMrs();
        if (gen !== this.owner.gen) return;
        this.me = res.me ?? "";
        this.mrs = res.mrs ?? [];
        this.loaded = true;
        this.error = null;
        this.errors = 0;
      } catch (e) {
        if (gen !== this.owner.gen) return;
        this.error = e;
        this.errors++;
      } finally {
        this.busy = false;
        if (gen === this.owner.gen) this.at = Date.now() + nextDelay({ visible: this.owner.pollVisible(), anyRunning: false, errors: this.errors });
        cx.notify();
      }
    });
  }

  setChip(id, cx) {
    this.chip = id;
    cx.notify();
  }

  shown() {
    return filterMrs(this.mrs, { chip: this.chip, text: this.filter.value(), me: this.me });
  }

  // Controls (filter box and chips with counts) and the rows. `ids` prefixes element ids.
  render(t, { compact = false, onOpen, onNew, ids = "mr" } = {}) {
    if (this.error && !this.loaded) return errorState(t, `${ids}-retry`, this.error, (cx) => this.load(cx));
    if (!this.loaded) return busyState(t, "Loading merge requests…");
    const counts = mrCounts(this.mrs, this.me);
    const shown = this.shown();
    const kind = this.owner.repo?.kind;
    const typed = this.filter.value().length > 0;
    const controls = v_flex().flex_none().px(12).pt(10).pb(4).gap(8)
      .child(searchBox(t, `${ids}-filter`, this.filter, {
        right: typed ? `${shown.length}/${this.mrs.length}` : String(this.mrs.length),
        onClear: (cx) => { this.filter.set_value(""); cx.notify(); },
      }))
      .child(h_flex().flex_wrap().gap(4).items_center()
        .children(MR_CHIPS.map((c) => filterChip(t, `${ids}-chip-${c.id}`, c.label, counts[c.id], this.chip === c.id, (cx) => this.setChip(c.id, cx))))
        .when(Boolean(onNew), (e) => e.child(div().flex_1().min_w(0)).child(button(t, `${ids}-new`, "New MR", () => onNew()))));
    const rows = v_flex().flex_1().min_h(0).overflow_y_scroll()
      .children(shown.map((m) => this.row(t, m, { compact, onOpen, ids, kind })))
      .when(!shown.length, (e) => e.child(message(t, typed ? "No MR matches the filter" : this.chip === "review" ? "Nothing to review" : "No open MRs")));
    return v_flex().flex_1().min_h(0).w_full()
      .child(controls)
      .when(Boolean(this.error), (e) => e.child(errorState(t, `${ids}-retry`, this.error, (cx) => this.load(cx))))
      .child(rows);
  }

  row(t, m, { compact, onOpen, ids, kind }) {
    const approvals = m.approvalsRequired != null ? `✓${m.approvals}/${m.approvalsRequired}` : `✓${m.approvals}`;
    const meta = h_flex().gap(6).items_center().overflow_hidden()
      .when(m.draft, (e) => e.child(pill(t, { label: "Draft", color: t.blocked })))
      .when(Boolean(m.pipeline), (e) => e.child(statusPill(t, m.pipeline)))
      .when(m.approvals > 0 || m.approvalsRequired != null, (e) => e.child(div().flex_none().text_size(11).text_color(t.dim).child(approvals)))
      .when(m.unresolved > 0, (e) => e.child(div().flex_none().text_size(11).text_color(t.dim).child(`💬${m.unresolved}`)))
      .child(div().flex_1().min_w(0))
      .child(div().flex_none().text_size(11).text_color(t.dim).child(ago(m.updatedAt)));
    const branches = pill(t, { label: `${m.source} → ${m.target}`, symbol: "branch", code: true }).flex_shrink(1).min_w(0);
    const head = h_flex().gap(8).items_center()
      .child(div().flex_1().min_w(0).truncate().text_size(13).child(m.title))
      .child(div().flex_none().text_size(11).text_color(t.dim).child(mrNumber(kind, m.number)));
    const base = v_flex().id(`${ids}-row-${m.number}`).w_full().flex_none().px(12).py(compact ? 6 : 8).gap(4)
      .cursor_pointer().hover((s) => s.bg(t.hover)).on_click((_e, cx) => onOpen?.(m, cx));
    if (compact) {
      return base.child(head)
        .child(h_flex().gap(6).items_center().overflow_hidden()
          .child(div().flex_none().text_size(11).text_color(t.dim).child(m.author)).child(branches))
        .child(meta);
    }
    return base.child(head)
      .child(h_flex().gap(8).items_center().overflow_hidden()
        .child(div().flex_none().text_size(11).text_color(t.dim).child(m.author)).child(branches))
      .child(meta);
  }
}
