// New MR: a dialog copy of this mod (props.view "new-mr"), opened from the MR list. The source is
// the space's current branch (read with git on the space's machine), the target is the repo's
// default branch, the title is the last commit's subject. A branch with no upstream gets a "Push
// branch first" button (only on click). Create makes the MR, closes the dialog and opens the MR in
// the space's full tab.
import { div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, TextareaState, Textarea } from "gpui-base";
import {
  theme, props, exec, notify, openOverlay, closeOverlay, checking, setShared, focused, panes, spaces, layout, run as runCommand,
} from "herdr";
import { providerFor } from "../forge/providers.js";
import { spaceFullTabs, sidePanelId, OPEN, MOD, mrKey } from "./locate.js";
import { mrNumber } from "./mrs.js";
import { PeoplePicker } from "./people.js";
import { button, mono } from "./ui.js";

const WIDTH = 520;
const HEIGHT = 560;
const TAB_NAME = "MRs";

const errorText = (e) => [String(e?.message ?? e), e?.hint].filter(Boolean).join("\n");
const firstLine = (s) => String(s ?? "").split("\n")[0].trim();

/** Opens the dialog. `repo` {kind, host, path, url}; `loc` {cwd, machine, ...}. Plain data only. */
export function openNewMrDialog({ repo, loc }) {
  openOverlay({
    kind: "dialog",
    mod: MOD,
    width: WIDTH,
    height: HEIGHT,
    props: {
      view: "new-mr",
      repo: { kind: repo.kind, host: repo.host, path: repo.path, url: repo.url ?? null },
      loc: { cwd: loc?.cwd ?? null, machine: loc?.machine ?? null, branch: loc?.branch ?? null },
    },
  });
}

export class NewMrView {
  init(given, cx) {
    // Read props once: props() in a later callback can answer for another copy.
    this.props = (given && Object.keys(given).length ? given : props()) ?? {};
    const p = this.props;
    this.overlay = p.overlay ?? props()?.overlay;
    this.repo = p.repo;
    this.loc = p.loc ?? {};
    this.provider = providerFor(this.repo);
    this.title = InputState.new({ placeholder: "Title" });
    this.target = InputState.new({ placeholder: "Target branch" });
    this.description = TextareaState.new({ placeholder: "Description" });
    this.title.on("change", (_e, cx) => cx.notify());
    this.target.on("change", (_e, cx) => cx.notify());
    this.draft = false;
    this.reviewers = [];
    this.picker = null;
    this.pickerOpen = false;
    this.branch = null;
    this.detached = false;
    this.upstream = null;
    this.remote = null;
    this.loading = true;
    this.busy = false;
    this.pushing = false;
    this.error = null;
    if (checking()) { this.loading = false; return; }
    this.makePicker();
    this.load(cx);
  }

  makePicker() {
    this.picker?.dispose();
    this.picker = new PeoplePicker({
      initial: this.reviewers,
      search: (q) => this.provider.searchUsers(q),
      onSave: (list, cx) => { this.reviewers = list; this.pickerOpen = false; cx.notify(); },
      onCancel: (cx) => { this.pickerOpen = false; cx.notify(); },
    });
  }

  git(args) {
    return exec("git", args, { cwd: this.loc.cwd ?? undefined, on: this.loc.machine ?? null });
  }

