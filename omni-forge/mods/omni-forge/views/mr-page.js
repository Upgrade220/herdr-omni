// MrPage: one MR's page inside the full view's MR tab (read side): header, description, discussion,
// changed files. `owner` is the FullView (repo, loc, provider, gen, tabs, mrPages, openRun()). Like
// Detail, one object per tab with a stale guard; no cx is stored. Polls every 15 s while its tab shows.
import { div, svg, uniform_list } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, TextareaState, Textarea, TextView } from "gpui-base";
import { nextDelay } from "../ci/poller.js";
import { ago } from "./runs.js";
import { mrNumber } from "./mrs.js";
import { openMrFile } from "../actions/diff.js";
import { PeoplePicker } from "./people.js";
import { languageOf, tokenizeLine } from "../code/syntax.js";
import { codeColorsFrom } from "../code/theme-code.js";
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

// Markdown of a description or comment, ready for TextView: links into the forge ("/uploads/…" is
// the project's, any other "/…" the host's) become absolute, and images become links to them (the
// forge serves them only to a logged-in browser).
export function noteMarkdown(body, repo) {
  const host = repo?.host ? `https://${repo.host}` : "";
  const abs = (href) => (!href.startsWith("/") || !host ? href : href.startsWith("/uploads/") && repo.path ? `${host}/${repo.path}${href}` : `${host}${href}`);
  return String(body ?? "")
    .replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (_m, alt, src) => `[🖼 ${alt || "image"}](${abs(src)})`)
    .replace(/\]\((\/[^)\s]*)/g, (_m, href) => `](${abs(href)}`);
}

