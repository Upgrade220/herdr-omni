// List state shared by the side and full views: filtering, chip counts and small formatters.
// Pure: no herdr import, so tests load it directly.
import { chipOf } from "../forge/model.js";

export const CHIPS = ["all", "running", "failed", "passed", "other"];

// `query` matches title, branch and author (case-insensitive substring). A query of the form
// `#42` matches the run number exactly instead. `chip` is one of CHIPS (default "all").
export function filterRuns(runs, { query = "", chip = "all" } = {}) {
  const q = String(query ?? "").trim().toLowerCase();
  const num = q.match(/^#(\d+)$/);
  const matches = (r) => {
    if (!q) return true;
    if (num) return String(r.number) === num[1];
    return [r.title, r.branch, r.author].some((s) => String(s ?? "").toLowerCase().includes(q));
  };
  return (runs ?? []).filter((r) => (chip === "all" || !chip || chipOf(r.status) === chip) && matches(r));
}

export function chipCounts(runs) {
  const counts = { all: 0, running: 0, failed: 0, passed: 0, other: 0 };
  for (const r of runs ?? []) {
    counts.all++;
    counts[chipOf(r.status)]++;
  }
  return counts;
}

export const anyLive = (runs) => (runs ?? []).some((r) => r.status === "running" || r.status === "pending");

export function ago(iso, now = Date.now()) {
  const t = Date.parse(iso || "");
  if (!Number.isFinite(t)) return "";
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d ago`;
  return new Date(t).toISOString().slice(0, 10);
}

export function dur(sec) {
  if (sec == null || !Number.isFinite(sec)) return "";
  const s = Math.round(sec);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}

export function size(bytes) {
  if (!Number.isFinite(bytes)) return "";
  const units = ["B", "KB", "MB", "GB"];
  let i = 0;
  let v = bytes;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v >= 10 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}
