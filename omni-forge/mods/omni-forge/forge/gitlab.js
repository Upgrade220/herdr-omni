// GitLab provider: GraphQL for list/detail, REST (glab api) for actions, shell pipes for log/artifact.
import { cli, shell, tailText, ForgeError, execFailure, hintFor } from "./cli.js";
import { mrStateOf } from "./model.js";

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

// unresolved = resolvableDiscussionsCount - resolvedDiscussionsCount: GitLab GraphQL exposes both
// counts on MergeRequest, so the list needs no discussion nodes.
const MR_FIELDS = "iid title draft state webUrl updatedAt sourceBranch targetBranch diffHeadSha author{username} approvalsRequired approvedBy{nodes{username}} reviewers{nodes{username}} assignees{nodes{username}} headPipeline{id status} resolvableDiscussionsCount resolvedDiscussionsCount";
const NOTE_FIELDS = "id author{username} body createdAt system position{newPath newLine oldPath oldLine}";
const names = (c) => (c?.nodes ?? []).map((u) => u.username);

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

  const rawGraphql = async (query) => {
    await glabAuth(exec, host);
    const res = await cli(exec, "gitlab", host, ["api", "--hostname", host, "graphql", "-f", `query=${query}`, "-f", `p=${path}`]);
    if (res?.errors?.length) {
      const msg = res.errors.map((e) => e.message).join("; ");
      throw new ForgeError(msg, null, hintFor("gitlab", host, msg, null));
    }
    // Without a token GitLab hides private projects, so a null project may mean "not logged in".
    if (!res?.data?.project) throw new ForgeError("Project not found", 404, notFoundHint);
    return res.data;
  };
  const graphql = async (query) => (await rawGraphql(query)).project;

  // Strings go as -f, numbers and booleans as -F (typed). glab never parses bracketed field names
  // in bodies, so an array is one typed field with a JSON value: -F ids=[7,8].
  const fieldArgs = (fields) => Object.entries(fields).flatMap(([k, v]) =>
    Array.isArray(v) ? ["-F", `${k}=${JSON.stringify(v)}`] : typeof v === "string" ? ["-f", `${k}=${v}`] : ["-F", `${k}=${v}`]);
  const rest = async (endpoint, { method = "POST", fields = {} } = {}) =>
    (await glabAuth(exec, host), cli(exec, "gitlab", host, ["api", "--hostname", host, "-X", method, endpoint, ...fieldArgs(fields)], { raw: true }));

  const get = async (endpoint) => (await glabAuth(exec, host), cli(exec, "gitlab", host, ["api", "--hostname", host, endpoint]));

  // GraphQL mutation by project path; throws on transport errors and on the payload's `errors`.
  const mutate = async (query, name) => {
    await glabAuth(exec, host);
    const res = await cli(exec, "gitlab", host, ["api", "--hostname", host, "graphql", "-f", `query=${query}`]);
    const msg = [...(res?.errors ?? []).map((e) => e.message), ...(res?.data?.[name]?.errors ?? [])].join("; ");
    if (msg) throw new ForgeError(msg, null, hintFor("gitlab", host, msg, null));
  };

  const mrBase = (n) => `projects/${enc}/merge_requests/${n}`;

  const userIds = async (usernames) => {
    const ids = [];
    for (const u of usernames) {
      const found = (await get(`projects/${enc}/members/all?query=${encodeURIComponent(u)}&per_page=20`)).find((m) => m.username === u);
      if (!found) throw new ForgeError(`User ${u} is not a member of ${path}`, 404, "");
      ids.push(found.id);
    }
    return ids;
  };
  // An empty list ([]) clears.
  const idFields = (key, ids) => ({ [`${key}_ids`]: ids });

  const toMr = (m) => ({
    number: num(m.iid),
    title: m.title ?? "",
    author: m.author?.username ?? "",
    source: m.sourceBranch ?? "",
    target: m.targetBranch ?? "",
    draft: !!m.draft,
    state: mrStateOf(m.state),
    url: m.webUrl ?? "",
    updatedAt: m.updatedAt,
    pipeline: m.headPipeline ? mapStatus(m.headPipeline.status) : null,
    pipelineRunId: m.headPipeline ? lastId(m.headPipeline.id) : null,
    approvals: names(m.approvedBy).length,
    approvalsRequired: m.approvalsRequired ?? null,
    approvedBy: names(m.approvedBy),
    reviewers: names(m.reviewers),
    assignees: names(m.assignees),
    unresolved: Math.max(0, (m.resolvableDiscussionsCount ?? 0) - (m.resolvedDiscussionsCount ?? 0)),
    headSha: m.diffHeadSha ?? "",
  });

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
    capabilities: { play: true, retryFailed: false, liveLog: true, mr: { revoke: true } },

    async listMrs() {
      const q = `query($p: ID!){ currentUser{username} project(fullPath: $p){ mergeRequests(state: opened, sort: UPDATED_DESC, first: 50){nodes{${MR_FIELDS}}} } }`;
      const res = await rawGraphql(q);
      return { me: res.currentUser?.username ?? "", mrs: (res.project.mergeRequests?.nodes ?? []).map(toMr) };
    },

    async mrDetail(number) {
      const q = `query($p: ID!){ currentUser{username} project(fullPath: $p){ mergeRequest(iid: ${JSON.stringify(String(number))}){ ${MR_FIELDS} description diffStats{path additions deletions} discussions(last: 100){pageInfo{hasPreviousPage} nodes{id resolvable resolved notes{nodes{${NOTE_FIELDS}}}}} } } }`;
      const res = await rawGraphql(q);
      const m = res.project?.mergeRequest;
      if (!m) throw new ForgeError(`Merge request ${number} not found`, 404, notFoundHint);
      return {
        mr: toMr(m),
        me: res.currentUser?.username ?? "",
        olderThreads: Boolean(m.discussions?.pageInfo?.hasPreviousPage), // discussions is the newest 100
        description: m.description ?? "",
        threads: (m.discussions?.nodes ?? []).map((d) => {
          const pos = (d.notes?.nodes ?? []).find((n) => n.position)?.position;
          return {
            id: lastId(d.id), // REST paths need the bare hex, not gid://gitlab/Discussion/<hex>
            resolvable: !!d.resolvable,
            resolved: !!d.resolved,
            notes: (d.notes?.nodes ?? []).map((n) => ({ id: lastId(n.id), author: n.author?.username ?? "", body: n.body ?? "", createdAt: n.createdAt, system: !!n.system })),
            path: pos ? (pos.newPath ?? pos.oldPath ?? null) : null,
            line: pos ? (num(pos.newLine) ?? num(pos.oldLine)) : null,
          };
        }),
        // diffStats carries no change type, so every file is "modified".
        files: (m.diffStats ?? []).map((f) => ({ path: f.path, add: f.additions ?? 0, del: f.deletions ?? 0, status: "modified" })),
      };
    },

    async approve(n) { await rest(`${mrBase(n)}/approve`); },
    async unapprove(n) { await rest(`${mrBase(n)}/unapprove`); },
    async comment(n, body) { await rest(`${mrBase(n)}/notes`, { fields: { body } }); },
    async reply(n, threadId, body) { await rest(`${mrBase(n)}/discussions/${threadId}/notes`, { fields: { body } }); },
    async resolve(n, threadId, resolved) { await rest(`${mrBase(n)}/discussions/${threadId}`, { method: "PUT", fields: { resolved: !!resolved } }); },
    async update(n, { title, description } = {}) {
      const fields = {};
      if (title !== undefined) fields.title = title;
      if (description !== undefined) fields.description = description;
      await rest(mrBase(n), { method: "PUT", fields });
    },
    async setDraft(n, draft) {
      await mutate(`mutation{ mergeRequestSetDraft(input:{projectPath: ${JSON.stringify(path)}, iid: ${JSON.stringify(String(n))}, draft: ${!!draft}}){ errors } }`, "mergeRequestSetDraft");
    },
    async setReviewers(n, usernames) { await rest(mrBase(n), { method: "PUT", fields: idFields("reviewer", await userIds(usernames)) }); },
    async setAssignees(n, usernames) { await rest(mrBase(n), { method: "PUT", fields: idFields("assignee", await userIds(usernames)) }); },
    async close(n) { await rest(mrBase(n), { method: "PUT", fields: { state_event: "close" } }); },
    async reopen(n) { await rest(mrBase(n), { method: "PUT", fields: { state_event: "reopen" } }); },

    async createMr({ source, target, title, description, draft, reviewers = [] }) {
      const fields = { source_branch: source, target_branch: target, title: draft ? `Draft: ${title}` : title, description: description ?? "" };
      if (reviewers.length) fields.reviewer_ids = await userIds(reviewers);
      const made = JSON.parse(await rest(`projects/${enc}/merge_requests`, { fields }));
      return (await this.mrDetail(made.iid)).mr;
    },

    async searchUsers(query) {
      const found = await get(`projects/${enc}/members/all?query=${encodeURIComponent(query)}&per_page=20`);
      return found.map((m) => ({ username: m.username, name: m.name ?? "" }));
    },

    async defaultBranch() { return (await graphql(`query($p: ID!){ project(fullPath: $p){ repository{ rootRef } } }`)).repository?.rootRef ?? ""; },

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
