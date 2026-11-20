// Reading the folder tree, and Git's view of it, for the focused pane's folder.
import { spaces, panes, focused, exec, watchFolder, window, setShared, shared } from "herdr";
import { PER_FOLDER, markKey, parseStatus, sortEntries } from "./model.js";
import { NUMSTAT, BRANCH, IGNORED, parseNumstat, folderCounts, parseBranch, summaryOf, parseIgnored, isIgnored, rebase } from "./git-extras.js";
import { record, relativeIn, KINDS, kindsOf, dropFolders } from "./recent.js";
import { pickListing } from "./shell.js";
import { indexOf } from "./filter.js";

const INDEX_BYTES = 4000000;
const INDEX_DEPTH = 12;
// A home folder or /, which hold far more than a project, are searched less deep.
const SHALLOW_DEPTH = 5;
const SHALLOW_ROOT = /^\/(?:(?:home|Users)\/[^/]+|root)?$/;
const REINDEX_MS = 30000;
// A folder that keeps changing, such as one an agent is writing in, is read again at most this often.
const RESTALE_MS = 5000;
// Off by the header's branch button: then Git is not asked anything for the tree.
export const gitOn = () => shared("better-files.git") !== false;
const RECENT_CHECK_MS = 5000;
const SKIPPED = [".git", "node_modules", ".venv", "__pycache__", "target", "dist", ".next"];

// Every file under the folder, for the filter: Git's own list where there is one, so ignored
// files stay out, else find without the folders that are usually huge, cut at a size. A folder
// Git ignores, such as node_modules, gets an empty list from Git, so find reads it instead.
// With Git off (useGit false) the list is find's alone, ignored files included.
async function everyFile(root, on, useGit = true) {
  if (!useGit) return findEvery(root, on);
  const lsFiles = (...flags) =>
    exec("git", ["--no-optional-locks", "-c", "core.fsmonitor=false", "-c", "core.quotepath=off", "ls-files", "-z", ...flags], { cwd: root, on }).catch(
      () => null,
    );
  // Git still lists a tracked file that was deleted but not staged, so those come out.
  const [git, gone] = await Promise.all([lsFiles("--cached", "--others", "--exclude-standard"), lsFiles("--deleted")]);
  if (git?.code === 0 && git.stdout) {
    if (gone?.code !== 0 || !gone.stdout) return git.stdout;
    const deleted = new Set(gone.stdout.split("\0"));
    return git.stdout
      .split("\0")
      .filter((path) => !deleted.has(path))
      .join("\0");
  }
  return findEvery(root, on);
}

async function findEvery(root, on) {
  const depth = SHALLOW_ROOT.test(root.replace(/\/+$/, "") || "/") ? SHALLOW_DEPTH : INDEX_DEPTH;
  const prune = SKIPPED.map((name) => `-name '${name}'`).join(" -o ");
  const script = `find . -mindepth 1 -maxdepth "$1" \\( ${prune} \\) -prune -o ! -type d -print0 | head -c "$2"`;
  const found = await exec("sh", ["-c", script, "index", String(depth), String(INDEX_BYTES)], { cwd: root, on });
  if (found.code !== 0) throw new Error(found.stderr || "Cannot list this folder.");
  return found.stdout;
}

// Each read of a folder is bounded, and the names come back null-separated, so no file name
// can break the list. Adapted from Herdr's shipped Files mod; platform branching (sh vs
// PowerShell 5.1) lives in shell.js. Herdr only says what this computer runs, so another
// machine's folder is read with `sh`, as before.
async function directory(path, on) {
  const platform = on ? null : window()?.platform;
  const { program, args } = pickListing(path, PER_FOLDER, platform);
  const r = await exec(program, args, { on });
  if (r.code !== 0) throw new Error(r.stderr || "Cannot list this folder.");
  const fields = r.stdout.split("\0");
  const out = [];
  for (let i = 0; i + 1 < fields.length; i += 2)
    out.push({ name: fields[i + 1], dir: fields[i] === "d" });
  return out;
}

// Where a space is now: a terminal's folder in its shown tab, else in its other tabs. The
// space's own folder is where it was made, which its terminals may have long left.
function liveFolder(space) {
  const tabs = space?.tabs ?? [];
  const order = [...tabs.filter((t) => t.active), ...tabs.filter((t) => !t.active)].map((t) => t.id);
  const all = panes();
  for (const tab of order) {
    const pane = all.find((p) => p.tab === tab && p.cwd);
    if (pane) return pane.cwd;
  }
  return null;
}

