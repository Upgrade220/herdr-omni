// Shared data shapes for forge providers (GitLab and GitHub). Plain objects, no classes.
//
// Status = "running" | "pending" | "manual" | "success" | "failed" | "canceled" | "skipped" | "other"
// Run = { id, number, title, branch, status, trigger, author, createdAt, durationSec, url,
//         request: number|null, attempt: number|null }
// Job = { id, name, group, status, durationSec, url, manual: boolean, allowFailure: boolean,
//         steps: { name, status, durationSec }[] }   // group: GitLab stage, or GitHub job name for steps
// Artifact = { id, name, sizeBytes, jobId: string|null }
// RunDetail = { run: Run, groups: { name, jobs: Job[] }[], artifacts: Artifact[] }
// MR = { number, title, author, source, target, draft, state: "open"|"merged"|"closed", url, updatedAt,
//        pipeline: Status|null, pipelineRunId: string|null, approvals, approvalsRequired: number|null,
//        approvedBy: string[], reviewers: string[], assignees: string[],   // usernames
//        unresolved: number, headSha }
// Thread = { id, resolvable, resolved, path: string|null, line: number|null,
//            notes: { id, author, body, createdAt, system: boolean }[] }   // ids are bare strings (GitLab gid prefixes stripped)
// MrDetail = { mr: MR, description, threads: Thread[], files: { path, add, del, status }[] }

// Raw GitLab ("opened"/"merged"/"closed"/"locked") or GitHub ("OPEN"/"MERGED"/"CLOSED") state as MR.state.
export function mrStateOf(state) {
  const s = String(state ?? "").toLowerCase();
  if (s === "opened" || s === "open") return "open";
  if (s === "merged") return "merged";
  return "closed";
}

// Collapses a Status into the chip shown in lists: running (incl. pending), failed, passed, other.
export function chipOf(status) {
  if (status === "running" || status === "pending") return "running";
  if (status === "failed") return "failed";
  if (status === "success") return "passed";
  return "other";
}
