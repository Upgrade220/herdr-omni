const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { load } = require("./load.cjs");
const { githubProvider } = load(["forge/cli.js", "forge/model.js", "forge/github.js"]);
const fixture = (n) => fs.readFileSync(path.join(__dirname, "fixtures", n), "utf8");
const repo = { host: "github.com", path: "acme/app" };

function recorder(reply) {
  const calls = [];
  const exec = async (cmd, args) => {
    calls.push({ cmd, args });
    return reply(cmd, args);
  };
  return { exec, calls };
}
const ok = (stdout = "{}") => ({ code: 0, stdout, stderr: "" });
const queryOf = (c) => c.args.find((a) => a.startsWith("query="));
const callOf = (calls, i = 0) => {
  const a = calls[i].args;
  const method = a.includes("-X") ? a[a.indexOf("-X") + 1] : "GET";
  const endpoint = a.find((x) => x.startsWith("repos/"));
  const fields = a.filter((x, j) => j > 0 && (a[j - 1] === "-f" || a[j - 1] === "-F") && !x.startsWith("query=") && !x.startsWith("owner=") && !x.startsWith("name="));
  return { method, endpoint, fields: [...fields] };
};

test("capabilities keep CI and add mr.revoke=false", () => {
  const p = githubProvider(recorder(() => ok()).exec, repo);
  assert.deepEqual({ ...p.capabilities.mr }, { revoke: false });
  assert.equal(p.capabilities.retryFailed, true);
});

test("listMrs maps the fixture", async () => {
  const { exec, calls } = recorder(() => ok(fixture("github-prs.json")));
  const { me, mrs } = await githubProvider(exec, repo).listMrs();
  assert.equal(calls.length, 1);
  assert.deepEqual([...calls[0].args.slice(0, 4)], ["api", "--hostname", "github.com", "graphql"]);
  const q = queryOf(calls[0]);
  for (const s of ["viewer{login}", "states: OPEN", "UPDATED_AT", "first: 50", "reviewRequests", "latestReviews", "reviewThreads", "statusCheckRollup"]) assert.ok(q.includes(s), s);
  assert.ok(calls[0].args.includes("owner=acme") && calls[0].args.includes("name=app"));
  assert.equal(me, "bob");
  assert.equal(mrs.length, 2);
  const a = mrs[0];
  assert.equal(a.number, 12);
  assert.equal(a.author, "alice");
  assert.equal(a.source, "feat-12");
  assert.equal(a.target, "main");
  assert.equal(a.draft, false);
  assert.equal(a.state, "open");
  assert.equal(a.url, "https://github.com/acme/app/pull/12");
  assert.equal(a.pipeline, "failed");
  assert.equal(a.pipelineRunId, null);
  assert.equal(a.approvals, 1);
  assert.equal(a.approvalsRequired, null);
  assert.deepEqual([...a.approvedBy], ["carol"]);
  assert.deepEqual([...a.reviewers], ["bob", "carol", "dave"]);
  assert.deepEqual([...a.assignees], ["alice"]);
  assert.equal(a.unresolved, 2);
  assert.equal(a.headSha, "sha12");
  const b = mrs[1];
  assert.equal(b.draft, true);
  assert.equal(b.pipeline, null);
  assert.equal(b.unresolved, 0);
  assert.deepEqual([...b.reviewers], []);
});

test("pipeline state mapping", async () => {
  for (const [state, want] of [["SUCCESS", "success"], ["ERROR", "failed"], ["PENDING", "running"], ["EXPECTED", "running"], ["WEIRD", "other"]]) {
    const data = JSON.parse(fixture("github-prs.json"));
    data.data.repository.pullRequests.nodes[0].commits.nodes[0].commit.statusCheckRollup.state = state;
    const { exec } = recorder(() => ok(JSON.stringify(data)));
    assert.equal((await githubProvider(exec, repo).listMrs()).mrs[0].pipeline, want);
  }
});

function detailReply(cmd, args) {
  if (args.includes("graphql")) return ok(fixture("github-pr-detail.json"));
  if (args.some((a) => a.includes("/files"))) return ok(fixture("github-pr-files.json"));
  if (args.some((a) => a.includes("actions/runs"))) return ok(fixture("github-pr-runs.json"));
  return ok();
}

