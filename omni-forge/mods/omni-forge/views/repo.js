// What the full and side views share: following the focused terminal (views/locate.js), repo
// detection, the run list with its filter, chips and This branch toggle, and the shared watch tick
// (ci/watch.js). Subclasses call initRepo() from init and drive tick() from their own timer.
import { div } from "gpui-kit";
import { v_flex, h_flex, InputState } from "gpui-base";
import { exec, focused, panes, spaces, shared, setShared, notify } from "herdr";
import { detectRepo } from "../forge/detect.js";
import { providerFor } from "../forge/providers.js";
import { nextDelay } from "../ci/poller.js";
import { Watches, watchKey, claimOwner, watchTick } from "../ci/watch.js";
import { filterRuns, chipCounts, anyLive } from "./runs.js";
import { nextLoc, lastLocUpdate, LAST_LOC } from "./locate.js";
import { filterChip, tabPill, searchBox } from "./ui.js";

const CLAIM_MS = 30000;
const LIMIT = 30;
export const WATCHES = "omni-forge.watches";
export const OWNER = "omni-forge.watch-owner";
export const CHIP_LIST = [
  { id: "running", label: "Running", color: (t) => t.working },
  { id: "failed", label: "Failed", color: (t) => t.ansi1 },
  { id: "passed", label: "Passed", color: (t) => t.ansi2 },
  { id: "other", label: "Other", color: (t) => t.dim },
];

export const sameRepo = (a, b) => Boolean(a && b) && a.kind === b.kind && a.host === b.host && a.path === b.path;

export class RepoView {
  initRepo(prefix, { placeholder }) {
    this.id = `${prefix}-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
    this.watches = new Watches({ get: () => shared(WATCHES), set: (v) => setShared(WATCHES, v) });
    this.filter = InputState.new({ placeholder });
    this.filter.on("change", (_e, cx) => { this.recompute(); cx.notify(); });

    this.loc = null; // { key, cwd, machine, branch }
    this.branch = null;
    this.detecting = false;
    this.pendingLoc = null;
    this.repo = null;
    this.repoError = null;
    this.provider = null;
    this.thisBranch = true;
    this.chip = "all";
    this.claimAt = 0;
    this.watchAt = 0;
    this.watchErrors = 0;
    this.watchBusy = false;
    this.resetList();
    this.listBusy = false;
    this.seenTerm = null;
  }

  // Hooks for subclasses: the repo changed or failed (drop what belongs to the old one), and
  // whether list polling may use the fast cadence.
  repoChanged() {}
  pollVisible() { return true; }

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

  // Try again without a repo: detect on the same location, or locate afresh when it has no cwd
  // (none yet, or a props.open seed). Returns false when there is a repo, so nothing was done.
  retryRepo(cx) {
    if (this.repo) return false;
    this.repoError = null;
    if (this.loc?.cwd) this.detect(cx, this.loc);
    else { this.loc = null; this.follow(cx); }
    cx.notify();
    return true;
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
        // A newer location (pending, or set by props.open meanwhile) makes this answer stale.
        if (this.pendingLoc || this.loc !== loc) return;
        if (res.error) {
          this.repo = null;
          this.provider = null;
          this.repoError = res;
          this.repoChanged();
          this.resetList();
        } else if (!sameRepo(res, this.repo)) {
          this.setRepo(res);
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

  setRepo({ kind, host, path }) {
    this.repo = { kind, host, path };
    this.provider = providerFor(this.repo);
    this.repoError = null;
    this.repoChanged();
    this.resetList();
  }

  // ---- polling -----------------------------------------------------------------

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
        if (gen === this.gen) this.listAt = Date.now() + nextDelay({ visible: this.pollVisible(), anyRunning: anyLive(this.runs), errors: this.errors });
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

  // Every copy (full or side) tries to own the watch list every 30s; the owner polls watches on
  // that cadence, backing off on errors.
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

  // ---- list controls -------------------------------------------------------------

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

  clearFilters(cx) {
    this.filter.set_value("");
    this.setChip("all", cx);
  }

  // The filter box, the chips and the This branch toggle. `ids` prefixes element ids; `branchName`
  // false leaves the branch out of the toggle's label (the narrow side view).
  listControls(t, ids, { branchName = true } = {}) {
    const total = this.runs.length;
    const chips = [filterChip(t, `${ids}-chip-all`, "All", this.counts.all, this.chip === "all", (cx) => this.setChip("all", cx))];
    for (const c of CHIP_LIST) {
      if (this.counts[c.id] > 0 || this.chip === c.id) {
        chips.push(filterChip(t, `${ids}-chip-${c.id}`, c.label, this.counts[c.id], this.chip === c.id, (cx) => this.setChip(c.id, cx), c.color(t)));
      }
    }
    const branchLabel = branchName && this.branch ? `This branch · ${this.branch}` : "This branch";
    return v_flex().flex_none().px(12).pt(10).pb(4).gap(8)
      .child(searchBox(t, `${ids}-filter`, this.filter, {
        right: this.filtering ? `${this.shown.length}/${total}` : String(total),
        onClear: (cx) => { this.filter.set_value(""); this.recompute(); cx.notify(); },
      }))
      .child(h_flex().flex_wrap().gap(4).items_center().children(chips).child(div().flex_1())
        .child(tabPill(t, `${ids}-this-branch`, branchLabel, this.thisBranch, (cx) => this.toggleBranch(cx), { check: true })));
  }
}
