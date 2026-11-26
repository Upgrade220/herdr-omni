// The full CI view's own tabs: Runs (always first, never closed), a tab per opened run
// and a tab per opened job log. Pure: no herdr import. Not persisted.

export const MAX_TABS = 8;

const RUNS = { id: "runs", kind: "runs", label: "Runs" };
const MRS = { id: "mrs", kind: "mrs", label: "MRs" };
const FIXED = new Set([RUNS.id, MRS.id]);

const runLabel = ({ id, title, number }) => (number != null ? `#${number} ${title ?? ""}`.trim() : title || `Run ${id}`);

export class Tabs {
  constructor() {
    this.onEvict = null; // (tab) => void, so the owner can drop what the tab held
    this.reset();
  }

  reset() {
    this.list = [{ ...RUNS }, { ...MRS }];
    this.selected = RUNS.id;
    this.history = [RUNS.id]; // selection order, most recent last
  }

  find(id) {
    return this.list.find((t) => t.id === id) ?? null;
  }

  select(id) {
    if (!this.find(id)) return;
    this.selected = id;
    this.history = [...this.history.filter((h) => h !== id), id];
  }

  openRun({ id, title, number, status }) {
    return this.open({ id: `run:${id}`, kind: "run", label: runLabel({ id, title, number }), runId: String(id), status });
  }

  // A run tab opened from a watch key only knows the id; once loaded it gets its real name.
  setRun({ id, title, number, status }) {
    const tab = this.find(`run:${id}`);
    if (!tab) return;
    tab.label = runLabel({ id, title, number });
    if (status) tab.status = status;
  }

  openMr({ number, title }) {
    return this.open({ id: `mr:${number}`, kind: "mr", label: `#${number} ${title ?? ""}`.trim(), number: String(number) });
  }

  // The MR's real name once its page has loaded.
  setMr({ number, label }) {
    const tab = this.find(`mr:${number}`);
    if (tab) tab.label = label;
  }

  openLog({ runId, jobId, name, status }) {
    return this.open({ id: `log:${runId}:${jobId}`, kind: "log", label: name || `Job ${jobId}`, runId: String(runId), jobId: String(jobId), status });
  }

  open(tab) {
    let existing = this.find(tab.id);
    if (existing) {
      if (tab.status) existing.status = tab.status;
    } else {
      existing = tab;
      this.list.push(tab);
      this.evict(tab.id);
    }
    this.select(tab.id);
    return existing;
  }

  // Over the limit, close the least recently selected tab other than the fixed ones and `keep`.
  evict(keep) {
    while (this.list.length > MAX_TABS) {
      const rank = (t) => {
        const i = this.history.indexOf(t.id);
        return i < 0 ? -1 : i; // never selected counts as oldest
      };
      const victim = this.list
        .filter((t) => !FIXED.has(t.id) && t.id !== keep)
        .sort((a, b) => rank(a) - rank(b))[0];
      if (!victim) return;
      this.remove(victim.id);
      this.onEvict?.(victim);
    }
  }

  close(id) {
    if (FIXED.has(id)) return null;
    const tab = this.find(id);
    if (!tab) return null;
    this.remove(id);
    return tab;
  }

  remove(id) {
    this.list = this.list.filter((t) => t.id !== id);
    this.history = this.history.filter((h) => h !== id);
    if (this.selected === id) this.selected = this.history[this.history.length - 1] ?? RUNS.id;
  }

  setStatus(id, status) {
    const tab = this.find(id);
    if (tab) tab.status = status;
  }
}
