// Run detail inside the full view: header with run actions, groups -> jobs with job actions,
// artifacts with download. `owner` is the FullView (repo, provider, watches, back()).
import { div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { exec, home, notify, focused, run as runCommand } from "herdr";
import { watchKey } from "../ci/watch.js";
import { nextDelay } from "../ci/poller.js";
import { ago, dur, size } from "./runs.js";
import { openSendDialog } from "./send.js";
import { icon, pill, section, statusIcon, runPills, button, busyState, errorState } from "./ui.js";

const LIVE = new Set(["running", "pending"]);
export const WATCHABLE = new Set(["running", "pending", "manual"]);
const DONE = new Set(["success", "failed", "canceled"]);
const HOT_MS = 60000; // after an action, poll fast for a while: the forge takes a moment to react

const errorText = (e) => [String(e?.message ?? e), e?.hint].filter(Boolean).join("\n");

export class Detail {
  constructor(owner, runId, run = null) {
    this.owner = owner;
    this.runId = String(runId);
    this.run = run; // the list's copy until the detail loads
    this.data = null;
    this.error = null;
    this.loading = false;
    this.errors = 0;
    this.nextAt = 0;
    this.hotUntil = 0;
    this.acting = new Set(); // ids of action buttons whose request runs
    this.downloads = {}; // artifact id -> { state: "busy" | "done" | "error", path }
  }

  get repo() { return this.owner.repo; }
  get provider() { return this.owner.provider; }
  key() { return watchKey({ ...this.repo, runId: this.runId }); }

  // Fetches the RunDetail. Watches running/pending/manual runs (add is a no-op when present).
  load(cx) {
    if (this.loading || !this.provider) return;
    this.loading = true;
    const provider = this.provider;
    cx.spawn(async (cx) => {
      try {
        const data = await provider.runDetail(this.runId);
        if (this.owner.detail !== this || this.provider !== provider) return;
        this.data = data;
        this.run = data.run;
        this.error = null;
        this.errors = 0;
        if (WATCHABLE.has(data.run.status)) this.owner.watches.add(this.key(), data.run);
      } catch (e) {
        if (this.owner.detail !== this) return;
        this.error = e;
        this.errors++;
      } finally {
        this.loading = false;
        const jobsLive = (this.data?.groups ?? []).some((g) => g.jobs.some((j) => LIVE.has(j.status)));
        const anyRunning = LIVE.has(this.run?.status) || jobsLive || Date.now() < this.hotUntil;
        this.nextAt = Date.now() + nextDelay({ visible: true, anyRunning, errors: this.errors });
        cx.notify();
      }
    });
  }

  // Runs an action: its button disables while the request runs; failure notifies, success refreshes.
  act(cx, id, label, fn) {
    if (this.acting.has(id)) return;
    this.acting.add(id);
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        await fn();
        this.hotUntil = Date.now() + HOT_MS;
        this.load(cx);
      } catch (e) {
        notify({ title: `${label} failed`, body: errorText(e), level: "error" });
      } finally {
        this.acting.delete(id);
        cx.notify();
      }
    });
  }

  download(cx, artifact) {
    if (this.downloads[artifact.id]?.state === "busy") return;
    this.downloads[artifact.id] = { state: "busy" };
    cx.notify();
    const provider = this.provider;
    cx.spawn(async (cx) => {
      try {
        const path = await provider.downloadArtifact(artifact, `${home()}/Downloads`);
        this.downloads[artifact.id] = { state: "done", path };
        await exec("open", ["-R", path]);
      } catch (e) {
        if (this.downloads[artifact.id]?.state === "busy") this.downloads[artifact.id] = { state: "error" };
        notify({ title: `Download of ${artifact.name} failed`, body: errorText(e), level: "error" });
      }
      cx.notify();
    });
  }

  openLog(job) {
    const { kind, host, path } = this.repo;
    runCommand("pane.split", { direction: "right", mod: "omni-forge", props: { view: "log", kind, host, path, runId: this.runId, jobId: job.id, name: job.name } });
  }

  // The Send to agent dialog for a failed job. A new agent starts in the followed terminal's folder.
  sendToAgent(job) {
    const loc = this.owner.loc;
    openSendDialog({ repo: this.repo, run: this.run, job, folder: loc?.cwd, machine: loc?.machine, space: focused()?.space });
  }

  // ---- actions ---------------------------------------------------------------

  // Buttons for the run as { id, label, onClick, primary?, danger? }.
  runActions() {
    const run = this.run;
    if (!run) return [];
    const p = this.provider;
    const out = [];
    if (DONE.has(run.status)) {
      out.push({ id: "run-retry", label: "Retry", primary: true, onClick: (cx) => this.act(cx, "run-retry", "Retry", () => p.retryRun(this.runId)) });
      if (p.capabilities.retryFailed && run.status === "failed") {
        out.push({ id: "run-retry-failed", label: "Retry failed", onClick: (cx) => this.act(cx, "run-retry-failed", "Retry failed", () => p.retryRun(this.runId, { failedOnly: true })) });
      }
    }
    if (LIVE.has(run.status)) {
      out.push({ id: "run-cancel", label: "Cancel", danger: true, onClick: (cx) => this.act(cx, "run-cancel", "Cancel", () => p.cancelRun(this.runId)) });
    }
    if (run.url) out.push({ id: "run-web", label: "Open in browser", onClick: (cx) => cx.open_url(run.url) });
    return out;
  }

  // Buttons for one job, same shape as runActions. A failed job also gets Send to agent.
  jobActions(job, ids) {
    const p = this.provider;
    const out = [];
    if (job.status === "manual" && p.capabilities.play) {
      out.push({ id: `${ids}-play`, label: "Play", symbol: "play", primary: true, onClick: (cx) => this.act(cx, `${ids}-play`, `Play ${job.name}`, () => p.playJob(job.id)) });
    }
    // GitHub reruns a job only once its run has finished; GitLab retries any finished job.
    const runDone = this.repo.kind !== "github" || DONE.has(this.run?.status);
    if (DONE.has(job.status) && runDone) {
      out.push({ id: `${ids}-retry`, label: "Retry", onClick: (cx) => this.act(cx, `${ids}-retry`, `Retry ${job.name}`, () => p.retryJob(job.id)) });
    }
    if (LIVE.has(job.status) && this.repo.kind !== "github") {
      out.push({ id: `${ids}-cancel`, label: "Cancel", danger: true, onClick: (cx) => this.act(cx, `${ids}-cancel`, `Cancel ${job.name}`, () => p.cancelJob(job.id)) });
    }
    if (job.status !== "manual" && job.status !== "skipped") {
      out.push({ id: `${ids}-log`, label: "Log", onClick: () => this.openLog(job) });
    }
    if (job.status === "failed") {
      out.push({ id: `${ids}-agent`, label: "Send to agent", onClick: () => this.sendToAgent(job) });
    }
    return out;
  }

  buttons(t, actions) {
    return actions.map((a) => button(t, a.id, a.label, a.onClick, { primary: a.primary, danger: a.danger, symbol: a.symbol, busy: this.acting.has(a.id) }));
  }

  // ---- render ------------------------------------------------------------------

  render(t) {
    const run = this.run;
    const top = h_flex().flex_none().px(12).py(8).gap(8).items_center().flex_wrap().border_b_1().border_color(t.border)
      .child(button(t, "detail-back", "‹ Runs", (cx) => this.owner.back(cx)))
      .child(div().flex_1())
      .children(this.buttons(t, this.runActions()));
    if (!this.data) {
      const body = this.error
        ? errorState(t, "detail-retry", this.error, (cx) => this.load(cx))
        : busyState(t, "Loading run…");
      return v_flex().flex_1().min_h(0).child(top).child(body);
    }

    const now = Date.now();
    const head = v_flex().flex_none().px(14).py(12).gap(8)
      .child(h_flex().gap(10).items_center().child(statusIcon(t, run.status))
        .child(div().flex_1().min_w(0).truncate().text_size(15).font_semibold().child(run.title || `Run ${run.number ?? run.id}`))
        .child(div().flex_none().text_size(11).text_color(t.dim).child(run.number != null ? `#${run.number}` : "")))
      .child(runPills(t, run, this.repo.kind, { author: false }).pl(24))
      .child(div().pl(24).text_size(11).text_color(t.dim).child([run.author, ago(run.createdAt, now)].filter(Boolean).join(" · ")));

    const rows = [];
    this.data.groups.forEach((g, gi) => {
      // GitHub has one group per job named after it: no header then.
      const solo = g.jobs.length === 1 && g.jobs[0].name === g.name;
      if (!solo) rows.push(section(t, g.name.toUpperCase(), g.jobs.length, t.muted));
      g.jobs.forEach((job, ji) => rows.push(this.jobRow(t, job, `job-${gi}-${ji}`)));
    });
    if (!rows.length) rows.push(div().px(14).py(6).text_size(12).text_color(t.dim).child("No jobs yet."));

    const artifacts = this.data.artifacts;
    return v_flex().flex_1().min_h(0).child(top)
      .child(v_flex().id("detail-scroll").flex_1().min_h(0).overflow_y_scrollbar().pb(12)
        .child(head)
        .when(Boolean(this.error), (e) => e.child(div().px(14).pb(6).text_size(11).text_color(t.ansi1).child(`Update failed: ${this.error?.message ?? this.error}`)))
        .children(rows)
        .when(artifacts.length > 0, (e) => e.child(section(t, "ARTIFACTS", artifacts.length, t.muted))
          .children(artifacts.map((a, i) => this.artifactRow(t, a, `art-${i}`)))));
  }

  jobRow(t, job, ids) {
    return v_flex().flex_none()
      .child(h_flex().id(ids).min_h(34).flex_none().px(14).gap(8).items_center().hover((s) => s.bg(t.hover))
        .child(statusIcon(t, job.status))
        .child(div().flex_1().min_w(0).truncate().text_size(13).child(job.name))
        .when(job.allowFailure, (e) => e.child(pill(t, { label: "allowed to fail" })))
        .child(div().flex_none().text_size(11).text_color(t.dim).child(dur(job.durationSec)))
        .children(this.buttons(t, this.jobActions(job, ids))))
      .children((job.steps ?? []).filter((s) => s.status !== "success" || job.status !== "success").map((s) =>
        h_flex().h(22).flex_none().pl(36).pr(14).gap(8).items_center().text_size(12).text_color(t.muted)
          .child(statusIcon(t, s.status, 12))
          .child(div().flex_1().min_w(0).truncate().child(s.name))
          .child(div().flex_none().text_size(11).text_color(t.dim).child(dur(s.durationSec)))));
  }

  artifactRow(t, a, ids) {
    const dl = this.downloads[a.id];
    const label = dl?.state === "done" ? "Again" : dl?.state === "error" ? "Retry" : "Download";
    return h_flex().id(ids).min_h(34).flex_none().px(14).gap(10).items_center()
      .child(svg(icon("package")).size(15).flex_none().text_color(t.accent))
      .child(div().flex_1().min_w(0).truncate().text_size(13).child(a.name))
      .when(a.sizeBytes > 0, (e) => e.child(pill(t, { label: size(a.sizeBytes) })))
      .when(dl?.state === "done", (e) => e.child(pill(t, { label: "downloaded", glyph: "✓", color: t.ansi2 })))
      .child(button(t, `${ids}-dl`, label, (cx) => this.download(cx, a), { busy: dl?.state === "busy" }));
  }
}
