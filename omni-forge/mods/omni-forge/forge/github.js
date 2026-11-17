// GitHub provider: REST through `gh api`, shell for logs and `gh run download`. Same interface as gitlabProvider.
// RunDetail.groups is one group per job (the job holds its steps), so Job.group is the job name.
import { cli, shell, ForgeError } from "./cli.js";

const RUNNING = { in_progress: "running", queued: "pending", waiting: "pending", requested: "pending", pending: "pending" };
const CONCLUSION = {
  success: "success",
  failure: "failed",
  timed_out: "failed",
  startup_failure: "failed",
  cancelled: "canceled",
  skipped: "skipped",
};
function mapStatus(status, conclusion) {
  if (status === "completed") return CONCLUSION[conclusion] ?? "other";
  return RUNNING[status] ?? "other";
}

function seconds(from, to) {
  if (!from || !to) return null;
  const s = (Date.parse(to) - Date.parse(from)) / 1000;
  return Number.isFinite(s) && s >= 0 ? Math.round(s) : null;
}

function utf8Len(s) {
  let n = 0;
  for (const ch of s) {
    const c = ch.codePointAt(0);
    n += c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4;
  }
  return n;
}

export function githubProvider(exec, { host, path }) {
  const api = `repos/${path}/actions`;
  const hostArgs = ["--hostname", host];

  const get = (endpoint) => cli(exec, "github", host, ["api", ...hostArgs, endpoint]);
  const post = (endpoint) => cli(exec, "github", host, ["api", ...hostArgs, "-X", "POST", endpoint], { raw: true });
  const sh = (script, args) => shell(exec, "github", host, script, args);

  const toRun = (r) => ({
    id: String(r.id),
    number: r.run_number ?? null,
    title: r.display_title ?? "",
    branch: r.head_branch ?? "",
    status: mapStatus(r.status, r.conclusion),
    trigger: r.event ?? "",
    author: r.actor?.login ?? "",
    createdAt: r.run_started_at ?? r.created_at ?? "",
    durationSec: seconds(r.run_started_at, r.updated_at),
    url: r.html_url ?? "",
    request: r.pull_requests?.[0]?.number ?? null,
    attempt: r.run_attempt ?? null,
  });

  const toJob = (j) => ({
    id: String(j.id),
    name: j.name,
    group: j.name,
    status: mapStatus(j.status, j.conclusion),
    durationSec: seconds(j.started_at, j.completed_at),
    url: j.html_url ?? "",
    manual: false,
    allowFailure: false,
    steps: (j.steps ?? []).map((s) => ({
      name: s.name,
      status: mapStatus(s.status, s.conclusion),
      durationSec: seconds(s.started_at, s.completed_at),
    })),
  });

  return {
    capabilities: { play: false, retryFailed: true, liveLog: false },

    async listRuns({ branch = null, limit = 30 } = {}) {
      const b = branch ? `&branch=${encodeURIComponent(branch)}` : "";
      const res = await get(`${api}/runs?per_page=${limit}${b}`);
      return (res.workflow_runs ?? []).map(toRun);
    },

    async runDetail(id) {
      const rid = String(id);
      const [run, jobs, arts] = await Promise.all([
        get(`${api}/runs/${rid}`),
        get(`${api}/runs/${rid}/jobs?per_page=100`),
        get(`${api}/runs/${rid}/artifacts?per_page=100`),
      ]);
      const groups = (jobs.jobs ?? []).map((j) => ({ name: j.name, jobs: [toJob(j)] }));
      // The id carries the run id: `gh run download` needs it and Artifact has no run field.
      const artifacts = (arts.artifacts ?? []).map((a) => ({ id: `${rid}:${a.name}`, name: a.name, sizeBytes: a.size_in_bytes ?? 0, jobId: null }));
      return { run: toRun(run), groups, artifacts };
    },

    async jobLog(jobId, { maxBytes = 200000 } = {}) {
      let out;
      try {
        out = await sh('out=$(gh api --hostname "$1" "$2") || exit $?; printf %s "$out" | tail -c "$3"', [host, `${api}/jobs/${jobId}/logs`, String(maxBytes + 1)]);
      } catch (e) {
        // GitHub answers 404 until the job has finished.
        if (e instanceof ForgeError && e.status === 404) return { text: "", truncated: false, available: false };
        throw e;
      }
      const truncated = utf8Len(out) > maxBytes;
      let text = out.replace(/^�+/, "");
      while (utf8Len(text) > maxBytes) text = text.slice(text.codePointAt(0) > 0xffff ? 2 : 1);
      return { text, truncated, available: true };
    },

    async retryRun(id, { failedOnly = false } = {}) { await post(`${api}/runs/${id}/${failedOnly ? "rerun-failed-jobs" : "rerun"}`); },
    async cancelRun(id) { await post(`${api}/runs/${id}/cancel`); },
    async retryJob(jobId) { await post(`${api}/jobs/${jobId}/rerun`); },
    async cancelJob() { throw new ForgeError("Not supported on GitHub", null, ""); },
    async playJob() { throw new ForgeError("Not supported on GitHub", null, ""); },

    async downloadArtifact(artifact, dir) {
      const runId = String(artifact.id).split(":")[0];
      const out = `${dir}/${path.split("/").pop()}-${runId}-${artifact.name}`;
      await sh('gh run download "$1" -R "$2" -n "$3" -D "$4"', [runId, `${host}/${path}`, artifact.name, out]);
      return out;
    },
  };
}
