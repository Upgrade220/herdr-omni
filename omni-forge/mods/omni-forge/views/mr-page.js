// MrPage: one MR's page inside the full view's MR tab (read side): header, description, discussion,
// changed files. `owner` is the FullView (repo, loc, provider, gen, tabs, mrPages, openRun()). Like
// Detail, one object per tab with a stale guard; no cx is stored. Polls every 15 s while its tab shows.
import { div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { nextDelay } from "../ci/poller.js";
import { ago } from "./runs.js";
import { mrNumber } from "./mrs.js";
import { openMrFile } from "../actions/diff.js";
import { pill, statusPill, section, button, busyState, mono, icon } from "./ui.js";

export const POLL_MS = 15000;

const KEPT_SYSTEM = [/\bapproved\b/i, /\badded \d+ commits?\b/i];
const errorText = (e) => [String(e?.message ?? e), e?.hint].filter(Boolean).join("\n");

// Threads as shown: a system note stays only when it is an approval or an "added N commits" note
// (dimmed); a thread left without notes disappears.
export function discussion(threads) {
  const out = [];
  for (const t of threads ?? []) {
    const notes = (t.notes ?? [])
      .filter((n) => !n.system || KEPT_SYSTEM.some((re) => re.test(n.body ?? "")))
      .map((n) => ({ ...n, dim: Boolean(n.system) }));
    if (notes.length) out.push({ ...t, notes });
  }
  return out;
}

// The MR's page on the forge: its own url, else built from the repo.
export function mrWebUrl(repo, number, mr) {
  if (mr?.url) return mr.url;
  if (!repo) return "";
  return repo.kind === "gitlab" ? `https://${repo.host}/${repo.path}/-/merge_requests/${number}` : `https://${repo.host}/${repo.path}/pull/${number}`;
}

export class MrPage {
  constructor(owner, number) {
    this.owner = owner;
    this.number = String(number);
    this.data = null;
    this.error = null;
    this.loading = false;
    this.errors = 0;
    this.nextAt = 0;
    this.opening = new Set(); // paths whose file is being opened
    this.fileError = null; // { path, error } of the last file that could not be shown
  }

  get repo() { return this.owner.repo; }

  load(cx) {
    const { provider, gen } = this.owner;
    if (this.loading || !provider) return;
    this.loading = true;
    cx.notify();
    cx.spawn(async (cx) => {
      let current = true;
      try {
        const data = await provider.mrDetail(Number(this.number));
        // A newer repo (gen) or a closed tab makes the answer stale.
        if (gen !== this.owner.gen || this.owner.mrPages.get(this.number) !== this) { current = false; return; }
        this.data = data;
        this.error = null;
        this.errors = 0;
        this.owner.tabs?.setMr({ number: this.number, label: `${mrNumber(this.repo.kind, this.number)} ${data.mr.title ?? ""}`.trim() });
      } catch (e) {
        if (gen !== this.owner.gen || this.owner.mrPages.get(this.number) !== this) { current = false; return; }
        this.error = e;
        this.errors++;
      } finally {
        this.loading = false;
        if (current) this.nextAt = Date.now() + (this.errors ? nextDelay({ visible: true, anyRunning: false, errors: this.errors }) : POLL_MS);
        cx.notify();
      }
    });
  }

  dismissFileError(cx) {
    this.fileError = null;
    cx.notify();
  }

  // Shows a changed file in the Diff tab. A failure stays on the page (fileError) until dismissed or
  // the next successful open.
  openFile(cx, path) {
    if (this.opening.has(path) || !this.data) return;
    this.opening.add(path);
    cx.notify();
    const { mr } = this.data;
    cx.spawn(async (cx) => {
      try {
        const res = await openMrFile({ repo: this.repo, loc: this.owner.loc, mr, path });
        this.fileError = res.ok ? null : { path, error: res.error };
      } finally {
        this.opening.delete(path);
        cx.notify();
      }
    });
  }

  // ---- render --------------------------------------------------------------

  topBar(t, url) {
    return h_flex().flex_none().px(12).py(8).gap(8).items_center().border_b_1().border_color(t.border)
      .child(button(t, "mr-back", "‹ MRs", (cx) => this.owner.selectTab("mrs", cx)))
      .child(div().flex_1())
      .when(Boolean(url), (e) => e.child(button(t, "mr-web", "Open in browser", (cx) => cx.open_url(url))));
  }

  render(t) {
    const url = mrWebUrl(this.repo, this.number, this.data?.mr);
    const top = this.topBar(t, url);
    if (!this.data) {
      const body = this.error
        ? v_flex().flex_1().min_h(0).p(16).gap(10).items_start()
          .child(div().text_color(t.ansi1).child("Cannot load this MR"))
          .child(div().px(8).py(4).rounded(6).bg(t.raised).text_size(12).font_family(mono()).text_color(t.foreground).child(errorText(this.error)))
          .child(h_flex().gap(8)
            .child(button(t, "mr-retry", "Try again", (cx) => this.load(cx)))
            .child(button(t, "mr-web-error", "Open in browser", (cx) => cx.open_url(url))))
        : busyState(t, "Loading MR…");
      return v_flex().flex_1().min_h(0).child(top).child(body);
    }
    const { mr, description, files } = this.data;
    const now = Date.now();
    const threads = discussion(this.data.threads);
    return v_flex().flex_1().min_h(0).child(top)
      .child(v_flex().id("mr-scroll").flex_1().min_h(0).overflow_y_scrollbar().pb(12)
        .child(this.head(t, mr, now))
        .when(Boolean(this.error), (e) => e.child(div().px(14).pb(6).text_size(11).text_color(t.ansi1).child(`Update failed: ${errorText(this.error)}`)))
        .child(section(t, "DESCRIPTION", null, t.muted))
        .child(div().px(14).py(4).text_size(13).text_color(description ? t.foreground : t.dim).child(description || "No description."))
        .child(section(t, "DISCUSSION", threads.length, t.muted))
        .children(threads.length ? threads.map((th, i) => this.thread(t, th, i, now)) : [div().px(14).py(4).text_size(12).text_color(t.dim).child("No discussion yet.")])
        .when(Boolean(this.fileError), (e) => e.child(this.fileErrorBox(t, mr, url)))
        .child(section(t, "FILES", files.length, t.muted))
        .children(files.length ? files.map((f, i) => this.fileRow(t, f, i)) : [div().px(14).py(4).text_size(12).text_color(t.dim).child("No changed files.")]));
  }

  fileErrorBox(t, mr, url) {
    const { path, error } = this.fileError;
    return v_flex().id("mr-file-error").flex_none().mx(14).my(4).p(10).gap(8).items_start().rounded(8).bg(t.raised)
      .child(div().text_size(12).text_color(t.ansi1).child(`Could not fetch ${mrNumber(this.repo.kind, mr.number)} to show ${path}`))
      .child(div().px(8).py(4).rounded(6).text_size(12).font_family(mono()).text_color(t.foreground).child(error))
      .child(h_flex().gap(8)
        .child(button(t, "mr-file-error-web", "Open in browser", (cx) => cx.open_url(url)))
        .child(button(t, "mr-file-error-dismiss", "Dismiss", (cx) => this.dismissFileError(cx))));
  }

  head(t, mr, now) {
    const approvals = mr.approvalsRequired != null ? `${mr.approvals}/${mr.approvalsRequired} approved` : `${mr.approvals ?? 0} approved`;
    const stateColor = mr.state === "merged" ? t.accent : mr.state === "closed" ? t.ansi1 : t.ansi2;
    const pipeline = mr.pipeline
      ? mr.pipelineRunId
        ? h_flex().id("mr-pipeline").flex_none().cursor_pointer().on_click((_e, cx) => this.owner.openRun({ id: mr.pipelineRunId }, cx)).child(statusPill(t, mr.pipeline))
        : statusPill(t, mr.pipeline)
      : null;
    return v_flex().flex_none().px(14).py(12).gap(8)
      .child(h_flex().gap(10).items_center()
        .child(div().flex_1().min_w(0).text_size(15).font_semibold().child(mr.title))
        .child(div().flex_none().text_size(11).text_color(t.dim).child(mrNumber(this.repo.kind, mr.number))))
      .child(h_flex().gap(6).items_center().flex_wrap()
        .child(pill(t, { label: mr.state, color: stateColor }))
        .when(Boolean(mr.draft), (e) => e.child(pill(t, { label: "draft" })))
        .when(Boolean(pipeline), (e) => e.child(pipeline))
        .child(pill(t, { label: approvals, color: mr.approvals > 0 ? t.ansi2 : undefined }))
        .when(mr.unresolved > 0, (e) => e.child(pill(t, { label: `${mr.unresolved} unresolved`, color: t.ansi3 }))))
      .child(div().text_size(11).text_color(t.dim).child(`${mr.author} · ${mr.source} → ${mr.target} · ${ago(mr.updatedAt, now)}`));
  }

  thread(t, th, i, now) {
    return v_flex().id(`mr-thread-${i}`).flex_none().mx(14).my(4).p(8).gap(6).rounded(8).bg(t.raised)
      .when(Boolean(th.path), (e) => e.child(h_flex().gap(8).items_center()
        .child(div().id(`mr-thread-link-${i}`).min_w(0).truncate().text_size(12).font_family(mono()).text_color(t.accent).cursor_pointer()
          .on_click((_e, cx) => this.openFile(cx, th.path))
          .child(th.line != null ? `${th.path}:${th.line}` : th.path))
        .when(Boolean(th.resolved), (e2) => e2.child(pill(t, { label: "resolved", glyph: "✓", color: t.ansi2 })))))
      .when(!th.path && Boolean(th.resolved), (e) => e.child(pill(t, { label: "resolved", glyph: "✓", color: t.ansi2 })))
      .children(th.notes.map((n, j) => v_flex().id(`mr-note-${i}-${j}`).gap(2)
        .child(div().text_size(11).text_color(t.dim).child([n.author, ago(n.createdAt, now)].filter(Boolean).join(" · ")))
        .child(div().text_size(13).text_color(n.dim ? t.dim : t.foreground).child(n.body))));
  }

  fileRow(t, f, i) {
    const busy = this.opening.has(f.path);
    return h_flex().id(`mr-file-${i}`).min_h(28).flex_none().px(14).gap(8).items_center().cursor_pointer().hover((s) => s.bg(t.hover))
      .on_click((_e, cx) => this.openFile(cx, f.path))
      .child(div().flex_1().min_w(0).truncate().text_size(12).font_family(mono()).text_color(busy ? t.dim : t.foreground).child(f.path))
      .when(busy, (e) => e.child(svg(icon("spinner")).size(11).flex_none().text_color(t.dim).spin(900)))
      .child(div().flex_none().text_size(11).text_color(t.ansi2).child(`+${f.add ?? 0}`))
      .child(div().flex_none().text_size(11).text_color(t.ansi1).child(`−${f.del ?? 0}`));
  }
}
