// Side CI view: the narrow (~360px) block in the right panel beside Files, Changes and Git. A
// glanceable list only: it follows the focused terminal like the full view (views/repo.js), and a
// click opens the run in the space's full tab (selecting it and leaving shared("omni-forge.open")
// for it), or in a new one. The Full button opens that tab on Runs. Both close the side panel,
// since the full tab has everything the list does.
import { div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { theme, focused, panes, spaces, layout, setShared, checking, run as runCommand } from "herdr";
import { watchKey } from "../ci/watch.js";
import { spaceFullTabs, sideVisible, sidePanelId, OPEN, RUNS_KEY, MOD, TAB_NAME } from "./locate.js";
import { RepoView } from "./repo.js";
import { statusIcon, statusPill, pill, button, busyState, message, errorState } from "./ui.js";
import { dur } from "./runs.js";

const TICK_MS = 1000;

export class SideView extends RepoView {
  init(_given, cx) {
    this.initRepo("side", { placeholder: "Filter runs…" });
    cx.timer.every(TICK_MS, (cx) => this.tick(cx));
  }

  // Shown when the layout shows the side block (not hidden, the active child of its stacks).
  pollVisible() {
    return sideVisible(layout());
  }

  // Hidden, only the location and the watch tick run; the list waits until the panel shows.
  tick(cx) {
    if (checking()) return;
    this.follow(cx);
    this.watchTick(cx);
    this.pruneTick(cx);
    if (this.provider && this.pollVisible() && Date.now() >= this.listAt) this.loadList(cx);
  }

  refresh(cx) {
    if (this.retryRepo(cx)) return;
    this.loadList(cx);
  }

  // Opens a run in this space's full tab: the focused one when it is a full tab, else the first;
  // that tab's full copy takes {tab, key} in its next tick. Without a full tab, a new one opens on it.
  openInFull(r) {
    this.showFull(watchKey({ ...this.repo, runId: r.id }));
  }

  // The Full button: the space's full tab on its Runs tab.
  openFull() {
    this.showFull(RUNS_KEY);
  }

  showFull(key) {
    const f = focused();
    const tabs = spaceFullTabs(panes(), spaces(), f?.space);
    const tab = tabs.includes(f?.tab) ? f.tab : tabs[0];
    if (tab) {
      setShared(OPEN, { tab, key });
      runCommand("tab.select", { id: tab });
    } else {
      // A new full tab starts on Runs.
      runCommand("tab.new", { name: TAB_NAME, mod: MOD, props: key === RUNS_KEY ? { view: "full" } : { view: "full", open: key } });
    }
    const panel = sidePanelId(layout());
    if (panel) runCommand("layout.hide", { id: panel });
  }

  // ---- render --------------------------------------------------------------------

  render(_cx) {
    const t = theme();
    const header = h_flex().h(36).flex_none().px(12).gap(8).items_center().border_b_1().border_color(t.border)
      .child(div().flex_none().font_semibold().child("CI"))
      .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(t.dim).child(this.repo?.path ?? ""))
      .child(button(t, "side-full", "⤢ Full", () => this.openFull()))
      .child(button(t, "side-refresh", "⟳", (cx) => this.refresh(cx), { busy: this.listBusy || this.detecting }));

    let body;
    if (!this.repo) {
      body = this.repoError
        ? errorState(t, "side-repo-retry", this.repoError, (cx) => this.refresh(cx))
        : busyState(t, "Looking for a repository…", "CI follows the focused terminal.");
    } else {
      body = v_flex().flex_1().min_h(0).child(this.listControls(t, "side", { branchName: false })).child(this.list(t));
    }
    return v_flex().id("side-root").size_full().min_h(0).bg(t.background).text_color(t.foreground).text_size(13)
      .child(header).child(body);
  }

  list(t) {
    if (this.listError && !this.loaded) return errorState(t, "side-list-retry", this.listError, (cx) => this.loadList(cx));
    if (!this.loaded) return busyState(t, "Loading runs…");
    if (!this.runs.length) return message(t, "No runs yet.", this.thisBranch && this.branch ? `Nothing on ${this.branch}.` : "");
    return v_flex().id("side-scroll").flex_1().min_h(0).overflow_y_scrollbar().pb(8)
      .when(Boolean(this.listError), (e) => e.child(div().px(12).pt(6).text_size(11).text_color(t.ansi1).truncate().child(`Update failed: ${this.listError?.message ?? this.listError}`)))
      .children(this.shown.map((r) => this.row(t, r)))
      .when(!this.shown.length, (e) => e.child(v_flex().p(12).gap(8).items_start()
        .child(div().text_size(12).text_color(t.dim).child("No run matches the filters."))
        .child(button(t, "side-clear-filters", "Clear filters", (cx) => this.clearFilters(cx)))));
  }

  // Status icon, title and #number; one pill line below: branch, status, duration.
  row(t, r) {
    return v_flex().id(`side-run-${r.id}`).w_full().flex_none().px(12).py(6).gap(4).cursor_pointer().hover((s) => s.bg(t.hover))
      .on_click(() => this.openInFull(r))
      .child(h_flex().gap(8).items_center()
        .child(statusIcon(t, r.status))
        .child(div().flex_1().min_w(0).truncate().text_size(13).child(r.title || `Run ${r.number ?? r.id}`))
        .child(div().flex_none().text_size(11).text_color(t.dim).child(r.number != null ? `#${r.number}` : "")))
      .child(h_flex().pl(22).gap(6).items_center().overflow_hidden()
        .when(Boolean(r.branch), (e) => e.child(pill(t, { label: r.branch, symbol: "branch", code: true }).flex_shrink(1).min_w(0)))
        .child(statusPill(t, r.status))
        .when(r.durationSec != null, (e) => e.child(pill(t, { label: dur(r.durationSec) }))));
  }
}
