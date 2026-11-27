// GitHub provider: REST through `gh api`, shell for logs and `gh run download`. Same interface as gitlabProvider.
// RunDetail.groups is one group per job (the job holds its steps), so Job.group is the job name.
import { cli, shell, tailText, ForgeError, hintFor } from "./cli.js";
import { mrStateOf } from "./model.js";

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

const ROLLUP = { SUCCESS: "success", FAILURE: "failed", ERROR: "failed", PENDING: "running", EXPECTED: "running" };
const FILE_STATUS = { added: "added", removed: "deleted", modified: "modified", renamed: "renamed" };

// reviewThreads(first: 100) is enough for the chips; PRs with more threads undercount.
const PR_FIELDS = "number title isDraft state url updatedAt headRefName baseRefName author{login} reviewRequests(first: 20){nodes{requestedReviewer{... on User{login}}}} latestReviews(first: 30){nodes{state author{login}}} assignees(first: 20){nodes{login}} commits(last: 1){nodes{commit{oid statusCheckRollup{state}}}}";
const nodes = (c) => c?.nodes ?? [];

function seconds(from, to) {
  if (!from || !to) return null;
  const s = (Date.parse(to) - Date.parse(from)) / 1000;
  return Number.isFinite(s) && s >= 0 ? Math.round(s) : null;
}

