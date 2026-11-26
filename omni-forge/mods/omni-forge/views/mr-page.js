// MrPage: one MR's page inside the full view's MR tab (read side): header, description, discussion,
// changed files. `owner` is the FullView (repo, loc, provider, gen, tabs, mrPages, openRun()). Like
// Detail, one object per tab with a stale guard; no cx is stored. Polls every 15 s while its tab shows.
import { div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, TextareaState, Textarea } from "gpui-base";
import { nextDelay } from "../ci/poller.js";
import { ago } from "./runs.js";
import { mrNumber } from "./mrs.js";
import { openMrFile } from "../actions/diff.js";
import { PeoplePicker } from "./people.js";
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

// A thread takes replies when it is resolvable, or is a GitHub comment thread (`c:` ids).
const replyable = (th) => Boolean(th.resolvable) || String(th.id).startsWith("c:");

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
    this.acting = new Set(); // action ids in flight
    this.actionError = null; // { id, label, error } of the last failed action
    this.again = false; // a write finished while a load was out: load once more
    this.editing = false;
    this.people = null; // { kind, picker, onSave, onCancel } while Reviewers / Assignees is open
    this.replyBoxes = new Map(); // thread id -> TextareaState, filled when data arrives
    this.commentBox = TextareaState.new({ placeholder: "Write a comment" });
    this.commentBox.set_auto_grow(2, 8);
    this.commentBox.on("change", (_e, cx) => cx.notify());
    this.editTitle = InputState.new({ placeholder: "Title" });
    this.editBody = TextareaState.new({ placeholder: "Description" });
    this.editBody.set_auto_grow(3, 12);
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
        this.syncReplyBoxes();
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
        if (current && this.again) { this.again = false; this.load(cx); }
      }
    });
  }

  // A reply box per thread that takes replies (created here, never in render); GitHub's `c:` comment
  // threads reply with a new comment.
  syncReplyBoxes() {
    for (const th of this.data?.threads ?? []) {
      if (!replyable(th) || this.replyBoxes.has(th.id)) continue;
      const box = TextareaState.new({ placeholder: "Reply" });
      box.set_auto_grow(1, 6);
      box.on("change", (_e, cx) => cx.notify());
      this.replyBoxes.set(th.id, box);
    }
  }

  // ---- actions -----------------------------------------------------------------

  busy() { return this.acting.size > 0; }

  // Runs a write: every action button of the page disables while one runs; a failure stays on the page
  // (actionError); success reloads the page.
  act(cx, id, label, fn) {
    if (this.busy()) return;
    this.acting.add(id);
    this.actionError = null;
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        await fn();
        if (this.loading) this.again = true; else this.load(cx);
      } catch (e) {
        this.actionError = { id, label, error: e };
      } finally {
        this.acting.delete(id);
        cx.notify();
      }
    });
  }

  dismissActionError(cx) {
    this.actionError = null;
    cx.notify();
  }

  // The detail knows the viewer; the list's `me` is only there once the MRs tab was open.
  get me() { return this.data?.me || this.owner.mrList?.me || ""; }

  // The pipeline pill: the run's tab when there is one, else the MR in the browser.
  openPipeline(mr, cx) {
    if (mr.pipelineRunId) this.owner.openRun({ id: mr.pipelineRunId }, cx);
    else { const url = mrWebUrl(this.repo, this.number, mr); if (url) cx.open_url(url); }
  }

  // The buttons for this MR, in order. Open in browser lives in the top bar.
  actions(mr) {
    const p = this.owner.provider;
    const n = Number(this.number);
    const out = [];
    const add = (id, label, run, opts = {}) => out.push({ id, label, ...opts, onClick: (cx) => run(cx) });
    if (mr.state === "merged") return out;
    if (mr.state === "closed") {
      add("mr-reopen", "Reopen", (cx) => this.act(cx, "mr-reopen", "Reopen", () => p.reopen(n)));
      return out;
    }
    const mine = Boolean(this.me) && (mr.approvedBy ?? []).includes(this.me);
    const own = Boolean(this.me) && mr.author === this.me;
    if (mine) { if (p.capabilities?.mr?.revoke) add("mr-revoke", "Revoke", (cx) => this.act(cx, "mr-revoke", "Revoke", () => p.unapprove(n))); }
    else if (!own) add("mr-approve", "Approve", (cx) => this.act(cx, "mr-approve", "Approve", () => p.approve(n)), { primary: true });
    add("mr-edit", "Edit", (cx) => this.startEdit(cx));
    add("mr-draft", mr.draft ? "Mark as ready" : "Mark as draft", (cx) => this.act(cx, "mr-draft", mr.draft ? "Mark as ready" : "Mark as draft", () => p.setDraft(n, !mr.draft)));
    add("mr-reviewers", "Reviewers…", (cx) => this.openPeople(cx, "reviewers"));
    add("mr-assignees", "Assignees…", (cx) => this.openPeople(cx, "assignees"));
    add("mr-close", "Close", (cx) => this.act(cx, "mr-close", "Close", () => p.close(n)), { danger: true });
    return out;
  }

  submitComment(cx) {
    const body = this.commentBox.value().trim();
    if (!body) return;
    this.act(cx, "mr-comment", "Comment", async () => {
      await this.owner.provider.comment(Number(this.number), body);
      if (this.commentBox.value().trim() === body) this.commentBox.set_value(""); // keep text typed meanwhile
    });
  }

  submitReply(cx, th) {
    const box = this.replyBoxes.get(th.id);
    const body = box?.value().trim();
    if (!body) return;
    this.act(cx, `mr-reply-${th.id}`, "Reply", async () => {
      await this.owner.provider.reply(Number(this.number), th.id, body);
      if (box.value().trim() === body) box.set_value("");
    });
  }

  toggleResolve(cx, th) {
    const resolved = !th.resolved;
    this.act(cx, `mr-resolve-${th.id}`, resolved ? "Resolve" : "Unresolve", () => this.owner.provider.resolve(Number(this.number), th.id, resolved));
  }

  startEdit(cx) {
    if (!this.data || this.editing) return;
    this.editTitle.set_value(this.data.mr.title ?? "");
    this.editBody.set_value(this.data.description ?? "");
    this.editing = true;
    this.clearPeople();
    cx.notify();
  }

  cancelEdit(cx) {
    this.editing = false;
    cx.notify();
  }

  saveEdit(cx) {
    const title = this.editTitle.value().trim();
    if (!title) return;
    const description = this.editBody.value();
    this.act(cx, "mr-edit-save", "Save", async () => {
      await this.owner.provider.update(Number(this.number), { title, description });
      this.editing = false;
    });
  }

  openPeople(cx, kind) {
    if (!this.data) return;
    const p = this.owner.provider;
    const n = Number(this.number);
    const set = kind === "reviewers" ? (list) => p.setReviewers(n, list) : (list) => p.setAssignees(n, list);
    const label = kind === "reviewers" ? "Reviewers" : "Assignees";
    const picker = new PeoplePicker({ initial: this.data.mr[kind] ?? [], search: (q) => p.searchUsers(q), onSave: (list, cx2) => this.savePeople(cx2, label, set, list), onCancel: (cx2) => this.closePeople(cx2), placeholder: `Search ${kind}` });
    this.people?.picker.dispose();
    this.people = { kind, picker, onSave: picker.onSave, onCancel: picker.onCancel };
    this.editing = false;
    cx.notify();
  }

  // Drops the open picker (and its pending search).
  clearPeople() {
    this.people?.picker.dispose();
    this.people = null;
  }

  // The tab closed or the repo changed: nothing of this page may run any more.
  dispose() {
    this.clearPeople();
  }

  closePeople(cx) {
    this.clearPeople();
    cx.notify();
  }

  savePeople(cx, label, set, list) {
    this.act(cx, "mr-people-save", label, async () => {
      await set(list);
      this.clearPeople();
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
        .child(this.actionBar(t, mr))
        .when(Boolean(this.actionError), (e) => e.child(this.actionErrorBox(t)))
        .when(this.editing, (e) => e.child(this.editBox(t)))
        .when(Boolean(this.people), (e) => e.child(this.people.picker.render(t, `mr-${this.people.kind}-picker`, { busy: this.busy() })))
        .when(Boolean(this.error), (e) => e.child(div().px(14).pb(6).text_size(11).text_color(t.ansi1).child(`Update failed: ${errorText(this.error)}`)))
        .child(section(t, "DESCRIPTION", null, t.muted))
        .child(div().px(14).py(4).text_size(13).text_color(description ? t.foreground : t.dim).child(description || "No description."))
        .child(section(t, "DISCUSSION", threads.length, t.muted))
        .children(threads.length ? threads.map((th, i) => this.thread(t, th, i, now)) : [div().px(14).py(4).text_size(12).text_color(t.dim).child("No discussion yet.")])
        .when(Boolean(this.data.olderThreads), (e) => e.child(h_flex().px(14).py(4).gap(6).items_center()
          .child(div().text_size(12).text_color(t.dim).child("Older threads not shown —"))
          .child(button(t, "mr-older-web", "Open in browser", (cx) => cx.open_url(url)))))
        .child(this.commentForm(t))
        .when(Boolean(this.fileError), (e) => e.child(this.fileErrorBox(t, mr, url)))
        .child(section(t, "FILES", files.length, t.muted))
        .children(files.length ? files.map((f, i) => this.fileRow(t, f, i)) : [div().px(14).py(4).text_size(12).text_color(t.dim).child("No changed files.")]));
  }

  actionBar(t, mr) {
    const off = this.busy();
    const buttons = this.actions(mr);
    if (!buttons.length) return div();
    return h_flex().flex_none().px(14).pb(4).gap(8).items_center().flex_wrap()
      .children(buttons.map((a) => button(t, a.id, a.label, a.onClick, { primary: a.primary, danger: a.danger, disabled: off, busy: this.acting.has(a.id) })));
  }

  actionErrorBox(t) {
    const { label, error } = this.actionError;
    return v_flex().id("mr-action-error").flex_none().mx(14).my(4).p(10).gap(8).items_start().rounded(8).bg(t.raised)
      .child(div().text_size(12).text_color(t.ansi1).child(`${label} failed`))
      .child(div().px(8).py(4).rounded(6).text_size(12).font_family(mono()).text_color(t.foreground).child(errorText(error)))
      .child(button(t, "mr-action-error-dismiss", "Dismiss", (cx) => this.dismissActionError(cx)));
  }

  editBox(t) {
    const off = this.busy();
    return v_flex().id("mr-edit-box").flex_none().mx(14).my(4).p(10).gap(8).rounded(8).bg(t.raised)
      .child(h_flex().h(30).px(8).items_center().rounded(6).bg(t.background).border_1().border_color(t.border)
        .child(Input.new(this.editTitle).h_full().flex_1().min_w(0).text_size(13).text_color(t.foreground)))
      .child(v_flex().px(8).py(6).rounded(6).bg(t.background).border_1().border_color(t.border)
        .child(Textarea.new(this.editBody).w_full().text_size(12).text_color(t.foreground)))
      .child(h_flex().gap(8)
        .child(button(t, "mr-edit-save", "Save", (cx) => this.saveEdit(cx), { primary: true, disabled: off, busy: this.acting.has("mr-edit-save") }))
        .child(button(t, "mr-edit-cancel", "Cancel", (cx) => this.cancelEdit(cx))));
  }

  commentForm(t) {
    const off = this.busy();
    return v_flex().id("mr-comment-form").flex_none().mx(14).my(4).gap(6)
      .child(v_flex().px(8).py(6).rounded(6).bg(t.raised).border_1().border_color(t.border)
        .child(Textarea.new(this.commentBox).w_full().text_size(12).text_color(t.foreground)))
      .child(h_flex().child(button(t, "mr-comment-send", "Comment", (cx) => this.submitComment(cx), { disabled: off || !this.commentBox.value().trim(), busy: this.acting.has("mr-comment") })));
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
      ? h_flex().id("mr-pipeline").flex_none().cursor_pointer().on_click((_e, cx) => this.openPipeline(mr, cx)).child(statusPill(t, mr.pipeline))
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
        .child(div().text_size(13).text_color(n.dim ? t.dim : t.foreground).child(n.body))))
      .when(this.replyBoxes.has(th.id), (e) => e.child(this.replyForm(t, th, i)));
  }

  replyForm(t, th, i) {
    const off = this.busy();
    const box = this.replyBoxes.get(th.id);
    return v_flex().id(`mr-reply-form-${i}`).gap(6)
      .child(v_flex().px(8).py(4).rounded(6).bg(t.background).border_1().border_color(t.border)
        .child(Textarea.new(box).w_full().text_size(12).text_color(t.foreground)))
      .child(h_flex().gap(8)
        .child(button(t, `mr-reply-${i}`, "Reply", (cx) => this.submitReply(cx, th), { disabled: off || !box.value().trim(), busy: this.acting.has(`mr-reply-${th.id}`) }))
        .when(Boolean(th.resolvable), (e) => e.child(button(t, `mr-resolve-${i}`, th.resolved ? "Unresolve" : "Resolve", (cx) => this.toggleResolve(cx, th), { disabled: off, busy: this.acting.has(`mr-resolve-${th.id}`) }))));
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
