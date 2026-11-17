// GitLab provider: GraphQL for list/detail, REST (glab api) for actions, shell pipes for log/artifact.
import { cli, ForgeError } from "./cli.js";

const STATUS = {
  RUNNING: "running",
  PENDING: "pending",
  CREATED: "pending",
  WAITING_FOR_RESOURCE: "pending",
  PREPARING: "pending",
  SCHEDULED: "pending",
  MANUAL: "manual",
  SUCCESS: "success",
  FAILED: "failed",
  CANCELED: "canceled",
  SKIPPED: "skipped",
};
const mapStatus = (s) => STATUS[String(s ?? "").toUpperCase()] ?? "other";
const lastId = (gid) => String(gid).split("/").pop();
const num = (v) => (v == null || v === "" ? null : Number(v));

const PIPELINE_FIELDS = "iid id status source ref duration createdAt path user{username} commit{title} mergeRequest{iid}";
const JOB_FIELDS = "id name status manualJob allowFailure duration webPath artifacts{nodes{name fileType size}}";

function listQuery(branch, limit) {
  const ref = branch ? `, ref: ${JSON.stringify(branch)}` : "";
  const mrs = branch
    ? ` mergeRequests(sourceBranches: [${JSON.stringify(branch)}], state: opened){nodes{iid pipelines(first: ${limit}){nodes{${PIPELINE_FIELDS}}}}}`
    : "";
  return `query($p: ID!){ project(fullPath: $p){ pipelines(first: ${limit}${ref}){nodes{${PIPELINE_FIELDS}}}${mrs} } }`;
}

export function gitlabProvider(exec, { host, path }) {
  const enc = encodeURIComponent(path);
  const base = `https://${host}`;

  const graphql = async (query) => {
    const res = await cli(exec, "gitlab", host, ["api", "--hostname", host, "graphql", "-f", `query=${query}`, "-f", `p=${path}`]);
    if (res?.errors?.length) throw new ForgeError(res.errors.map((e) => e.message).join("; "), null, "");
    if (!res?.data?.project) throw new ForgeError("Project not found", 404, "Not found. Check the project path and your access to it.");
    return res.data.project;
  };

  const rest = (endpoint) => cli(exec, "gitlab", host, ["api", "--hostname", host, "-X", "POST", endpoint], { raw: true });

  // Runs a shell script via exec directly (pipes/redirects); failures become ForgeError like cli().
  const sh = async (script, args) => {
    let res;
    try {
      res = await exec("sh", ["-c", script, "sh", ...args], { timeout: 60000 });
    } catch (e) {
      throw new ForgeError(String(e?.message ?? e), null, "Could not run glab. Install it (https://gitlab.com/gitlab-org/cli) and make sure it is on PATH.");
    }
    if (res.code !== 0) {
      const stderr = (res.stderr ?? "").trim();
      const m = stderr.match(/HTTP\s+(\d{3})/i) ?? stderr.match(/\b(401|403|404|429)\b/);
      throw new ForgeError(stderr || `glab exited with ${res.code}`, m ? Number(m[1]) : null, "");
    }
    return res.stdout ?? "";
  };

  const toRun = (p, requestIid) => ({
    id: lastId(p.id),
    number: num(p.iid),
    title: p.commit?.title ?? "",
    branch: p.ref ?? "",
    status: mapStatus(p.status),
    trigger: String(p.source ?? "").toLowerCase(),
    author: p.user?.username ?? "",
    createdAt: p.createdAt,
    durationSec: p.duration ?? null,
    url: p.path ? base + p.path : "",
    request: num(requestIid ?? p.mergeRequest?.iid),
    attempt: null,
  });

  const toJob = (j, group) => ({
    id: j.id,
    name: j.name,
    group,
    status: mapStatus(j.status),
    durationSec: j.duration ?? null,
    url: j.webPath ? base + j.webPath : "",
    manual: !!j.manualJob,
    allowFailure: !!j.allowFailure,
    steps: [],
  });

  return {
    capabilities: { play: true, retryFailed: false, liveLog: true },

    async listRuns({ branch = null, limit = 30 } = {}) {
      const project = await graphql(listQuery(branch, limit));
      const byId = new Map();
      for (const p of project.pipelines?.nodes ?? []) byId.set(p.id, toRun(p));
      for (const mr of project.mergeRequests?.nodes ?? []) {
        for (const p of mr.pipelines?.nodes ?? []) if (!byId.has(p.id)) byId.set(p.id, toRun(p, mr.iid));
      }
      return [...byId.values()].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    },

    async runDetail(id) {
      const gid = `gid://gitlab/Ci::Pipeline/${id}`;
      const q = `query($p: ID!){ project(fullPath: $p){ pipeline(id: ${JSON.stringify(gid)}){ ${PIPELINE_FIELDS} stages{nodes{name jobs{nodes{${JOB_FIELDS}}}}} } } }`;
      const project = await graphql(q);
      const p = project.pipeline;
      if (!p) throw new ForgeError(`Pipeline ${id} not found`, 404, "Not found. Check the project path and your access to it.");
      const groups = [];
      const artifacts = [];
      for (const stage of p.stages?.nodes ?? []) {
        const jobs = [];
        for (const j of stage.jobs?.nodes ?? []) {
          jobs.push(toJob(j, stage.name));
          // Only the ARCHIVE artifact is downloadable through the job artifacts endpoint.
          for (const a of j.artifacts?.nodes ?? []) {
            if (a.fileType === "ARCHIVE") artifacts.push({ id: `${lastId(j.id)}:${a.name}`, name: a.name, sizeBytes: num(a.size) ?? 0, jobId: j.id });
          }
        }
        groups.push({ name: stage.name, jobs });
      }
      return { run: toRun(p), groups, artifacts };
    },

    async jobLog(jobId, { maxBytes = 200000 } = {}) {
      const out = await sh('glab api --hostname "$1" "$2" | tail -c "$3"', [host, `projects/${enc}/jobs/${lastId(jobId)}/trace`, String(maxBytes + 1)]);
      const truncated = out.length > maxBytes;
      return { text: truncated ? out.slice(out.length - maxBytes) : out, truncated, available: true };
    },

    async retryRun(id) { await rest(`projects/${enc}/pipelines/${lastId(id)}/retry`); },
    async cancelRun(id) { await rest(`projects/${enc}/pipelines/${lastId(id)}/cancel`); },
    async retryJob(jobId) { await rest(`projects/${enc}/jobs/${lastId(jobId)}/retry`); },
    async cancelJob(jobId) { await rest(`projects/${enc}/jobs/${lastId(jobId)}/cancel`); },
    async playJob(jobId) { await rest(`projects/${enc}/jobs/${lastId(jobId)}/play`); },

    async downloadArtifact(artifact, dir) {
      const jobId = lastId(artifact.jobId);
      const name = String(artifact.name).replace(/\.zip$/i, "");
      const file = `${dir}/${path.split("/").pop()}-${jobId}-${name}.zip`;
      await sh('glab api --hostname "$1" "$2" > "$3"', [host, `projects/${enc}/jobs/${jobId}/artifacts`, file]);
      return file;
    },
  };
}
