// Job log view: opens as a pane beside a terminal. props: { kind, host, path, runId, jobId, name }.
// Fetches the log, cleans it, scrolls to the first error once, and polls while the job runs.
// Lines render through a virtual list with a fixed row height, so a 2 MB log stays cheap.
import { div } from "gpui-kit";
import { v_flex, h_flex, v_virtual_list, VirtualListScrollHandle, Scrollbar } from "gpui-base";
import { theme, settings, props, checking } from "herdr";
import { providerFor } from "../forge/providers.js";
import { cleanLog, findJob } from "../ci/log.js";

const MAX_BYTES = 2_000_000;
const POLL_MS = 5000;
const ROW = 18;
const HEADER = 40;
const NOTE = 28;

// A failure as { message, hint }: the hint (a ForgeError's login or access advice) shows in code font.
const failure = (e, prefix = "") => ({ message: prefix + String(e?.message ?? e), hint: e?.hint ?? "" });

export class LogView {
  init(given, cx) {
    // Read props once: live, Herdr gives a pane copy an empty object here, so fall back to props().
    this.props = (given && Object.keys(given).length ? given : props()) ?? {};
    this.provider = providerFor(this.props);
    this.scroll = VirtualListScrollHandle.new();
    this.log = { lines: [], firstError: null };
    this.truncated = false;
    this.available = true;
    this.live = true; // keep polling
    this.loaded = false;
    this.busy = false;
    this.error = null;
    this.url = null;
    this.scrolled = false;
    this.lastText = null;
    this.size = null;
    if (checking()) return;
    this.refresh(cx);
    cx.timer.every(POLL_MS, (cx) => { if (this.live) this.refresh(cx); });
  }

  refresh(cx) {
    if (this.busy) return;
    this.busy = true;
    cx.spawn(async (cx) => {
      const state = () => [this.loaded, this.live, this.available, this.truncated, this.error?.message, this.error?.hint, this.url, this.lastText];
      const before = state();
      try {
        const res = await this.provider.jobLog(this.props.jobId, { maxBytes: MAX_BYTES });
        this.error = null;
        this.available = res.available;
        this.truncated = res.truncated;
        if (res.text !== this.lastText) {
          this.lastText = res.text;
          this.log = cleanLog(res.text);
        }
        // GitLab can stream a running job's log; GitHub's appears once the job is done.
        const liveLog = this.provider.capabilities.liveLog;
        if (!liveLog) this.live = !res.available;
        // The status lookup is separate: if it fails the log stays and the next tick retries.
        if (liveLog || !this.url) {
          try {
            const detail = await this.provider.runDetail(this.props.runId);
            const job = findJob(detail, this.props.jobId);
            this.url = job?.url || detail.run?.url || this.url;
            if (liveLog) this.live = job ? job.status === "running" || job.status === "pending" : false;
          } catch (e) {
            this.error = failure(e, "Could not check job status: ");
          }
        }
      } catch (e) {
        this.error = failure(e);
        this.live = false;
      } finally {
        this.busy = false;
        this.loaded = true;
      }
      if (state().some((v, i) => v !== before[i])) cx.notify();
      // The list is first drawn on the frame after this notify; a scroll asked before then is lost.
      if (!this.scrolled && this.log.firstError !== null) {
        this.scrolled = true;
        const index = this.log.firstError;
        cx.timer.after(150, () => this.scroll.scroll_to_item(index, "center"));
      }
    });
  }

  button(t, id, label, onClick) {
    return div().id(id).h(26).px(10).flex().items_center().rounded(6).text_size(12).cursor_pointer()
      .bg(t.raised).text_color(t.foreground).hover((s) => s.bg(t.hover)).on_click(onClick).child(label);
  }

  render(cx) {
    const t = theme();
    const mono = settings().font_family ?? "JetBrains Mono";
    const color = (i) => (i === undefined ? t.foreground : t[`ansi${i}`]);
    const note = (text, c) => div().flex_none().h(NOTE).px(12).flex().items_center().text_size(12).text_color(c ?? t.muted).truncate().child(text);

    const header = h_flex().flex_none().h(HEADER).px(12).gap(8).items_center().border_b_1().border_color(t.border)
      .child(div().flex_1().min_w(0).truncate().text_size(13).font_semibold().text_color(t.foreground).child(this.props.name ?? "Job log"))
      .when(this.live, (e) => e.child(div().flex_none().text_size(11).text_color(t.dim).child("live")))
      .child(this.button(t, "log-open", "Open in browser", (_e, cx) => { if (this.url) cx.open_url(this.url); }))
      .child(this.button(t, "log-refresh", "Refresh", (_e, cx) => this.refresh(cx)));

    const showLog = this.loaded && this.available && this.log.lines.length > 0;
    const notes = [];
    if (this.truncated && showLog) notes.push(note(`truncated (showing last ${MAX_BYTES / 1_000_000} MB)`, t.dim));
    if (this.error) {
      notes.push(note(this.error.message, t.ansi1));
      if (this.error.hint) {
        notes.push(h_flex().flex_none().h(NOTE).px(12).items_center()
          .child(div().min_w(0).px(8).py(2).rounded(6).bg(t.raised).text_size(12).font_family(mono)
            .text_color(t.foreground).truncate().child(this.error.hint)));
      }
    }
    if (!this.loaded) notes.push(note("Loading log..."));
    else if (!this.available) notes.push(note("Log available when the job finishes"));
    else if (this.log.lines.length === 0 && !this.error) notes.push(note("The log is empty"));

    let body = null;
    if (showLog) {
      const lines = this.log.lines;
      const height = Math.max(ROW * 3, (this.size?.height ?? 400) - HEADER - NOTE * notes.length);
      body = v_flex().relative().flex_none().w_full().h(height)
        .child(v_virtual_list("log-lines", lines.length, ROW, (i) => String(i),
          (range) => lines.slice(range.start, range.end).map((line, k) => this.row(t, mono, color, line, range.start + k)))
          .track_scroll(this.scroll).px(12).font_family(mono).text_size(12).text_color(t.foreground))
        .child(Scrollbar.vertical("log-lines").absolute().inset_0());
    }

    return v_flex().id("log-root").size_full().bg(t.background)
      .on_size_change((size, cx) => { this.size = size; cx.notify(); })
      .child(header).children(notes).when(Boolean(body), (e) => e.child(body));
  }

  row(t, mono, color, line, index) {
    return h_flex().h(ROW).items_center().whitespace_nowrap()
      .when(index === this.log.firstError, (e) => e.bg(t.raised))
      .children(line.spans.length === 0 ? [div().child(" ")] : line.spans.map((s) => div().flex_none().text_color(color(s.fg))
        .when(Boolean(s.bold), (e) => e.font_bold()).child(s.text)));
  }
}
