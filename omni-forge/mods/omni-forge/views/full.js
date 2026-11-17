// Full CI view: its own Herdr tab (tab.new {mod: "omni-forge", props: {view: "full", open?}}).
// Follows the focused terminal's repo and branch; lists runs with a filter, chips and a This branch
// toggle; a click opens the run detail (views/detail.js) in place. Lists poll only while this tab is
// shown; every copy also runs the shared watch tick (ci/watch.js) when it owns it.
import { div } from "gpui-kit";
import { v_flex, h_flex, InputState } from "gpui-base";
import {
  exec, theme, focused, panes, spaces, props, shared, setShared, notify, checking, window as appWindow,
} from "herdr";
import { detectRepo } from "../forge/detect.js";
import { providerFor } from "../forge/providers.js";
import { nextDelay } from "../ci/poller.js";
import { Watches, watchKey, claimOwner, watchTick } from "../ci/watch.js";
import { filterRuns, chipCounts, anyLive, ago } from "./runs.js";
import { Detail, WATCHABLE } from "./detail.js";
import { parseOpen, isVisible, nextLoc, lastLocUpdate, LAST_LOC } from "./locate.js";
import {
  statusIcon, runPills, filterChip, tabPill, searchBox, button, busyState, message, errorState,
} from "./ui.js";

const TICK_MS = 1000;
const CLAIM_MS = 30000;
const LIMIT = 30;
const WATCHES = "omni-forge.watches";
const OWNER = "omni-forge.watch-owner";
const CHIP_LIST = [
  { id: "running", label: "Running", color: (t) => t.working },
  { id: "failed", label: "Failed", color: (t) => t.ansi1 },
  { id: "passed", label: "Passed", color: (t) => t.ansi2 },
  { id: "other", label: "Other", color: (t) => t.dim },
];

const sameRepo = (a, b) => Boolean(a && b) && a.kind === b.kind && a.host === b.host && a.path === b.path;

