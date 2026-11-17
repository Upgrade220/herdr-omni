// Job log view: opens as a pane beside a terminal. props: { kind, host, path, runId, jobId, name }.
// Fetches the log, cleans it, scrolls to the first error once, and polls while the job runs.
import { div, svg } from "gpui-kit";
import { v_flex, h_flex, ScrollHandle } from "gpui-base";
import { theme, settings } from "herdr";
import { providerFor } from "../forge/providers.js";
import { cleanLog } from "../ci/log.js";

const MAX_BYTES = 2_000_000;
const POLL_MS = 5000;

export class LogView {
  init(props, cx) {
    this.props = props ?? {};
    this.provider = providerFor(this.props);
    this.scroll = ScrollHandle.new();
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
    this.refresh(cx);
    cx.timer.every(POLL_MS, (cx) => { if (this.live) this.refresh(cx); });
  }

  refresh(cx) {
    if (this.busy) return;
    this.busy = true;
    cx.spawn(async (cx) => {
      try {
        const { runId, jobId } = this.props;
        const res = await this.provider.jobLog(jobId, { maxBytes: MAX_BYTES });
        this.error = null;
        this.available = res.available;
        this.truncated = res.truncated;
        if (res.text !== this.lastText) {
          this.lastText = res.text;
          this.log = cleanLog(res.text);
        }
        // GitLab can stream a running job's log; GitHub's appears once the job is done.
        if (this.provider.capabilities.liveLog) {
          const detail = await this.provider.runDetail(runId);
          const job = detail.groups.flatMap((g) => g.jobs).find((j) => String(j.id) === String(jobId));
          this.url = job?.url || this.url;
          this.live = job ? job.status === "running" || job.status === "pending" : false;
        } else {
          this.live = !res.available;
          if (!this.url) {
            const detail = await this.provider.runDetail(runId);
            this.url = detail.groups.flatMap((g) => g.jobs).find((j) => String(j.id) === String(jobId))?.url || detail.run.url;
          }
        }
      } catch (e) {
        this.error = String(e?.message ?? e);
        this.live = false;
      } finally {
        this.busy = false;
        this.loaded = true;
      }
      cx.notify();
      if (!this.scrolled && this.log.firstError !== null) {
        this.scrolled = true;
        this.scroll.scroll_to_item(this.log.firstError);
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
    const note = (text, c) => div().flex_none().px(12).py(6).text_size(12).text_color(c ?? t.muted).child(text);

    const header = h_flex().flex_none().h(40).px(12).gap(8).items_center().border_b_1().border_color(t.border)
      .child(div().flex_1().min_w(0).truncate().text_size(13).font_semibold().text_color(t.foreground).child(this.props.name ?? "Job log"))
      .when(this.live, (e) => e.child(div().flex_none().text_size(11).text_color(t.dim).child("live")))
      .child(this.button(t, "log-open", "Open in browser", (_e, cx) => { if (this.url) cx.open_url(this.url); }))
      .child(this.button(t, "log-refresh", "Refresh", (_e, cx) => this.refresh(cx)));

    let body;
    if (!this.loaded) body = note("Loading log...");
    else if (this.error) body = note(this.error, t.ansi1);
    else if (!this.available) body = note("Log available when the job finishes");
    else if (this.log.lines.length === 0) body = note("The log is empty");
    else {
      body = div().id("log-scroll").flex_1().min_h(0).overflow_y_scroll().track_scroll(this.scroll)
        .px(12).py(8).font_family(mono).text_size(12).text_color(t.foreground)
        .children(this.log.lines.map((line, i) => h_flex().whitespace_nowrap()
          .when(i === this.log.firstError, (e) => e.bg(t.raised))
          .children(line.spans.length === 0 ? [div().child(" ")] : line.spans.map((s) => div().flex_none().text_color(color(s.fg))
            .when(Boolean(s.bold), (e) => e.font_bold()).child(s.text)))));
    }

    return v_flex().size_full().bg(t.background)
      .child(header)
      .when(this.truncated, (e) => e.child(note(`truncated (showing last ${MAX_BYTES / 1_000_000} MB)`, t.dim)))
      .child(body);
  }
}
