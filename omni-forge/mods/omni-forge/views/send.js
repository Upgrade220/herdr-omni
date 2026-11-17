// Send to agent: a dialog copy of this mod (props.view "send"), opened from a failed job in the
// run detail. It fetches the job's log tail, builds the prompt (actions/agent.js) into an editable
// box, and delivers it to a running agent of the space (`hc send`) or to a new agent tab.
import { div } from "gpui-kit";
import { v_flex, h_flex, Popover, Textarea, TextareaState } from "gpui-base";
import {
  theme, props, agents, knownAgents, hc, notify, openOverlay, closeOverlay, checking, shared, setShared, run as runCommand,
} from "herdr";
import { providerFor } from "../forge/providers.js";
import { cleanLog } from "../ci/log.js";
import { buildAgentPrompt, agentChoices } from "../actions/agent.js";
import { MOD } from "./locate.js";
import { button, mono } from "./ui.js";

const LOG_BYTES = 64000; // well over 120 lines of most logs
// The last choice's key. Shared state, not localStorage: each dialog is a new copy of the mod and
// localStorage is per copy.
const LAST_AGENT = "omni-forge.send.agent";
const WIDTH = 640;
const HEIGHT = 560;

const errorText = (e) => [String(e?.message ?? e), e?.hint].filter(Boolean).join("\n");

/**
 * Opens the dialog for a failed job. `repo` {kind, host, path}; `run` the Run; `job` the Job;
 * `folder`/`machine` where a new agent starts (the repo's cwd); `space` whose agents to offer.
 * Plain data only: it crosses to the dialog's own copy of this mod.
 */
export function openSendDialog({ repo, run, job, folder, machine, space }) {
  openOverlay({
    kind: "dialog",
    mod: MOD,
    width: WIDTH,
    height: HEIGHT,
    props: {
      view: "send",
      kind: repo.kind, host: repo.host, path: repo.path,
      run: { id: String(run?.id ?? ""), number: run?.number ?? null, title: run?.title ?? "", branch: run?.branch ?? null, request: run?.request ?? null },
      job: { id: String(job.id), name: job.name },
      url: job.url || run?.url || "",
      folder: folder ?? null,
      machine: machine ?? null,
      space: space ?? null,
    },
  });
}

export class SendView {
  init(given, cx) {
    // Read props once: props() in a later callback can answer for another copy.
    this.props = (given && Object.keys(given).length ? given : props()) ?? {};
    const p = this.props;
    this.overlay = p.overlay ?? props()?.overlay;
    this.repo = { kind: p.kind, host: p.host, path: p.path };
    this.prompt = TextareaState.new({ placeholder: "What should the agent do?" });
    this.known = [];
    this.knownLoading = true;
    this.logLoading = true;
    this.logError = null;
    this.lastKey = shared(LAST_AGENT) ?? null;
    this.selected = null;
    this.menuOpen = false;
    this.sending = false;
    if (checking()) {
      this.knownLoading = false;
      this.setPrompt("");
      return;
    }
    this.loadLog(cx);
    this.loadKnown(cx);
  }

  setPrompt(logTail) {
    const p = this.props;
    this.prompt.set_value(buildAgentPrompt({ repo: this.repo, run: p.run, job: p.job, url: p.url, logTail }));
    this.logLoading = false;
  }

  loadLog(cx) {
    cx.spawn(async (cx) => {
      let tail = "";
      try {
        const res = await providerFor(this.repo).jobLog(this.props.job.id, { maxBytes: LOG_BYTES });
        tail = cleanLog(res.text).lines.map((l) => l.spans.map((s) => s.text).join("")).join("\n");
      } catch (e) {
        this.logError = errorText(e);
      }
      this.setPrompt(tail);
      cx.notify();
    });
  }

  loadKnown(cx) {
    cx.spawn(async (cx) => {
      try {
        this.known = await knownAgents({ on: this.props.machine ?? null });
      } catch {
        this.known = []; // running agents still work
      }
      this.knownLoading = false;
      cx.notify();
    });
  }

  // Agents of the space the dialog was opened from (all of them when it is unknown), then new ones.
  choices() {
    const space = this.props.space;
    const running = agents().filter((a) => !space || a.space === space);
    return agentChoices(running, this.known, this.lastKey);
  }

  current(choices) {
    return choices.find((c) => c.key === this.selected) ?? choices.find((c) => c.key === this.lastKey) ?? choices[0] ?? null;
  }

  close() {
    if (this.overlay) closeOverlay(this.overlay);
  }