const stripTags = (html) => String(html).replace(/<[^>]*>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();

// A system note ("added 2 commits", "approved this merge request") as an event: its first line and,
// for commits, "<sha> <subject>" of each (GitLab lists them as HTML). Null for a person's comment.
export function systemEvent(note) {
  if (!note?.system) return null;
  const body = String(note.body ?? "");
  const text = body.split("\n").find((l) => l.trim())?.trim() ?? "";
  const commits = [...body.matchAll(/<li>([\s\S]*?)<\/li>/g)].map((m) => stripTags(m[1]).replace(/^(\w+)\s+-\s+/, "$1 "));
  return { text, commits };
}

// What a thread's head says: its file:line, "Thread" when it has replies, "Comment" for a lone one;
// null for a thread of system notes only, which is drawn as an event line, not a card.
export function threadLabel(th) {
  const notes = th?.notes ?? [];
  if (notes.length && notes.every((n) => n.system)) return null;
  if (th.path) return th.line != null ? `${th.path}:${th.line}` : th.path;
  return notes.length > 1 ? "Thread" : "Comment";
}

export const SNIPPET_LINES = 4;
const CODE_ROW_H = 20;

// The last `n` rows of a diff hunk (GitHub's diffHunk ends at the commented line): { no, mark, text },
// `no` being the line's number on its own side.
export function snippetFromHunk(hunk, n = SNIPPET_LINES) {
  const lines = String(hunk ?? "").split("\n");
  const head = /^@@ -(\d+)(?:,\d+)? \+(\d+)/.exec(lines[0] ?? "");
  if (!head) return [];
  let oldNo = Number(head[1]);
  let newNo = Number(head[2]);
  const rows = [];
  for (const l of lines.slice(1)) {
    if (l.startsWith("\\")) continue; // "\ No newline at end of file"
    const mark = l[0] === "+" || l[0] === "-" ? l[0] : " ";
    const text = l.slice(1);
    if (mark === "-") rows.push({ no: oldNo++, mark, text });
    else if (mark === "+") rows.push({ no: newNo++, mark, text });
    else { rows.push({ no: newNo, mark, text }); oldNo++; newNo++; }
  }
  return rows.slice(-n);
}

// The `n` lines of a file ending at `line` (1-based); the commented line carries `mark`.
export function snippetFromFile(text, line, mark = " ", n = SNIPPET_LINES) {
  const lines = Array.isArray(text) ? text : String(text ?? "").split("\n");
  if (!(line >= 1) || line > lines.length) return [];
  const rows = [];
  for (let no = Math.max(1, line - n + 1); no <= line; no++) rows.push({ no, mark: no === line ? mark : " ", text: lines[no - 1] });
  return rows;
}

// How far above a snippet its file is read for what is still open there (a block comment, a string).
const LEAD_LINES = 80;

// Rows with their syntax runs. `lead` is the file's lines before the first row (open comments carry
// in); a hunk's removed rows carry their own state, as the Diff tab does. A failure leaves rows plain.
export function withRuns(rows, path, lead = []) {
  const language = languageOf(path);
  try {
    let before = null;
    for (const line of lead) before = tokenizeLine(line, language, before).state;
    let after = before;
    return rows.map((r) => {
      const res = tokenizeLine(r.text ?? "", language, r.mark === "-" ? before : after);
      if (r.mark === "-") before = res.state;
      else if (r.mark === "+") after = res.state;
      else before = after = res.state;
      return { ...r, runs: res.runs };
    });
  } catch {
    return rows.map((r) => ({ ...r, runs: [{ text: r.text ?? "", kind: null }] }));
  }
}

// The key of a thread's code rows, or null for a thread without code.
const snippetKey = (th) => (th.hunk ? `${th.path}\0${th.hunk}` : th.at ? `${th.at.sha}\0${th.at.path}\0${th.at.line}\0${th.at.mark}` : null);

// The theme colours people are told apart by (no greys: black, white and their bright pairs).
export const PERSON_COLORS = ["ansi1", "ansi2", "ansi3", "ansi4", "ansi5", "ansi6", "ansi9", "ansi10", "ansi11", "ansi12", "ansi13", "ansi14"];

// A person's colour: the same name always gets the same one (FNV-1a hash of the name).
export function personColor(name, t) {
  let h = 0x811c9dc5;
  for (const ch of String(name ?? "")) h = Math.imul(h ^ ch.codePointAt(0), 0x01000193) >>> 0;
  return t[PERSON_COLORS[h % PERSON_COLORS.length]];
}

// A colour with another alpha ("#rrggbb" or "#rrggbbaa" in, "#rrggbb<alpha>" out).
export const tint = (color, alpha) => `${String(color).slice(0, 7)}${alpha}`;

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
    this.files = new Map(); // "<sha>\0<path>" -> { lines } | { error } | { loading: true }: GitLab line comments' code
    this.snippetRows = new Map(); // "<sha>\0<path>\0<line>\0<mark>" or the hunk -> rows, worked out once (render stays cheap)
    this.filesOpen = true; // the FILES list at the bottom
    this.flipped = new Set(); // thread ids folded or unfolded against their default
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
        this.prepareSnippets();
        this.loadSnippets(cx);
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

  // Resolved threads start folded to their first line, open ones unfolded; a click on the thread's
  // head flips it.
  folded(th) { return Boolean(th.resolved) !== this.flipped.has(th.id); }

  toggleFold(cx, th) {
    if (this.flipped.has(th.id)) this.flipped.delete(th.id); else this.flipped.add(th.id);
    this.loadSnippets(cx);
    cx.notify();
  }

  toggleFiles(cx) {
    this.filesOpen = !this.filesOpen;
    cx.notify();
  }

  // The code a line thread points at: { rows } | { loading } | { error }, or null (no code, or a
  // GitLab file not read yet). GitHub threads carry their hunk; GitLab ones read the file at its commit.
  snippet(th) {
    const key = snippetKey(th);
    if (!key) return null;
    const ready = this.snippetRows.get(key);
    if (ready) return { rows: ready };
    if (th.hunk) return null;
    const f = this.files.get(`${th.at.sha}\0${th.at.path}`);
    if (!f) return null;
    if (f.error) return { error: f.error };
    return { loading: true };
  }

  // Works out the rows (with syntax runs) of every thread whose code is in hand: never in render,
  // which reads them ready (highlighting is slow there and Herdr cuts a slow render off).
  prepareSnippets() {
    for (const th of this.data?.threads ?? []) {
      const key = snippetKey(th);
      if (!key || this.snippetRows.has(key)) continue;
      if (th.hunk) { this.snippetRows.set(key, withRuns(snippetFromHunk(th.hunk), th.path)); continue; }
      const f = this.files.get(`${th.at.sha}\0${th.at.path}`);
      if (!f?.lines) continue;
      const rows = snippetFromFile(f.lines, th.at.line, th.at.mark);
      const first = rows[0]?.no ?? 1;
      this.snippetRows.set(key, withRuns(rows, th.at.path, f.lines.slice(Math.max(0, first - 1 - LEAD_LINES), first - 1)));
    }
  }

  // Reads, one after another, the files of unfolded GitLab line threads not read yet (each commit and
  // path once; a commit never changes, so nothing is read twice).
  loadSnippets(cx) {
    const want = [];
    for (const th of discussion(this.data?.threads)) {
      const at = th.at;
      if (!at || th.hunk || this.folded(th)) continue;
      const key = `${at.sha}\0${at.path}`;
      if (this.files.has(key)) continue;
      this.files.set(key, { loading: true });
      want.push({ key, at });
    }
    const p = this.owner.provider;
    if (!want.length || !p?.fileAt) { for (const w of want) this.files.delete(w.key); return; }
    cx.spawn(async (cx) => {
      for (const { key, at } of want) {
        try { this.files.set(key, { lines: String(await p.fileAt(at.sha, at.path) ?? "").split("\n") }); this.prepareSnippets(); }
        catch (e) { this.files.set(key, { error: errorText(e) }); }
        cx.notify();
      }
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
      .child(button(t, "mr-back", "‹ PRs", (cx) => this.owner.selectTab("mrs", cx)))
      .child(div().flex_1())
      .when(Boolean(url), (e) => e.child(button(t, "mr-web", "Open in browser", (cx) => cx.open_url(url))));
  }

  render(t) {
    const url = mrWebUrl(this.repo, this.number, this.data?.mr);
    const top = this.topBar(t, url);
    if (!this.data) {
      const body = this.error
        ? v_flex().flex_1().min_h(0).p(16).gap(10).items_start()
          .child(div().text_color(t.ansi1).child("Cannot load this PR"))
          .child(div().px(8).py(4).rounded(6).bg(t.raised).text_size(12).font_family(mono()).text_color(t.foreground).child(errorText(this.error)))
          .child(h_flex().gap(8)
            .child(button(t, "mr-retry", "Try again", (cx) => this.load(cx)))
            .child(button(t, "mr-web-error", "Open in browser", (cx) => cx.open_url(url))))
        : busyState(t, "Loading PR…");
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
        .child(div().px(14).py(4).child(description ? this.markdown(t, "mr-description", description) : div().text_size(13).text_color(t.dim).child("No description.")))
        .child(section(t, "DISCUSSION", threads.length, t.muted))
        .children(threads.length ? threads.map((th, i) => this.thread(t, th, i, now)) : [div().px(14).py(4).text_size(12).text_color(t.dim).child("No discussion yet.")])
        .when(Boolean(this.data.olderThreads), (e) => e.child(h_flex().px(14).py(4).gap(6).items_center()
          .child(div().text_size(12).text_color(t.dim).child("Older threads not shown —"))
          .child(button(t, "mr-older-web", "Open in browser", (cx) => cx.open_url(url)))))
        .child(this.commentForm(t))
        .when(Boolean(this.fileError), (e) => e.child(this.fileErrorBox(t, mr, url)))
        .child(div().id("mr-files-toggle").cursor_pointer().on_click((_e, cx) => this.toggleFiles(cx))
          .child(section(t, `${this.filesOpen ? "▾" : "▸"} FILES`, files.length, t.muted)))
        .when(this.filesOpen, (e) => e.children(files.length ? files.map((f, i) => this.fileRow(t, f, i)) : [div().px(14).py(4).text_size(12).text_color(t.dim).child("No changed files.")])));
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

  // Markdown of a description or comment.
  markdown(t, id, body, color) {
    return div().w_full().min_w(0).text_size(13).text_color(color ?? t.foreground)
      .child(TextView.markdown(id, noteMarkdown(body, this.repo)).selectable(true).w_full());
  }

  // A person's comment: a header (initial, name, age) set apart from the text, which sits indented
  // under the name. A system note inside a thread is an event line.
  note(t, n, id, now) {
    if (n.system) return this.event(t, n, id, now, 0);
    const initial = String(n.author || "?").slice(0, 1).toUpperCase();
    const hue = personColor(n.author, t);
    return v_flex().id(id).gap(4).min_w(0)
      .child(h_flex().gap(8).items_center()
        .child(div().flex_none().size(18).rounded_full().bg(tint(hue, "33")).items_center().justify_center().flex()
          .text_size(10).font_semibold().text_color(hue).child(initial))
        .child(div().text_size(12).font_semibold().text_color(t.accent).child(n.author || "?"))
        .child(div().text_size(11).text_color(t.dim).child(ago(n.createdAt, now))))
      .child(div().pl(26).child(this.markdown(t, `${id}-body`, n.body, t.foreground)));
  }

  // "● author added 2 commits · 2h", the commits under it in small mono. No card, no reply box.
  event(t, n, id, now, mx = 14) {
    const ev = systemEvent(n);
    return v_flex().id(id).flex_none().mx(mx).my(2).gap(2).min_w(0)
      .child(h_flex().gap(6).items_center().min_w(0)
        .child(div().flex_none().size(6).rounded_full().bg(t.dim))
        .child(div().min_w(0).truncate().text_size(12).text_color(t.dim)
          .child([`${n.author ?? ""} ${ev?.text ?? ""}`.trim(), ago(n.createdAt, now)].filter(Boolean).join(" · "))))
      .children((ev?.commits ?? []).map((c, k) => div().id(`${id}-c${k}`).pl(12).min_w(0).truncate().text_size(11).font_family(mono()).text_color(t.dim).child(c)));
  }

  // One thread, one card: its head (file:line or "Comment", resolved, fold arrow), the first comment,
  // the replies indented under a line, the reply box. A folded thread shows its head and first line.
  // A thread of system notes only is a line of events instead.
  thread(t, th, i, now) {
    const where = threadLabel(th);
    if (where == null) return v_flex().id(`mr-thread-${i}`).flex_none().children(th.notes.map((n, j) => this.event(t, n, `mr-note-${i}-${j}`, now)));
    const folded = this.folded(th);
    const [root, ...replies] = th.notes;
    const head = h_flex().id(`mr-thread-head-${i}`).gap(8).items_center().cursor_pointer()
      .on_click((_e, cx) => this.toggleFold(cx, th))
      .child(div().flex_none().w(10).text_size(11).text_color(t.dim).child(folded ? "▸" : "▾"))
      .when(Boolean(th.path), (e) => e.child(div().id(`mr-thread-link-${i}`).min_w(0).truncate().text_size(12).font_family(mono()).text_color(t.accent).cursor_pointer()
        .on_click((_e, cx) => { cx.stop_propagation(); this.openFile(cx, th.path); })
        .child(where)))
      .when(!th.path, (e) => e.child(div().min_w(0).truncate().text_size(12).text_color(t.dim).child(where)))
      .child(div().flex_1())
      .when(replies.length > 0, (e) => e.child(div().flex_none().text_size(11).text_color(t.dim).child(`${replies.length} ${replies.length === 1 ? "reply" : "replies"}`)))
      .when(Boolean(th.resolved), (e) => e.child(pill(t, { label: "resolved", glyph: "✓", color: t.ansi2 })));
    const card = v_flex().id(`mr-thread-${i}`).flex_none().mx(14).my(4).px(10).py(8).gap(10).rounded(8).bg(t.raised).border_1().border_color(t.border).child(head);
    if (folded) {
      const first = String(root?.body ?? "").split("\n").find((l) => l.trim()) ?? "";
      return card.child(div().min_w(0).truncate().text_size(12).text_color(t.dim).child(`${root?.author ?? ""}: ${first}`));
    }
    const code = this.snippet(th);
    return card
      .when(Boolean(code), (e) => e.child(this.codeBox(t, code, i)))
      .when(Boolean(root), (e) => e.child(this.note(t, root, `mr-note-${i}-0`, now)))
      .when(replies.length > 0, (e) => e.child(v_flex().ml(8).pl(12).gap(12).border_l_2().border_color(t.border)
        .children(replies.map((n, j) => this.note(t, n, `mr-note-${i}-${j + 1}`, now)))))
      .when(this.replyBoxes.has(th.id), (e) => e.child(this.replyForm(t, th, i)));
  }

  // The lines a comment is on, like the forges show them: line numbers, +/− marks, the commented line
  // (the last) highlighted. While the file is read, or when it can't be, one line says so.
  codeBox(t, code, i) {
    const frame = v_flex().id(`mr-code-${i}`).flex_none().py(4).rounded(6).bg(t.background).border_1().border_color(t.border);
    if (code.loading) return frame.child(div().px(10).text_size(11).text_color(t.dim).child("Loading code…"));
    if (code.error) return frame.child(div().px(10).min_w(0).truncate().text_size(11).text_color(t.dim).child(`Code not shown: ${code.error.split("\n")[0]}`));
    if (!code.rows.length) return frame.child(div().px(10).text_size(11).text_color(t.dim).child("This line is no longer in the file."));
    const last = code.rows.length - 1;
    const colors = codeColorsFrom(t, this.owner.themeCode);
    // Rows are built in a uniform_list: Herdr calls it from layout, only while the box is on screen,
    // so a page of many line comments keeps its own render small (a word per element adds up).
    const rows = code.rows;
    return frame.child(uniform_list(`mr-code-${i}-${this.number}`, rows.length, (k) => String(k), (range) => {
      const out = [];
      for (let k = range.start; k < range.end; k++) out.push(this.codeRow(t, rows[k], k === last, colors));
      return out;
    }).h(rows.length * CODE_ROW_H));
  }

  codeRow(t, r, current, colors) {
    const color = r.mark === "+" ? t.ansi2 : r.mark === "-" ? t.ansi1 : t.dim;
    return h_flex().w_full().h(CODE_ROW_H).min_w(0).px(6).gap(8).items_center().text_size(12).font_family(mono())
        .when(current, (e) => e.bg(t.hover))
        .child(div().flex_none().w(36).text_color(t.dim).child(String(r.no)))
        .child(div().flex_none().w(10).text_color(color).child(r.mark === " " ? "" : r.mark === "-" ? "−" : "+"))
        .child(h_flex().flex_1().min_w(0).overflow_hidden()
          .children((r.runs ?? [{ text: r.text, kind: null }]).map((run) => div().flex_none().whitespace_nowrap().text_color(colors[run.kind] ?? t.foreground).child(run.text.replace(/\t/g, "    ") || " "))));
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