test("mrDetail: threads (review + issue comments), files, newest run id", async () => {
  const { exec, calls } = recorder(detailReply);
  const d = await githubProvider(exec, repo).mrDetail(12);
  assert.ok(calls.some((c) => c.args.includes("repos/acme/app/actions/runs?head_sha=sha12&per_page=1")));
  assert.ok(calls.some((c) => c.args.includes("repos/acme/app/pulls/12/files?per_page=100")));
  assert.equal(d.mr.number, 12);
  assert.equal(d.mr.pipelineRunId, "9100");
  assert.equal(d.mr.pipeline, "running");
  assert.equal(d.mr.unresolved, 1);
  assert.equal(d.description, "Adds the widget.");
  assert.deepEqual([...d.threads.map((t) => t.id)], ["c:501", "PRRT_aaa|601", "PRRT_bbb|603"]);
  const c = d.threads[0];
  assert.equal(c.resolvable, false);
  assert.equal(c.resolved, false);
  assert.equal(c.path, null);
  assert.deepEqual({ ...c.notes[0] }, { id: "501", author: "carol", body: "Looks fine overall", createdAt: "2026-01-01T09:00:00Z", system: false });
  const t = d.threads[1];
  assert.equal(t.resolvable, true);
  assert.equal(t.resolved, false);
  assert.equal(t.path, "src/widget.js");
  assert.equal(t.line, 7);
  assert.equal(t.notes.length, 2);
  assert.equal(t.notes[1].author, "alice");
  assert.equal(t.notes[1].id, "602");
  assert.equal(d.threads[2].resolved, true);
  assert.equal(d.threads[2].line, 3);
  assert.deepEqual([...d.files.map((f) => ({ ...f }))], [
    { path: "src/widget.js", add: 10, del: 2, status: "modified" },
    { path: "src/new.js", add: 5, del: 0, status: "added" },
    { path: "src/gone.js", add: 0, del: 4, status: "deleted" },
    { path: "src/b.js", add: 0, del: 0, status: "renamed" },
  ]);
});

test("simple writes call the expected method, endpoint and fields", async () => {
  const P = "repos/acme/app";
  const cases = [
    [(p) => p.approve(12), "POST", `${P}/pulls/12/reviews`, ["event=APPROVE"]],
    [(p) => p.comment(12, "hi"), "POST", `${P}/issues/12/comments`, ["body=hi"]],
    [(p) => p.reply(12, "PRRT_aaa|601", "yo"), "POST", `${P}/pulls/12/comments/601/replies`, ["body=yo"]],
    [(p) => p.reply(12, "c:501", "yo"), "POST", `${P}/issues/12/comments`, ["body=yo"]],
    [(p) => p.update(12, { title: "T", description: "D" }), "PATCH", `${P}/pulls/12`, ["title=T", "body=D"]],
    [(p) => p.close(12), "PATCH", `${P}/pulls/12`, ["state=closed"]],
    [(p) => p.reopen(12), "PATCH", `${P}/pulls/12`, ["state=open"]],
  ];
  for (const [fn, method, endpoint, fields] of cases) {
    const { exec, calls } = recorder(() => ok());
    assert.equal(await fn(githubProvider(exec, repo)), undefined);
    assert.equal(calls.length, 1);
    const c = callOf(calls);
    assert.equal(c.method, method);
    assert.equal(c.endpoint, endpoint);
    assert.deepEqual(c.fields, fields);
  }
});

test("resolve uses GraphQL on the thread id; issue comments cannot be resolved", async () => {
  for (const [flag, name] of [[true, "resolveReviewThread"], [false, "unresolveReviewThread"]]) {
    const { exec, calls } = recorder(() => ok(`{"data":{"${name}":{"thread":{"id":"x"}}}}`));
    await githubProvider(exec, repo).resolve(12, "PRRT_aaa|601", flag);
    const q = queryOf(calls[0]);
    assert.ok(q.includes(name) && q.includes('"PRRT_aaa"') && !q.includes("601"));
  }
  const { exec, calls } = recorder(() => ok());
  await assert.rejects(githubProvider(exec, repo).resolve(12, "c:501", true), /resolve/i);
  assert.equal(calls.length, 0);
});

test("resolve surfaces GraphQL errors", async () => {
  const { exec } = recorder(() => ok('{"errors":[{"message":"nope"}]}'));
  await assert.rejects(githubProvider(exec, repo).resolve(12, "PRRT_aaa|601", true), /nope/);
});

test("unapprove rejects", async () => {
  const { exec, calls } = recorder(() => ok());
  await assert.rejects(githubProvider(exec, repo).unapprove(12), /no revoke/);
  assert.equal(calls.length, 0);
});

test("setDraft looks up the node id then mutates", async () => {
  for (const [flag, name] of [[true, "convertPullRequestToDraft"], [false, "markPullRequestReadyForReview"]]) {
    const { exec, calls } = recorder((cmd, args) => ok(queryOf({ args }).includes("mutation") ? `{"data":{"${name}":{"pullRequest":{"id":"PR_1"}}}}` : '{"data":{"repository":{"pullRequest":{"id":"PR_1"}}}}'));
    await githubProvider(exec, repo).setDraft(12, flag);
    assert.equal(calls.length, 2);
    assert.ok(queryOf(calls[0]).includes("pullRequest(number: 12)"));
    const q = queryOf(calls[1]);
    assert.ok(q.includes(name) && q.includes('pullRequestId: "PR_1"'));
  }
});