export function githubProvider(exec, { host, path }) {
  const api = `repos/${path}/actions`;
  const hostArgs = ["--hostname", host];

  const get = (endpoint) => cli(exec, "github", host, ["api", ...hostArgs, endpoint]);
  const post = (endpoint) => cli(exec, "github", host, ["api", ...hostArgs, "-X", "POST", endpoint], { raw: true });
  const repoBase = `repos/${path}`;
  const [owner, name] = path.split("/");
  const prBase = (n) => `${repoBase}/pulls/${n}`;

  // Strings go as -f, numbers and booleans as -F; arrays as key[]=value (an empty one is the bare key[]).
  const fieldArgs = (fields) => Object.entries(fields).flatMap(([k, v]) =>
    Array.isArray(v) ? (v.length ? v.flatMap((x) => ["-f", `${k}[]=${x}`]) : ["-f", `${k}[]`]) : typeof v === "string" ? ["-f", `${k}=${v}`] : ["-F", `${k}=${v}`]);
  const rest = (endpoint, { method = "POST", fields = {} } = {}) =>
    cli(exec, "github", host, ["api", ...hostArgs, "-X", method, endpoint, ...fieldArgs(fields)], { raw: true });

  // One GraphQL call; transport and payload errors become ForgeError. Without `repo`, no owner/name variables.
  const graphql = async (query, { repo = true } = {}) => {
    const vars = repo ? ["-f", `owner=${owner}`, "-f", `name=${name}`] : [];
    const res = await cli(exec, "github", host, ["api", ...hostArgs, "graphql", "-f", `query=${query}`, ...vars]);
    if (res?.errors?.length) {
      const msg = res.errors.map((e) => e.message).join("; ");
      throw new ForgeError(msg, null, hintFor("github", host, msg, null));
    }
    return res?.data;
  };
  const notFound = (n) => new ForgeError(`Pull request ${n} not found`, 404, "Not found. Check the repository path and your access to it.");

  const toMr = (p) => {
    const approved = nodes(p.latestReviews).filter((r) => r.state === "APPROVED").map((r) => r.author?.login).filter(Boolean);
    const requested = nodes(p.reviewRequests).map((r) => r.requestedReviewer?.login).filter(Boolean);
    // The author's own COMMENTED review (a reply in a thread) doesn't make them a reviewer.
    const reviewed = nodes(p.latestReviews).map((r) => r.author?.login).filter((l) => l && l !== p.author?.login);
    const commit = nodes(p.commits)[0]?.commit;
    const rollup = commit?.statusCheckRollup?.state;
    return {
      number: p.number,
      title: p.title ?? "",
      author: p.author?.login ?? "",
      source: p.headRefName ?? "",
      target: p.baseRefName ?? "",
      draft: !!p.isDraft,
      state: mrStateOf(p.state),
      url: p.url ?? "",
      updatedAt: p.updatedAt,
      pipeline: rollup ? (ROLLUP[rollup] ?? "other") : null,
      pipelineRunId: null, // filled by mrDetail from actions/runs
      approvals: approved.length,
      approvalsRequired: null, // branch protection is not read
      approvedBy: approved,
      reviewers: [...new Set([...requested, ...reviewed])],
      assignees: nodes(p.assignees).map((u) => u.login),
      unresolved: nodes(p.reviewThreads).filter((t) => !t.isResolved).length,
      headSha: commit?.oid ?? "",
    };
  };

  const toNote = (c) => ({ id: String(c.databaseId), author: c.author?.login ?? "", body: c.body ?? "", createdAt: c.createdAt, system: false });

  // Applies `want` to a login list: POST the missing, DELETE the surplus, one call each, none when equal.
  const syncLogins = async (endpoint, key, have, want) => {
    const add = want.filter((u) => !have.includes(u));
    const del = have.filter((u) => !want.includes(u));
    if (add.length) await rest(endpoint, { fields: { [key]: add } });
    if (del.length) await rest(endpoint, { method: "DELETE", fields: { [key]: del } });
  };

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
    capabilities: { play: false, retryFailed: true, liveLog: false, mr: { revoke: false } },

    async listMrs() {
      const q = `query($owner: String!, $name: String!){ viewer{login} repository(owner: $owner, name: $name){ pullRequests(states: OPEN, orderBy: {field: UPDATED_AT, direction: DESC}, first: 50){nodes{${PR_FIELDS} reviewThreads(first: 100){nodes{isResolved}}}} } }`;
      const data = await graphql(q);
      if (!data?.repository) throw new ForgeError("Repository not found", 404, "Not found. Check the repository path and your access to it.");
      return { me: data.viewer?.login ?? "", mrs: nodes(data.repository.pullRequests).map(toMr) };
    },

    async mrDetail(number) {
      const q = `query($owner: String!, $name: String!){ viewer{login} repository(owner: $owner, name: $name){ pullRequest(number: ${Number(number)}){ ${PR_FIELDS} body comments(last: 100){pageInfo{hasPreviousPage} nodes{databaseId author{login} body createdAt}} reviewThreads(last: 100){pageInfo{hasPreviousPage} nodes{id isResolved path line originalLine comments(first: 100){nodes{databaseId author{login} body createdAt diffHunk}}}} } } }`;
      const data = await graphql(q);
      const pr = data?.repository?.pullRequest;
      if (!pr) throw notFound(number);
      const mr = toMr(pr);
      const [files, runs] = await Promise.all([
        get(`${prBase(number)}/files?per_page=100`),
        mr.headSha ? get(`${api}/runs?head_sha=${encodeURIComponent(mr.headSha)}&per_page=1`) : { workflow_runs: [] },
      ]);
      if (runs.workflow_runs?.[0]) mr.pipelineRunId = String(runs.workflow_runs[0].id);
      // Issue comments have no replies or resolution on GitHub: one non-resolvable thread each.
      const issue = nodes(pr.comments).map((c) => ({ id: `c:${c.databaseId}`, resolvable: false, resolved: false, path: null, line: null, notes: [toNote(c)] }));
      // Thread id = "<graphql thread id>|<first comment database id>": resolve needs the first, reply the second.
      const review = nodes(pr.reviewThreads).map((t) => ({
        id: `${t.id}|${nodes(t.comments)[0]?.databaseId}`,
        resolvable: true,
        resolved: !!t.isResolved,
        path: t.path ?? null,
        line: t.line ?? t.originalLine ?? null,
        notes: nodes(t.comments).map(toNote),
        hunk: nodes(t.comments)[0]?.diffHunk ?? null, // the diff up to the commented line
      }));
      const threads = [...issue, ...review].sort((a, b) => String(a.notes[0]?.createdAt).localeCompare(String(b.notes[0]?.createdAt)));
      mr.unresolved = review.filter((t) => !t.resolved).length;
      // comments and reviewThreads are the newest 100; older ones are cut.
      const olderThreads = Boolean(pr.comments?.pageInfo?.hasPreviousPage || pr.reviewThreads?.pageInfo?.hasPreviousPage);
      return {
        mr,
        me: data.viewer?.login ?? "",
        olderThreads,
        description: pr.body ?? "",
        threads,
        files: files.map((f) => ({ path: f.filename, add: f.additions ?? 0, del: f.deletions ?? 0, status: FILE_STATUS[f.status] ?? "modified" })),
      };
    },

    async approve(n) { await rest(`${prBase(n)}/reviews`, { fields: { event: "APPROVE" } }); },
    async unapprove() { throw new ForgeError("GitHub has no revoke for an approval", null, ""); },
    async comment(n, body) { await rest(`${repoBase}/issues/${n}/comments`, { fields: { body } }); },
    async reply(n, threadId, body) {
      const id = String(threadId);
      // Issue comments are not threaded; a reply is a new comment.
      if (id.startsWith("c:")) return this.comment(n, body);
      await rest(`${prBase(n)}/comments/${id.split("|")[1]}/replies`, { fields: { body } });
    },
    async resolve(n, threadId, resolved) {
      const id = String(threadId);
      if (id.startsWith("c:")) throw new ForgeError("A plain comment cannot be resolved on GitHub", null, "");
      const op = resolved ? "resolveReviewThread" : "unresolveReviewThread";
      await graphql(`mutation{ ${op}(input:{threadId: ${JSON.stringify(id.split("|")[0])}}){ thread{ id } } }`, { repo: false });
    },
    async update(n, { title, description } = {}) {
      const fields = {};
      if (title !== undefined) fields.title = title;
      if (description !== undefined) fields.body = description;
      await rest(prBase(n), { method: "PATCH", fields });
    },
    async setDraft(n, draft) {
      const pr = (await graphql(`query($owner: String!, $name: String!){ repository(owner: $owner, name: $name){ pullRequest(number: ${Number(n)}){ id } } }`))?.repository?.pullRequest;
      if (!pr) throw notFound(n);
      const op = draft ? "convertPullRequestToDraft" : "markPullRequestReadyForReview";
      await graphql(`mutation{ ${op}(input:{pullRequestId: ${JSON.stringify(pr.id)}}){ pullRequest{ id } } }`, { repo: false });
    },
    async setReviewers(n, usernames) {
      const endpoint = `${prBase(n)}/requested_reviewers`;
      const requested = ((await get(endpoint)).users ?? []).map((u) => u.login);
      const pr = (await graphql(`query($owner: String!, $name: String!){ repository(owner: $owner, name: $name){ pullRequest(number: ${Number(n)}){ author{login} latestReviews(first: 30){nodes{author{login}}} } } }`))?.repository?.pullRequest;
      if (!pr) throw notFound(n);
      // mr.reviewers shows requested plus already-reviewed logins, so the wanted list may hold both.
      const reviewed = nodes(pr.latestReviews).map((r) => r.author?.login).filter((l) => l && l !== pr.author?.login);
      const add = usernames.filter((u) => !requested.includes(u) && !reviewed.includes(u));
      // Only a pending request can be withdrawn; GitHub cannot un-review, so a removed login that
      // already reviewed (and is not requested again) is left alone.
      const del = requested.filter((u) => !usernames.includes(u));
      if (add.length) await rest(endpoint, { fields: { reviewers: add } });
      if (del.length) await rest(endpoint, { method: "DELETE", fields: { reviewers: del } });
    },
    async setAssignees(n, usernames) {
      const have = ((await get(`${repoBase}/issues/${n}`)).assignees ?? []).map((u) => u.login);
      await syncLogins(`${repoBase}/issues/${n}/assignees`, "assignees", have, usernames);
    },
    async close(n) { await rest(prBase(n), { method: "PATCH", fields: { state: "closed" } }); },
    async reopen(n) { await rest(prBase(n), { method: "PATCH", fields: { state: "open" } }); },

    async createMr({ source, target, title, description, draft, reviewers = [] }) {
      const fields = { head: source, base: target, title, body: description ?? "" };
      if (draft) fields.draft = true;
      const made = JSON.parse(await rest(`${repoBase}/pulls`, { fields }));
      // The PR exists now: a failed reviewer request must not fail the call, or a retry would hit a duplicate PR.
      if (reviewers.length) await rest(`${prBase(made.number)}/requested_reviewers`, { fields: { reviewers } }).catch(() => {});
      return (await this.mrDetail(made.number)).mr;
    },

    async searchUsers(query) {
      const q = String(query).toLowerCase();
      const all = await get(`${repoBase}/collaborators?per_page=100`);
      return all.filter((u) => u.login.toLowerCase().includes(q)).slice(0, 20).map((u) => ({ username: u.login, name: "" }));
    },

    async defaultBranch() { return (await get(repoBase)).default_branch ?? ""; },

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
      // `gh api .../logs` fails on the blob-store redirect, so use `gh run view --log`; it prefixes each
      // line with "<job>\t<step>\t", which sed strips. Capture first, tail after, so gh's exit code is kept.
      const script = 'out=$(gh run view --job "$1" -R "$2" --log) || exit $?; t=$(printf "\\t"); printf %s "$out" | sed "s/^[^$t]*$t[^$t]*$t//" | tail -c "$3"';
      let out;
      try {
        out = await sh(script, [String(jobId), `${host}/${path}`, String(maxBytes + 1)]);
      } catch (e) {
        // A running job has no log yet (gh says "still in progress"); a missing one is a 404.
        if (e instanceof ForgeError && (e.status === 404 || /still in progress|not completed/i.test(e.message))) return { text: "", truncated: false, available: false };
        if (e instanceof ForgeError && !e.hint) e.hint = "Could not fetch the job log. Check gh auth and your access to the repository.";
        throw e;
      }
      const { text, truncated } = tailText(out, maxBytes);
      // Each log line starts with a BOM after the prefix.
      return { text: text.replace(/^\uFEFF/gm, ""), truncated, available: true };
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