  async readUpstream() {
    try {
      const r = await this.git(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]);
      const up = r.code === 0 ? r.stdout.trim() : "";
      // "<remote>/<branch>": tracking another branch (checkout -b feat origin/main) is not published.
      this.upstream = up && up.slice(up.indexOf("/") + 1) === this.branch ? up : null;
    } catch {
      this.upstream = null;
    }
  }

  load(cx) {
    cx.spawn(async (cx) => {
      try {
        const head = await this.git(["rev-parse", "--abbrev-ref", "HEAD"]);
        const name = head.stdout.trim();
        if (head.code !== 0) {
          throw new Error(head.stderr.trim() || `git rev-parse exited with ${head.code}`);
        } else if (!name || name === "HEAD") {
          this.detached = true;
        } else {
          this.branch = name;
          await this.readUpstream();
        }
        const [subject, remotes, def] = await Promise.all([
          this.git(["log", "-1", "--format=%s"]).catch(() => null),
          this.git(["remote"]).catch(() => null),
          this.provider.defaultBranch().catch(() => ""),
        ]);
        const names = (remotes?.code === 0 ? remotes.stdout : "").split("\n").map((s) => s.trim()).filter(Boolean);
        this.remote = names.includes("origin") ? "origin" : names[0] ?? null;
        // Keep whatever was typed while this was loading.
        if (!this.title.value().trim() && subject?.code === 0) this.title.set_value(firstLine(subject.stdout));
        if (!this.target.value().trim() && def) this.target.set_value(def);
      } catch (e) {
        this.error = errorText(e);
      } finally {
        this.loading = false;
        cx.notify();
      }
    });
  }

  canCreate() {
    return Boolean(this.title.value().trim() && this.target.value().trim() && this.branch && this.upstream && !this.detached && !this.busy && !this.pushing);
  }

  close() {
    this.picker?.dispose();
    if (this.overlay) closeOverlay(this.overlay);
  }

  // Pushes the branch (on the user's click only), then re-reads the upstream.
  push(cx) {
    if (!this.branch || !this.remote || this.pushing || this.busy) return;
    this.pushing = true;
    this.error = null;
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        const r = await this.git(["push", "--set-upstream", "--", this.remote, this.branch]);
        if (r.code !== 0) throw new Error(r.stderr.trim() || `git push exited with ${r.code}`);
        await this.readUpstream();
      } catch (e) {
        this.error = errorText(e);
      } finally {
        this.pushing = false;
        cx.notify();
      }
    });
  }

  create(cx) {
    if (!this.canCreate()) return;
    const reviewers = [...this.reviewers];
    this.busy = true;
    this.error = null;
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        const mr = await this.provider.createMr({
          source: this.branch,
          target: this.target.value().trim(),
          title: this.title.value().trim(),
          description: this.description.value(),
          draft: this.draft,
          reviewers,
        });
        const have = new Set(mr?.reviewers ?? []);
        if (reviewers.some((u) => !have.has(u))) {
          notify({ title: "Created, but reviewers weren't set", body: `${mrNumber(this.repo.kind, mr.number)} was created; add the reviewers on its page.`, level: "warning" });
        }
        this.showFull(mrKey(this.repo, mr.number, this.loc));
        this.close();
      } catch (e) {
        this.error = errorText(e);
      } finally {
        this.busy = false;
        cx.notify();
      }
    });
  }

  // Same hand-off as the MRs side view: the space's full tab, or a new one.
  showFull(key) {
    const f = focused();
    const tabs = spaceFullTabs(panes(), spaces(), f?.space);
    const tab = tabs.includes(f?.tab) ? f.tab : tabs[0];
    if (tab) {
      setShared(OPEN, { tab, key });
      runCommand("tab.select", { id: tab });
    } else {
      runCommand("tab.new", { name: TAB_NAME, mod: MOD, props: { view: "full", open: key } });
    }
    const panel = sidePanelId(layout(), "mrs");
    if (panel) runCommand("layout.hide", { id: panel });
  }

  // ---- render --------------------------------------------------------------------

  field(t, label, child) {
    return h_flex().flex_none().gap(10).items_center()
      .child(div().flex_none().w(72).text_size(12).text_color(t.muted).child(label))
      .child(child);
  }

  box(t, input) {
    return h_flex().h(30).flex_1().min_w(0).px(8).items_center().rounded(6).bg(t.input).border_1().border_color(t.border)
      .child(Input.new(input).h_full().flex_1().min_w(0).text_size(12).text_color(t.foreground));
  }

  render(_cx) {
    const t = theme();
    const noUpstream = this.branch && !this.upstream && !this.loading;
    const source = this.loading ? "Reading the branch…" : this.detached ? "Detached HEAD" : this.branch ?? "";
    return v_flex().id("new-mr-root").size_full().min_h(0).p(16).gap(10).bg(t.background).text_color(t.foreground).text_size(13)
      .child(v_flex().flex_none().gap(2)
        .child(div().font_semibold().text_size(15).child("New merge request"))
        .child(div().truncate().text_size(12).text_color(t.dim).child(this.repo?.path ?? "")))
      .child(this.field(t, "Source", div().flex_1().min_w(0).truncate().text_size(12).font_family(mono()).child(source)))
      .when(this.detached, (e) => e.child(div().flex_none().text_size(12).text_color(t.ansi1).child("HEAD is detached. Check out a branch to open an MR.")))
      .child(this.field(t, "Target", this.box(t, this.target)))
      .child(this.field(t, "Title", this.box(t, this.title)))
      .child(Textarea.new(this.description).id("new-mr-description").w_full().flex_1().min_h(90).px(10).py(8).rounded(8)
        .border_1().border_color(t.border).bg(t.input).text_size(12).text_color(t.foreground))
      .child(h_flex().flex_none().gap(12).items_center()
        .child(h_flex().id("new-mr-draft").gap(6).items_center().cursor_pointer().text_size(12)
          .on_click((_e, cx) => { this.draft = !this.draft; cx.notify(); })
          .child(div().text_color(this.draft ? t.accent : t.muted).child(this.draft ? "☑" : "☐"))
          .child("Draft"))
        .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(t.dim)
          .child(this.reviewers.length ? `Reviewers: ${this.reviewers.join(", ")}` : "No reviewers"))
        .child(button(t, "new-mr-reviewers", this.pickerOpen ? "Hide" : "Reviewers", (cx) => {
          if (!this.pickerOpen) this.makePicker();
          this.pickerOpen = !this.pickerOpen;
          cx.notify();
        })))
      .when(this.pickerOpen && Boolean(this.picker), (e) => e.child(this.picker.render(t, "new-mr-people")))
      .when(Boolean(noUpstream), (e) => e.child(h_flex().flex_none().gap(8).items_center()
        .child(div().flex_1().min_w(0).text_size(12).text_color(t.blocked).child("This branch isn't pushed yet."))
        .child(button(t, "new-mr-push", "Push branch first", (cx) => this.push(cx), { busy: this.pushing, disabled: !this.remote }))))
      .when(Boolean(this.error), (e) => e.child(div().flex_none().max_h(80).overflow_y_scroll().text_size(11).text_color(t.ansi1).child(this.error)))
      .child(h_flex().flex_none().gap(8).items_center()
        .child(div().flex_1())
        .child(button(t, "new-mr-cancel", "Cancel", () => this.close()))
        .child(button(t, "new-mr-create", "Create", (cx) => this.create(cx), { primary: true, busy: this.busy, disabled: !this.canCreate() })));
  }
}
