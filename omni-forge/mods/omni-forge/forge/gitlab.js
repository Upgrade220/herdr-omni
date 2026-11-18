// GitLab provider: GraphQL for list/detail, REST (glab api) for actions, shell pipes for log/artifact.
import { cli, shell, tailText, ForgeError, execFailure, hintFor } from "./cli.js";

const STATUS = {
  RUNNING: "running",
  CANCELING: "running",
  PENDING: "pending",
  CREATED: "pending",
  WAITING_FOR_RESOURCE: "pending",
  PREPARING: "pending",
  SCHEDULED: "pending",
  MANUAL: "manual",
  SUCCESS: "success",
  SUCCESS_WITH_WARNINGS: "success",
  FAILED: "failed",
  CANCELED: "canceled",
  SKIPPED: "skipped",
};
const mapStatus = (s) => STATUS[String(s ?? "").toUpperCase()] ?? "other";
const lastId = (gid) => String(gid).split("/").pop();
const num = (v) => (v == null || v === "" ? null : Number(v));

const PIPELINE_FIELDS = "iid id status source ref duration createdAt path user{username} commit{title} mergeRequest{iid sourceBranch}";
const JOB_FIELDS = "id name status manualJob allowFailure duration webPath artifacts{nodes{name fileType size}}";

function listQuery(branch, limit) {
  const ref = branch ? `, ref: ${JSON.stringify(branch)}` : "";
  const mrs = branch
    ? ` mergeRequests(sourceBranches: [${JSON.stringify(branch)}], state: opened){nodes{iid sourceBranch pipelines(first: ${limit}){nodes{${PIPELINE_FIELDS}}}}}`
    : "";
  return `query($p: ID!){ project(fullPath: $p){ pipelines(first: ${limit}${ref}){nodes{${PIPELINE_FIELDS}}}${mrs} } }`;
}

// `glab auth status --hostname <host>` gates every GitLab call. It runs here, before the first
// provider call, rather than in detectRepo: every entry point (repo list, detail, log pane, Send,
// watch tick) goes through a provider, and glab runs locally while detectRepo runs git on the
// space's machine. A success is kept per exec and host for the session; a failure is not, so
// Try again after `glab auth login` checks again.
const authed = new WeakMap();

export function glabAuth(exec, host) {
  let hosts = authed.get(exec);
  if (!hosts) authed.set(exec, (hosts = new Map()));
  let check = hosts.get(host);
  if (!check) {
    check = (async () => {
      let res;
      try {
        res = await exec("glab", ["auth", "status", "--hostname", host], { timeout: 15000 });
      } catch (e) {
        throw execFailure("gitlab", e);
      }
      if (res.code !== 0) throw new ForgeError(`Not logged in to ${host}`, 401, `glab auth login --hostname ${host}`);
    })();
    hosts.set(host, check);
    check.catch(() => { if (hosts.get(host) === check) hosts.delete(host); });
  }
  return check;
}

export function gitlabProvider(exec, { host, path }) {
  const enc = encodeURIComponent(path);
  const base = `https://${host}`;

  const login = `glab auth login --hostname ${host}`;
  const notFoundHint = `Not found. Check the project path and your access to it (${login}).`;

  const graphql = async (query) => {
    await glabAuth(exec, host);
    const res = await cli(exec, "gitlab", host, ["api", "--hostname", host, "graphql", "-f", `query=${query}`, "-f", `p=${path}`]);
    if (res?.errors?.length) {
      const msg = res.errors.map((e) => e.message).join("; ");
      throw new ForgeError(msg, null, hintFor("gitlab", host, msg, null));
    }
    // Without a token GitLab hides private projects, so a null project may mean "not logged in".
    if (!res?.data?.project) throw new ForgeError("Project not found", 404, notFoundHint);
    return res.data.project;
  };

  const rest = async (endpoint) => (await glabAuth(exec, host), cli(exec, "gitlab", host, ["api", "--hostname", host, "-X", "POST", endpoint], { raw: true }));

  const sh = async (script, args) => (await glabAuth(exec, host), shell(exec, "gitlab", host, script, args));

  const toRun = (p, requestIid, mrBranch) => ({
    id: lastId(p.id),
    number: num(p.iid),
    title: p.commit?.title ?? "",
    branch: p.mergeRequest?.sourceBranch ?? mrBranch ?? p.ref ?? "",
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
        for (const p of mr.pipelines?.nodes ?? []) {
          const run = toRun(p, mr.iid, mr.sourceBranch);
          const seen = byId.get(p.id);
          if (!seen) byId.set(p.id, run);
          else if (seen.request == null) Object.assign(seen, { request: run.request, branch: run.branch });
        }
      }
      return [...byId.values()].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    },

    async runDetail(id) {
      const gid = `gid://gitlab/Ci::Pipeline/${id}`;
      const q = `query($p: ID!){ project(fullPath: $p){ pipeline(id: ${JSON.stringify(gid)}){ ${PIPELINE_FIELDS} stages{nodes{name jobs{nodes{${JOB_FIELDS}}}}} } } }`;
      const project = await graphql(q);
      const p = project.pipeline;
      if (!p) throw new ForgeError(`Pipeline ${id} not found`, 404, notFoundHint);
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
      // Capture first, tail after: a pipe would hide glab's exit code behind tail's.
      const out = await sh('out=$(glab api --hostname "$1" "$2") || exit $?; printf %s "$out" | tail -c "$3"', [host, `projects/${enc}/jobs/${lastId(jobId)}/trace`, String(maxBytes + 1)]);
      return { ...tailText(out, maxBytes), available: true };
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
      await sh('glab api --hostname "$1" "$2" > "$3" || { rc=$?; rm -f "$3"; exit $rc; }; [ -s "$3" ] || { rm -f "$3"; echo "empty artifact download" >&2; exit 1; }', [host, `projects/${enc}/jobs/${jobId}/artifacts`, file]);
      return file;
    },
  };
}