const reviewerReply = (stdout) => (cmd, args) => {
  if (args.includes("graphql")) return ok('{"data":{"repository":{"pullRequest":{"author":{"login":"alice"},"latestReviews":{"nodes":[{"author":{"login":"carol"}},{"author":{"login":"alice"}}]}}}}}');
  if (args.some((a) => a.endsWith("/requested_reviewers")) && !args.includes("-X")) return ok('{"users":[{"login":"bob"},{"login":"zed"}],"teams":[]}');
  return ok();
};
const writesOf = (calls) => calls.map((_, i) => callOf(calls, i)).filter((c) => c.method !== "GET" && c.endpoint);

test("setReviewers: a kept reviewer who already reviewed is not re-requested", async () => {
  const { exec, calls } = recorder(reviewerReply());
  await githubProvider(exec, repo).setReviewers(12, ["bob", "zed", "carol"]);
  assert.deepEqual(writesOf(calls), []);
});

test("setReviewers: a new login is POSTed", async () => {
  const { exec, calls } = recorder(reviewerReply());
  await githubProvider(exec, repo).setReviewers(12, ["bob", "zed", "carol", "dave"]);
  assert.deepEqual(writesOf(calls), [{ method: "POST", endpoint: "repos/acme/app/pulls/12/requested_reviewers", fields: ["reviewers[]=dave"] }]);
});

test("setReviewers: removing a requested reviewer DELETEs it; removing a reviewed one does nothing", async () => {
  const { exec, calls } = recorder(reviewerReply());
  await githubProvider(exec, repo).setReviewers(12, ["bob"]);
  assert.deepEqual(writesOf(calls), [{ method: "DELETE", endpoint: "repos/acme/app/pulls/12/requested_reviewers", fields: ["reviewers[]=zed"] }]);
});

test("setAssignees adds and removes the difference", async () => {
  const { exec, calls } = recorder((cmd, args) => (args.includes("-X") ? ok() : ok('{"assignees":[{"login":"alice"}]}')));
  await githubProvider(exec, repo).setAssignees(12, ["bob"]);
  assert.equal(calls.length, 3);
  assert.equal(callOf(calls, 0).endpoint, "repos/acme/app/issues/12");
  assert.deepEqual(callOf(calls, 1), { method: "POST", endpoint: "repos/acme/app/issues/12/assignees", fields: ["assignees[]=bob"] });
  assert.deepEqual(callOf(calls, 2), { method: "DELETE", endpoint: "repos/acme/app/issues/12/assignees", fields: ["assignees[]=alice"] });
});

test("setAssignees with the same list makes no writes", async () => {
  const { exec, calls } = recorder(() => ok('{"assignees":[{"login":"alice"}]}'));
  await githubProvider(exec, repo).setAssignees(12, ["alice"]);
  assert.equal(calls.length, 1);
});

test("searchUsers filters collaborators locally; defaultBranch", async () => {
  let { exec, calls } = recorder(() => ok('[{"login":"bob"},{"login":"Bobby"},{"login":"carol"}]'));
  const users = await githubProvider(exec, repo).searchUsers("bo");
  assert.deepEqual([...users].map((u) => ({ ...u })), [{ username: "bob", name: "" }, { username: "Bobby", name: "" }]);
  assert.ok(calls[0].args.some((a) => a.startsWith("repos/acme/app/collaborators")));
  ({ exec } = recorder(() => ok('{"default_branch":"main"}')));
  assert.equal(await githubProvider(exec, repo).defaultBranch(), "main");
});

test("createMr posts head/base/title/draft, requests reviewers, returns the MR", async () => {
  const { exec, calls } = recorder((cmd, args) => {
    if (args.includes("graphql")) return ok(fixture("github-pr-detail.json"));
    if (args.includes("repos/acme/app/pulls") && args.includes("POST")) return ok('{"number":12}');
    return detailReply(cmd, args);
  });
  const mr = await githubProvider(exec, repo).createMr({ source: "feat-12", target: "main", title: "Add widget", description: "D", draft: true, reviewers: ["bob"] });
  const all = calls.map((_, i) => callOf(calls, i));
  const post = all.find((c) => c.method === "POST" && c.endpoint === "repos/acme/app/pulls");
  assert.deepEqual(post.fields, ["head=feat-12", "base=main", "title=Add widget", "body=D", "draft=true"]);
  const rv = all.find((c) => c.endpoint === "repos/acme/app/pulls/12/requested_reviewers");
  assert.deepEqual(rv.fields, ["reviewers[]=bob"]);
  assert.equal(mr.number, 12);
});

test("createMr survives a failed reviewers request", async () => {
  const { exec } = recorder((cmd, args) => {
    if (args.includes("graphql")) return ok(fixture("github-pr-detail.json"));
    if (args.some((a) => a.endsWith("/requested_reviewers"))) return { code: 1, stdout: "", stderr: "HTTP 422" };
    if (args.includes("repos/acme/app/pulls") && args.includes("POST")) return ok('{"number":12}');
    return detailReply(cmd, args);
  });
  const mr = await githubProvider(exec, repo).createMr({ source: "feat-12", target: "main", title: "T", description: "", draft: false, reviewers: ["nobody"] });
  assert.equal(mr.number, 12);
});