export const readMethods = {
  // The focused pane's folder. A file or diff tab has no folder of its own, so looking at
  // one keeps the tree where it was instead of jumping back to the space's.
  location() {
    const space = spaces().find((s) => s.active);
    const f = focused();
    const pane = f?.pane ? panes().find((p) => p.pane === f.pane) : null;
    const on =
      f?.pane === null
        ? f.terminal?.includes("/")
          ? f.terminal.split("/")[0]
          : null
        : (space?.machine ?? null);
    // A file or diff tab carries no cwd of its own: only a terminal pane (a pane entry
    // with no mod) contributes one, or the focused entry's cwd when it names a terminal.
    // `f?.terminal` is null for mod panes even while their `mod` is still attaching,
    // so it keeps a just-opened viewer from leaking the pane's default cwd.
    const cwd =
      pane && !pane.mod && f?.terminal
        ? (pane.cwd || f?.cwd || null)
        : !pane && f?.terminal
          ? (f?.cwd ?? null)
          : null;
    if (!cwd && this.place?.space === space?.id && this.place?.cwd) return this.place;
    return (this.place = { cwd: cwd || liveFolder(space) || space?.folder, on, space: space?.id });
  },

  placeKey() {
    return JSON.stringify(this.location());
  },

  // A folder's own state is kept, so coming back to it is where you left it.
  refresh(cx) {
    const { cwd, on } = this.location();
    const key = this.placeKey();
    if (key !== this.key) {
      if (this.key) this.saved.set(this.key, { folders: this.folders });
      const kept = this.saved.get(key);
      this.key = key;
      this.root = cwd;
      this.on = on;
      this.entries = new Map();
      this.folders = kept?.folders ?? new Set();
      this.marks = {};
      this.gitInfo = null;
      this.ignoredSet = null;
      this.recentKinds = null;
      this.top = null;
      this.treeError = null;
      this.indexError = null;
      this.scrollTo = null;
      this.cursor = null;
      this.watch(cx);
    }
    this.ensureIndex(cx);
    if (!cwd || this.loading === key) return;
    const token = key;
    this.loading = key;
    // A run starting now sees every change asked for so far.
    this.refreshAgain = false;
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        for (const path of ["", ...this.folders]) {
          if (this.key !== token) return;
          await this.loadFolder(path, cwd, on, token);
        }
        await this.loadMarks(cwd, on, token);
        if (this.key === token) this.treeError = null;
        if (this.tab === "recent") await this.checkRecent(cwd, on, token);
      } catch (e) {
        if (this.key === token) this.treeError = e.message ?? String(e);
      } finally {
        if (this.loading === token) this.loading = null;
        cx.notify();
        // Asked again while this run was going (the Git switch): one more run, now.
        if (this.refreshAgain && this.key === token) this.refresh(cx);
      }
    });
  },

  async loadFolder(path, root, on, token) {
    const list = await directory(path ? `${root}/${path}` : root, on);
    if (this.key !== token) return;
    this.entries.set(path, sortEntries(list));
  },

  // Writes nothing under .git, or the folder watch would see its own read and refresh again.
  async loadMarks(root, on, token) {
    if (!gitOn()) {
      this.marks = {};
      this.gitInfo = null;
      return;
    }
    const top = await exec("git", ["rev-parse", "--show-toplevel"], { cwd: root, on }).catch(
      () => null,
    );
    if (this.key !== token) return;
    if (top?.code !== 0) {
      this.top = null;
      this.marks = {};
      this.gitInfo = null;
      return;
    }
    const status = await exec(
      "git",
      [
        "--no-optional-locks",
        "-c",
        "core.fsmonitor=false",
        "status",
        "--porcelain=v1",
        "-z",
        "--no-renames",
        "--untracked-files=all",
      ],
      { cwd: root, on },
    ).catch(() => null);
    if (this.key !== token) return;
    // Git's spelling of the top (forward slashes, its own drive-letter case on Windows) is
    // kept; marks are compared through markKey, so it needn't match the root's.
    this.top = top.stdout.trim();
    if (status?.code === 0) this.marks = parseStatus(status.stdout, this.top);
    await this.loadGitExtras(root, on, token);
  },

  // The filetree-style extras: +N -N per file, changed counts per folder, the branch line,
  // and what Git ignores (listed from the shown folder, so relative to it, like the tree).
  async loadGitExtras(root, on, token) {
    const git = (args) => exec("git", ["-c", "core.fsmonitor=false", "-c", "core.quotepath=off", ...args], { cwd: root, on }).catch(() => null);
    const [head, branch, ignored] = await Promise.all([
      git(["rev-parse", "--verify", "--quiet", "HEAD"]),
      git(BRANCH),
      git(IGNORED),
    ]);
    // A repo with no commits has no HEAD to diff against.
    const numstat = head?.code === 0 ? await git(NUMSTAT) : null;
    if (this.key !== token || !gitOn()) return;
    const top = markKey(this.top);
    const here = markKey(root);
    const lines = numstat?.code === 0 ? parseNumstat(numstat.stdout) : {};
    this.gitInfo = {
      numstat: rebase(lines, top, here),
      counts: folderCounts(rebase(this.marks, "", here)),
      summary: summaryOf(this.marks, lines, branch?.code === 0 ? parseBranch(branch.stdout) : null),
      ignored: ignored?.code === 0 ? parseIgnored(ignored.stdout) : (this.gitInfo?.ignored ?? new Set()),
    };
    this.ignoredSet = this.gitInfo.ignored;
  },

  // A local folder says when it changes; another machine's is read on the timer alone.
  watch(cx) {
    const { root, on, key } = this;
    if (on || !root || this.watched === key) return;
    this.watched = key;
    cx.spawn(async (cx) => {
      try {
        while (this.key === key) {
          const changed = await watchFolder(root);
          if (this.key === key) await this.recordChanges(root, changed);
          this.changes = (this.changes ?? 0) + 1;
          if (this.index?.key === key) this.index.stale = true;
          if (this.key === key) this.refresh(cx);
        }
      } catch {
        // No watcher here: the timer still refreshes.
      }
      if (this.watched === key) this.watched = null;
    });
  },

  // The filter's list of every file, read when it's first needed, again once the folder
  // changes on disk but at most every 5 seconds, and every 30 for a folder that can't be watched.
  ensureIndex(cx) {
    const { root, on, key } = this;
    // A list read with Git on hides ignored files; one read with it off doesn't: the switch
    // makes the other list due.
    const git = gitOn();
    const reading = `${git}:${key}`;
    if (!root || !this.filterText() || this.indexing === reading) return;
    const index = this.index?.key === key && this.index.git === git ? this.index : null;
    const age = index ? Date.now() - index.at : Infinity;
    if (index && age < (index.stale ? RESTALE_MS : REINDEX_MS)) {
      // The last change before a quiet spell still gets read, once the wait is over.
      if (index.stale && !this.reindexLater) {
        this.reindexLater = true;
        cx.timer.after(RESTALE_MS - age, (cx) => {
          this.reindexLater = false;
          this.ensureIndex(cx);
        });
      }
      return;
    }
    this.indexing = reading;
    cx.spawn(async (cx) => {
      try {
        // A change on disk while the list is read leaves it stale, to be read again.
        const changes = this.changes;
        const listing = await everyFile(root, on, git);
        if (this.key === key && gitOn() === git) {
          this.index = { key, git, at: Date.now(), stale: this.changes !== changes, ...indexOf(listing) };
          this.indexError = null;
        }
      } catch (e) {
        if (this.key === key) this.indexError = e.message ?? String(e);
      } finally {
        if (this.indexing === reading) this.indexing = null;
        cx.notify();
      }
    });
  },

  // Recent: each changed path under the folder goes to the front of its list, except the
  // usual huge folders and what Git ignores (the last list read, kept while Git is off).
  // The watch reports folders too, so one sh call asks which paths are folders first.
  async recordChanges(root, changed) {
    const fresh = [];
    for (const path of changed ?? []) {
      const relative = relativeIn(root, path);
      if (!relative || (this.ignoredSet && isIgnored(this.ignoredSet, relative))) continue;
      if (!fresh.includes(relative) && record([], relative, 0).length) fresh.push(relative);
    }
    // The list keeps 100, so only the last 100 reported can matter.
    const paths = fresh.slice(-100);
    if (!paths.length) return;
    const local = window()?.platform !== "windows";
    const r = local ? await exec("sh", ["-c", KINDS, "kinds", ...paths], { cwd: root }).catch(() => null) : null;
    const kinds = r?.code === 0 ? kindsOf(paths, r.stdout) : new Map();
    const all = shared("better-files.recent") ?? {};
    const at = Date.now();
    let list = all[root] ?? [];
    for (const relative of paths) if (kinds.get(relative) !== "d") list = record(list, relative, at);
    setShared("better-files.recent", { ...all, [root]: dropFolders(list, kinds) });
  },

  // Forgets Recent entries found to be folders. Called from a check, never from drawing.
  dropRecentFolders(root, kinds) {
    const all = shared("better-files.recent") ?? {};
    const list = all[root] ?? [];
    const kept = dropFolders(list, kinds);
    if (kept !== list) setShared("better-files.recent", { ...all, [root]: kept });
  },

  // Which Recent paths are still there, and which are folders (a watch reports those too):
  // one sh call per check, at most every few seconds, never from drawing.
  async checkRecent(root, on, token) {
    const paths = (shared("better-files.recent")?.[root] ?? []).map((e) => e.path);
    const known = this.recentKinds;
    const same = known?.key === token && JSON.stringify(known.paths) === JSON.stringify(paths);
    if (!paths.length || (same && Date.now() - known.at < RECENT_CHECK_MS)) return;
    if (!on && window()?.platform === "windows") return;
    const r = await exec("sh", ["-c", KINDS, "kinds", ...paths], { cwd: root, on }).catch(() => null);
    if (this.key !== token || r?.code !== 0) return;
    const kinds = kindsOf(paths, r.stdout);
    this.recentKinds = { key: token, paths, at: Date.now(), kinds };
    this.dropRecentFolders(root, kinds);
  },

  toggleFolder(path, cx) {
    if (!this.folders.delete(path)) {
      this.folders.add(path);
      const { root, on, key } = this;
      cx.spawn(async (cx) => {
        try {
          await this.loadFolder(path, root, on, key);
        } catch (e) {
          if (this.key === key) this.treeError = e.message ?? String(e);
        }
        cx.notify();
      });
    }
    cx.notify();
  },

};