export class FullView {
  init(given, cx) {
    // Read props once: props() in a later callback can answer for another copy.
    this.props = (given && Object.keys(given).length ? given : props()) ?? {};
    this.id = `full-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
    this.watches = new Watches({ get: () => shared(WATCHES), set: (v) => setShared(WATCHES, v) });
    this.open = parseOpen(this.props.open);
    this.filter = InputState.new({ placeholder: "Filter runs… (#42, title, branch, author)" });
    this.filter.on("change", (_e, cx) => { this.recompute(); cx.notify(); });

    this.loc = null; // { key, cwd, machine }
    this.branch = null;
    this.detecting = false;
    this.pendingLoc = null;
    this.repo = null;
    this.repoError = null;
    this.provider = null;
    this.thisBranch = true;
    this.chip = "all";
    this.detail = null;
    this.claimAt = 0;
    this.watchAt = 0;
    this.watchErrors = 0;
    this.watchBusy = false;
    this.resetList();
    this.listBusy = false;
    this.seenTerm = null;
    this.seed(cx);
    cx.timer.every(TICK_MS, (cx) => this.tick(cx));
  }

  // props.open names the repo and run: show them at once, without detection. The focused terminal
  // at this moment doesn't count as a move (seenTerm), so the view stays until focus changes.
  seed(cx) {
    const open = this.open;
    if (!open) return;
    this.open = null;
    this.repo = { kind: open.kind, host: open.host, path: open.path };
    this.provider = providerFor(this.repo);
    this.loc = { key: `open|${open.kind}|${open.host}|${open.path}`, cwd: null, machine: null, branch: null };
    this.seenTerm = nextLoc({ loc: this.loc, seenTerm: null, lastLoc: null }, this.snap()).seenTerm;
    this.openRun({ id: open.runId }, cx, { load: !checking() });
  }

  resetList() {
    this.gen = (this.gen ?? 0) + 1;
    this.runs = [];
    this.loaded = false;
    this.listError = null;
    this.errors = 0;
    this.listAt = 0;
    this.recompute();
  }

  // Filtered list and chip counts, recomputed when the data or the filters change, not per render.
  recompute() {
    const query = this.filter?.value() ?? "";
    const matched = filterRuns(this.runs, { query, chip: "all" });
    this.counts = chipCounts(matched);
    this.shown = filterRuns(matched, { chip: this.chip });
    this.filtering = query.trim() !== "" || this.chip !== "all";
  }

  // ---- where we are ----------------------------------------------------------

  snap() {
    return { focused: focused(), panes: panes(), spaces: spaces() };
  }

  visible() {
    return isVisible({ focused: focused(), panes: panes(), windowActive: appWindow().active });
  }

  // Records the focused terminal as shared last-loc (only on change), then follows it: see locate.js.
  follow(cx) {
    const snap = this.snap();
    const last = shared(LAST_LOC) ?? null;
    const update = lastLocUpdate(last, snap);
    if (update) setShared(LAST_LOC, update);
    const step = nextLoc({ loc: this.loc, seenTerm: this.seenTerm, lastLoc: this.loc ? null : (update ?? last) }, snap);
    this.seenTerm = step.seenTerm;
    if (step.move) {
      this.loc = step.move;
      this.setBranch(step.move.branch, cx);
      this.detect(cx, step.move);
    } else if (step.branch && step.branch !== this.branch) {
      this.setBranch(step.branch, cx);
    }
  }

  setBranch(branch, cx) {
    if (branch === this.branch) return;
    this.branch = branch;
    if (this.thisBranch && this.repo) { this.resetList(); cx.notify(); }
  }

  detect(cx, loc) {
    if (this.detecting) { this.pendingLoc = loc; return; }
    this.detecting = true;
    cx.spawn(async (cx) => {
      try {
        const res = await detectRepo(loc.cwd, loc.machine, exec);
        if (this.pendingLoc) return;
        if (res.error) {
          this.repo = null;
          this.provider = null;
          this.repoError = res;
          this.detail = null;
          this.resetList();
        } else if (!sameRepo(res, this.repo)) {
          this.repo = { kind: res.kind, host: res.host, path: res.path };
          this.provider = providerFor(this.repo);
          this.repoError = null;
          this.detail = null;
          this.resetList();
        }
      } catch (e) {
        this.repoError = { error: String(e?.message ?? e), hint: "" };
      } finally {
        this.detecting = false;
        const next = this.pendingLoc;
        this.pendingLoc = null;
        if (next) this.detect(cx, next);
        cx.notify();
      }
    });
  }

  // ---- polling -----------------------------------------------------------------

  tick(cx) {
    if (checking()) return;
    this.follow(cx);
    this.watchTick(cx);
    if (!this.provider || !this.visible()) return;
    const now = Date.now();
    if (this.detail) { if (now >= this.detail.nextAt) this.detail.load(cx); }
    else if (now >= this.listAt) this.loadList(cx);
  }

  loadList(cx) {
    if (this.listBusy || !this.provider) return;
    this.listBusy = true;
    const gen = this.gen;
    const provider = this.provider;
    const branch = this.thisBranch ? this.branch : null;
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        const runs = await provider.listRuns({ branch, limit: LIMIT });
        if (gen !== this.gen) return;
        this.runs = runs;
        this.loaded = true;
        this.listError = null;
        this.errors = 0;
        this.recompute();
        this.autoWatch(runs);
      } catch (e) {
        if (gen !== this.gen) return;
        this.listError = e;
        this.errors++;
      } finally {
        this.listBusy = false;
        if (gen === this.gen) this.listAt = Date.now() + nextDelay({ visible: true, anyRunning: anyLive(this.runs), errors: this.errors });
        cx.notify();
      }
    });
  }

  // Running or pending runs on the current branch get watched for their finish notification.
  autoWatch(runs) {
    if (!this.branch || !this.repo) return;
    for (const r of runs) {
      if (r.branch === this.branch && (r.status === "running" || r.status === "pending")) {
        this.watches.add(watchKey({ ...this.repo, runId: r.id }), r);
      }
    }
  }

  // Every copy tries to own the watch list every 30s; the owner polls watches on that cadence,
  // backing off on errors.
  watchTick(cx) {
    const now = Date.now();
    if (now < this.claimAt) return;
    this.claimAt = now + CLAIM_MS;
    const owns = claimOwner({ get: () => shared(OWNER), set: (v) => setShared(OWNER, v), now: Date.now, id: this.id });
    if (!owns || this.watchBusy || now < this.watchAt) return;
    this.watchBusy = true;
    cx.spawn(async () => {
      try {
        const { errors } = await watchTick({ watches: this.watches, providerFor, notify, now: Date.now });
        this.watchErrors = errors > 0 ? this.watchErrors + 1 : 0;
      } catch {
        this.watchErrors++;
      } finally {
        this.watchBusy = false;
        this.watchAt = now + nextDelay({ visible: false, anyRunning: false, errors: this.watchErrors });
      }
    });
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
    if (!this.repo) {
      this.repoError = null;
      if (this.loc?.cwd) this.detect(cx, this.loc);
      else { this.loc = null; this.follow(cx); }
      cx.notify();
      return;
    }
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
    return v_flex().id("full-root").size_full().min_h(0).bg(t.background).text_color(t.foreground).text_size(13)
      .child(header).child(body);
  }

  listView(t) {
    const total = this.runs.length;
    const chips = [filterChip(t, "chip-all", "All", this.counts.all, this.chip === "all", (cx) => this.setChip("all", cx))];
    for (const c of CHIP_LIST) {
      if (this.counts[c.id] > 0 || this.chip === c.id) {
        chips.push(filterChip(t, `chip-${c.id}`, c.label, this.counts[c.id], this.chip === c.id, (cx) => this.setChip(c.id, cx), c.color(t)));
      }
    }
    const branchLabel = this.branch ? `This branch · ${this.branch}` : "This branch";
    const controls = v_flex().flex_none().px(12).pt(10).pb(4).gap(8)
      .child(searchBox(t, "run-filter", this.filter, {
        right: this.filtering ? `${this.shown.length}/${total}` : String(total),
        onClear: (cx) => { this.filter.set_value(""); this.recompute(); cx.notify(); },
      }))
      .child(h_flex().flex_wrap().gap(4).items_center().children(chips).child(div().flex_1())
        .child(tabPill(t, "this-branch", branchLabel, this.thisBranch, (cx) => this.toggleBranch(cx), { check: true })));

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
          .child(button(t, "clear-filters", "Clear filters", (cx) => { this.filter.set_value(""); this.setChip("all", cx); }))));
    }
    return v_flex().flex_1().min_h(0).child(controls).child(list);
  }

  setChip(chip, cx) {
    this.chip = chip;
    this.recompute();
    cx.notify();
  }

  toggleBranch(cx) {
    this.thisBranch = !this.thisBranch;
    this.resetList();
    this.loadList(cx);
    cx.notify();
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
