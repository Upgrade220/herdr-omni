// omni-restore: remembers which Claude Code session runs in each Herdr terminal, and after a reboot
// (or logout, or a core crash) types `claude --resume <id>` into the shell that replaced it.
// Lives as a small label in the status bar; the work runs on a timer, never in render.
import { View, div } from "gpui-kit";
import { h_flex } from "gpui-base";
import { hc, home, appHome, checking, readTextFile, writeTextFile, terminals, exec, theme } from "herdr";
import { isClaude, looksClaude, step, markResumed, parseRecords, recordsText } from "./restore.js";

const EVERY_MS = 10000;

export default class OmniRestore extends View {
  init(_props, cx) {
    this.records = {};
    this.fileText = null;
    this.loaded = false;
    this.busy = false;
    this.resumed = [];
    this.error = null;
    if (checking()) return;
    cx.spawn(async (cx) => {
      await this.load();
      this.tick(cx);
    });
    cx.timer.every(EVERY_MS, (cx) => this.tick(cx));
  }

  get dir() { return `${appHome()}/data/omni-restore`; }
  get file() { return `${this.dir}/sessions.json`; }

  async load() {
    try {
      await exec("mkdir", ["-p", this.dir]);
      this.fileText = await readTextFile(this.file);
      this.records = parseRecords(this.fileText);
      this.loaded = true;
    } catch (e) {
      this.error = `can't read ${this.file}: ${e?.message ?? e}`;
    }
  }

  tick(cx) {
    if (!this.loaded || this.busy) return;
    this.busy = true;
    cx.spawn(async (cx) => {
      try {
        await this.look();
        this.error = null;
      } catch (e) {
        this.error = String(e?.message ?? e);
      } finally {
        this.busy = false;
      }
      cx.notify();
    });
  }

  async look() {
    // Local terminals only: a remote one's session file lives on its machine.
    const addresses = new Set(Object.keys(this.records));
    for (const t of terminals()) if (looksClaude(t) && t.state !== "finished" && !String(t.address).includes("/")) addresses.add(t.address);
    const seen = new Map();
    for (const address of addresses) seen.set(address, await this.ask(address));
    const { records, resume } = step(this.records, seen, Date.now());
    let next = records;
    for (const r of resume) {
      const sent = await hc(["send", r.address, r.line]).catch(() => null);
      if (sent && sent.code === 0) {
        next = markResumed(next, r.address, r.pid);
        this.resumed = [...this.resumed, { address: r.address, at: Date.now() }].slice(-20);
      }
    }
    await this.save(next);
  }

  // { t, sessionId }: t null when the core says there's no such terminal, undefined when it
  // couldn't be asked (keep the record then).
  async ask(address) {
    const r = await hc(["get", address, "--json"]).catch(() => null);
    let t;
    try {
      t = JSON.parse(r?.stdout ?? "");
    } catch {
      return { t: undefined, sessionId: null };
    }
    if (t?.error) return { t: t.error.kind === "not_found" ? null : undefined, sessionId: null };
    let sessionId = null;
    if (isClaude(t.foreground) && t.foreground.pid) {
      const text = await readTextFile(`${home()}/.claude/sessions/${t.foreground.pid}.json`).catch(() => null);
      try {
        sessionId = JSON.parse(text ?? "null")?.sessionId ?? null;
      } catch {}
    }
    return { t, sessionId };
  }

  async save(records) {
    const text = recordsText(records);
    if (text === (this.fileText ?? recordsText({}))) {
      this.records = records;
      return;
    }
    try {
      await writeTextFile(this.file, text, this.fileText);
      this.fileText = text;
      this.records = records;
    } catch {
      // Changed under us (another window?): take the file as it is now; the next look merges.
      this.fileText = await readTextFile(this.file);
      this.records = parseRecords(this.fileText);
    }
  }

  render() {
    const t = theme();
    const n = Object.keys(this.records).length;
    const last = this.resumed.at(-1);
    const tip = this.error
      ? `omni-restore: ${this.error}`
      : `omni-restore: ${n} Claude session${n === 1 ? "" : "s"} remembered. After a reboot each comes back with --resume in its tab.` +
        (last ? ` Last resumed: ${last.address}.` : "");
    return h_flex().id("omni-restore").size_full().px(10).gap(5).items_center().justify_end()
      .bg(t.chrome).border_t(1).border_color(t.border).text_size(11.8)
      .text_color(this.error ? t.ansi1 ?? t.muted : t.muted)
      .tooltip(tip)
      .child(div().child("↻"))
      .child(div().child(String(n)));
  }
}
