// Poll cadence. Pure: callers own the timers.
const CAP_MS = 300000;

// visible+running 5s; otherwise 30s. Each consecutive error doubles the delay, capped at 5 min.
export function nextDelay({ visible, anyRunning, errors = 0 }) {
  const base = visible && anyRunning ? 5000 : 30000;
  return Math.min(CAP_MS, base * 2 ** Math.max(0, errors));
}
