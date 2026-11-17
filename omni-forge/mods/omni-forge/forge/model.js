// Shared data shapes for forge providers (GitLab and GitHub). Plain objects, no classes.
//
// Status = "running" | "pending" | "manual" | "success" | "failed" | "canceled" | "skipped" | "other"
// Run = { id, number, title, branch, status, trigger, author, createdAt, durationSec, url,
//         request: number|null, attempt: number|null }
// Job = { id, name, group, status, durationSec, url, manual: boolean, allowFailure: boolean,
//         steps: { name, status, durationSec }[] }   // group: GitLab stage, or GitHub job name for steps
// Artifact = { id, name, sizeBytes, jobId: string|null }
// RunDetail = { run: Run, groups: { name, jobs: Job[] }[], artifacts: Artifact[] }

// Collapses a Status into the chip shown in lists: running (incl. pending), failed, passed, other.
export function chipOf(status) {
  if (status === "running" || status === "pending") return "running";
  if (status === "failed") return "failed";
  if (status === "success") return "passed";
  return "other";
}
