// Full CI view: its own Herdr tab (tab.new {mod: "omni-forge", props: {view: "full", open?}}).
// Follows the focused terminal's repo and branch; lists runs with a filter, chips and a This branch
// toggle; a click opens the run detail (views/detail.js) in place. Lists poll only while this tab is
// shown; every copy also runs the shared watch tick when it owns it (views/repo.js).
// The side view opens a run here by selecting this tab and setting shared("omni-forge.open") to
// {tab, key}. A copy learns its own tab when it is first laid out (laidOut): a copy in a tab that
// isn't shown gets no layout, so the focused tab at that moment is the one showing it.
import { div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { theme, focused, panes, props, shared, setShared, checking, window as appWindow } from "herdr";
import { watchKey } from "../ci/watch.js";
import { ago } from "./runs.js";
import { Detail, WATCHABLE } from "./detail.js";
import { parseOpen, isVisible, mayTakeOpen, fullTabs, nextLoc, OPEN } from "./locate.js";
import { RepoView, sameRepo } from "./repo.js";
import { statusIcon, runPills, button, busyState, message, errorState } from "./ui.js";

const TICK_MS = 1000;

export class FullView extends RepoView {
  init(given, cx) {
    // Read props once: props() in a later callback can answer for another copy.
    this.props = (given && Object.keys(given).length ? given : props()) ?? {};
    this.initRepo("full", { placeholder: "Filter runs… (#42, title, branch, author)" });
    this.detail = null;
    this.ownTab = null;
    // props.open names the repo and run: show them at once, without detection.
    if (this.props.open) this.openKey(this.props.open, cx, { load: !checking() });
    cx.timer.every(TICK_MS, (cx) => this.tick(cx));
  }

  repoChanged() {
    this.detail = null;
  }

  // Opens the run a watch key names. Another repo than the shown one replaces it, with a seed
  // location: the terminal focused now doesn't count as a move (seenTerm), so the view stays
  // until focus changes.
  openKey(value, cx, { load = true } = {}) {
    const open = parseOpen(value);
    if (!open) return;
    if (!sameRepo(open, this.repo)) {
      this.setRepo(open);
      this.branch = null;
      this.loc = { key: `open|${open.kind}|${open.host}|${open.path}`, cwd: null, machine: null, branch: null };
      this.seenTerm = nextLoc({ loc: this.loc, seenTerm: null, lastLoc: null }, this.snap()).seenTerm;
    }
    this.openRun({ id: open.runId }, cx, { load });
  }

  // The root's first size report: this copy is on screen, so the focused tab, if a full tab, is ours.
  laidOut() {
    if (this.ownTab) return;
    const f = focused();
    if (f && fullTabs(panes()).includes(f.tab)) this.ownTab = f.tab;
  }

  visible() {
    return isVisible({ focused: focused(), panes: panes(), windowActive: appWindow().active, ownTab: this.ownTab });
  }

  // ---- polling -----------------------------------------------------------------

  tick(cx) {
    if (checking()) return;
    this.follow(cx);
    this.watchTick(cx);
    if (!this.visible()) return;
    const asked = shared(OPEN);
    if (asked && mayTakeOpen(asked, { focused: focused(), panes: panes(), ownTab: this.ownTab })) {
      setShared(OPEN, null);
      this.openKey(asked.key, cx);
    }
    if (!this.provider) return;
    const now = Date.now();
    if (this.detail) { if (now >= this.detail.nextAt) this.detail.load(cx); }
    else if (now >= this.listAt) this.loadList(cx);
  }

  // ---- navigation ----------------------------------------------------------------

  openRun(run, cx, { load = true } = {}) {
    this.detail = new Detail(this, run.id, run.status ? run : null);
    if (run.status && WATCHABLE.has(run.status)) this.watches.add(watchKey({ ...this.repo, runId: run.id }), run);
    if (load) this.detail.load(cx);
    cx.notify();
  }

  back(cx) {
    this.detail = null;
    this.listAt = 0;
    cx.notify();
  }

  refresh(cx) {
    if (this.retryRepo(cx)) return;
    if (this.detail) this.detail.load(cx);
    else this.loadList(cx);
  }

  // ---- render --------------------------------------------------------------------

  render(_cx) {
    const t = theme();
    const loading = this.detail ? this.detail.loading : this.listBusy || this.detecting;
    const header = h_flex().h(44).flex_none().px(14).gap(10).items_center().border_b_1().border_color(t.border)
      .child(div().flex_none().font_semibold().child("CI"))
      .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(t.dim).child(this.repo?.path ?? ""))
      .child(button(t, "full-refresh", "⟳ Refresh", (cx) => this.refresh(cx), { busy: loading }));

    let body;
    if (!this.repo) {
      body = this.repoError
        ? errorState(t, "repo-retry", this.repoError, (cx) => this.refresh(cx))
        : busyState(t, "Looking for a repository…", "CI follows the focused terminal.");
    } else if (this.detail) {
      body = this.detail.render(t);
    } else {
      body = this.listView(t);
    }
    return v_flex().id("full-root").on_size_change((_size, _cx) => this.laidOut()).size_full().min_h(0).bg(t.background).text_color(t.foreground).text_size(13)
      .child(header).child(body);
  }

  listView(t) {
    const total = this.runs.length;
    let list;
    if (this.listError && !this.loaded) list = errorState(t, "list-retry", this.listError, (cx) => this.loadList(cx));
    else if (!this.loaded) list = busyState(t, "Loading runs…");
    else if (!total) list = message(t, "No runs yet.", this.thisBranch && this.branch ? `Nothing on ${this.branch}. Turn off This branch to see every run.` : "Runs appear here after CI starts.");
    else {
      const now = Date.now();
      list = v_flex().id("runs-scroll").flex_1().min_h(0).overflow_y_scrollbar().pb(8)
        .when(Boolean(this.listError), (e) => e.child(div().px(14).pt(6).text_size(11).text_color(t.ansi1).child(`Update failed: ${this.listError?.message ?? this.listError}`)))
        .children(this.shown.map((r) => this.runRow(t, r, now)))
        .when(!this.shown.length, (e) => e.child(v_flex().p(16).gap(8).items_start()
          .child(div().text_size(12).text_color(t.dim).child("No run matches the filters."))
          .child(button(t, "clear-filters", "Clear filters", (cx) => this.clearFilters(cx)))));
    }
    return v_flex().flex_1().min_h(0).child(this.listControls(t, "full")).child(list);
  }

  // Title, #number and age on top; pills below: branch, status, duration, trigger, MR/PR, author.
  runRow(t, r, now) {
    return v_flex().id(`run-${r.id}`).w_full().flex_none().px(14).py(8).gap(6).cursor_pointer().hover((s) => s.bg(t.hover))
      .on_click((_e, cx) => this.openRun(r, cx))
      .child(h_flex().gap(10).items_center()
        .child(statusIcon(t, r.status))
        .child(div().flex_1().min_w(0).truncate().text_size(14).child(r.title || `Run ${r.number ?? r.id}`))
        .child(div().flex_none().text_size(11).text_color(t.dim).child(r.number != null ? `#${r.number}` : ""))
        .child(div().flex_none().text_size(11).text_color(t.dim).child(ago(r.createdAt, now))))
      .child(runPills(t, r, this.repo.kind).pl(24));
  }
}
