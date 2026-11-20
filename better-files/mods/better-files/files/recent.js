// Recent: files changed on disk, newest first. Pure, no herdr imports. Times are ms.
export const SKIP_DIRS = ['.git', 'node_modules', '.venv', '__pycache__', 'target', 'dist', '.next'];

export function skipped(relPath) {
  return String(relPath).split('/').some((seg) => SKIP_DIRS.includes(seg));
}

// New list with relPath at the front (stamped `at`), cut to `max`. Input is not mutated.
export function record(list, relPath, at, max = 100) {
  if (skipped(relPath)) return list;
  return [{ path: relPath, at }, ...list.filter((e) => e.path !== relPath)].slice(0, max);
}

export function ago(ms) {
  const s = Math.floor(ms / 1000);
  if (s < 10) return 'now';
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h` : `${Math.floor(h / 24)}d`;
}

export function recentRows(list, exists, now) {
  return list.map((e) => ({ path: e.path, ago: ago(now - e.at), gone: !exists(e.path) }));
}