  // Delivers the prompt. On failure the dialog stays open, so nothing typed is lost.
  send(cx) {
    const choice = this.current(this.choices());
    const text = this.prompt.value().trim();
    if (!choice || !text || this.sending || this.logLoading) return;
    if (choice.kind === "new") {
      // run() reports nothing back (it returns null); Herdr itself toasts a launch that fails, so
      // the dialog closes once the tab is asked for.
      const args = { argv: choice.run, task: text };
      if (this.props.folder) args.folder = this.props.folder;
      if (this.props.space) args.space = this.props.space;
      runCommand("tab.new", args);
      setShared(LAST_AGENT, choice.key);
      this.close();
      return;
    }
    this.sending = true;
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        const res = await hc(["send", choice.terminal, text]);
        if (res.code !== 0) throw new Error(res.stderr.trim() || `hc send exited with ${res.code}`);
        setShared(LAST_AGENT, choice.key);
        this.close();
      } catch (e) {
        notify({ title: `Sending to ${choice.label} failed`, body: errorText(e), level: "error" });
      } finally {
        this.sending = false;
        cx.notify();
      }
    });
  }

  // ---- render --------------------------------------------------------------------

  render(_cx) {
    const t = theme();
    const p = this.props;
    const choices = this.choices();
    const choice = this.current(choices);
    const where = [p.path, p.run?.number != null ? `#${p.run.number}` : ""].filter(Boolean).join(" ");

    return v_flex().id("send-root").size_full().min_h(0).p(16).gap(12).bg(t.background).text_color(t.foreground).text_size(13)
      .child(v_flex().flex_none().gap(2)
        .child(div().font_semibold().text_size(15).child("Send to agent"))
        .child(div().truncate().text_size(12).text_color(t.dim).child(`${p.job?.name ?? "job"} failed · ${where}`)))
      .child(h_flex().flex_none().gap(10).items_center()
        .child(div().flex_none().w(48).text_size(12).text_color(t.muted).child("Agent"))
        .child(this.agentSelect(t, choices, choice)))
      .child(this.logLoading
        ? div().flex_1().min_h(0).p(10).rounded(8).border_1().border_color(t.border).text_size(12).text_color(t.dim).child("Fetching the job log…")
        : Textarea.new(this.prompt).id("send-prompt").w_full().flex_1().min_h(120).px(10).py(8).rounded(8)
          .border_1().border_color(t.border).bg(t.input).text_size(12).font_family(mono()).text_color(t.foreground))
      .when(Boolean(this.logError), (e) => e.child(div().flex_none().truncate().text_size(11).text_color(t.ansi1)
        .child(`Couldn't fetch the log: ${this.logError}`)))
      .child(h_flex().flex_none().gap(8).items_center()
        .child(div().flex_1())
        .child(button(t, "send-cancel", "Cancel", () => this.close()))
        .child(button(t, "send-go", choice?.kind === "new" ? "Start" : "Send", (cx) => this.send(cx), {
          primary: true, busy: this.sending, disabled: !choice || this.logLoading,
        })));
  }

  agentSelect(t, choices, choice) {
    if (!choices.length) {
      return div().flex_1().text_size(12).text_color(t.dim)
        .child(this.knownLoading ? "Looking for agents…" : "No agents found. Start one in a terminal, or add a `run` entry to programs.json.");
    }
    const trigger = h_flex().id("send-agent-trigger").h(30).flex_1().min_w(0).px(10).gap(6).items_center().rounded(8)
      .border_1().border_color(t.border).text_size(12).cursor_pointer().hover((s) => s.bg(t.hover))
      .child(div().flex_none().text_color(choice.kind === "new" ? t.accent : t.working).child(choice.kind === "new" ? "+" : "●"))
      .child(div().flex_1().min_w(0).truncate().child(choice.label))
      .child(div().flex_none().text_color(t.dim).child("▾"));
    const options = choices.map((c, i) => h_flex().id(`send-agent-${i}`).flex_none().min_h(28).px(8).gap(6).items_center().rounded(6)
      .text_size(12).cursor_pointer().hover((s) => s.bg(t.hover)).when(c.key === choice.key, (e) => e.bg(t.selected))
      .on_click((_e, cx) => { this.selected = c.key; this.menuOpen = false; cx.notify(); })
      .child(div().flex_none().w(10).text_color(c.kind === "new" ? t.accent : t.working).child(c.kind === "new" ? "+" : "●"))
      .child(div().flex_1().min_w(0).truncate().child(c.label)));
    return div().flex_1().min_w(0).child(Popover.new("send-agent")
      .open(this.menuOpen)
      .anchor("top_left")
      .on_open_change((open, cx) => { this.menuOpen = open; cx.notify(); })
      .trigger(trigger)
      .when(this.menuOpen, (el) => el.content(v_flex().id("send-agent-menu").w(WIDTH - 110).max_h(260).overflow_y_scrollbar()
        .p(4).gap(1).rounded(8).border_1().border_color(t.border).bg(t.popover).text_color(t.foreground)
        .children(options))));
  }
}
