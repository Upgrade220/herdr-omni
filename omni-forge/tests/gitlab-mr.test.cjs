const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { load } = require("./load.cjs");
const { gitlabProvider, mrStateOf } = load(["forge/cli.js", "forge/model.js", "forge/gitlab.js"]);
const fixture = (n) => fs.readFileSync(path.join(__dirname, "fixtures", n), "utf8");

function recorder(reply) {
  const calls = [];
  const exec = async (cmd, args) => {
    if (args[0] === "auth") return { code: 0, stdout: "", stderr: "" };
    calls.push({ cmd, args });
    return reply(cmd, args);
  };
  return { exec, calls };
}
const ok = (stdout = "{}") => ({ code: 0, stdout, stderr: "" });
const repo = { host: "git.example.org", path: "grp/app" };
const D2 = "b".repeat(40);
const members = JSON.stringify([{ id: 7, username: "bob", name: "Bob B" }, { id: 8, username: "bobby", name: "Bobby" }]);

test("mrStateOf", () => {
  assert.equal(mrStateOf("opened"), "open");
  assert.equal(mrStateOf("OPEN"), "open");
  assert.equal(mrStateOf("merged"), "merged");
  assert.equal(mrStateOf("locked"), "closed");
  assert.equal(mrStateOf("CLOSED"), "closed");
});

test("MR queries don't ask for approvalsRequired (a paid-tier field; free GitLab rejects the whole query)", async () => {
  const { exec, calls } = recorder(() => ({ code: 0, stdout: fixture("gitlab-mrs.json"), stderr: "" }));
  await gitlabProvider(exec, repo).listMrs();
  assert.ok(calls.length && calls.every((c) => !c.args.join(" ").includes("approvalsRequired")));
});

test("listMrs maps the fixture", async () => {
  const { exec, calls } = recorder(() => ok(fixture("gitlab-mrs.json")));
  const p = gitlabProvider(exec, repo);
  assert.deepEqual({ ...p.capabilities.mr }, { revoke: true });
  const { me, mrs } = await p.listMrs();
  assert.equal(calls.length, 1);
  const q = calls[0].args.find((a) => a.startsWith("query="));
  assert.ok(q.includes("currentUser") && q.includes("UPDATED_DESC") && q.includes("first: 50"));
  assert.equal(me, "bob");
  assert.equal(mrs.length, 2);
  const a = mrs[0];
  assert.equal(a.number, 12);
  assert.equal(a.author, "alice");
  assert.equal(a.source, "feat-12");
  assert.equal(a.target, "main");
  assert.equal(a.draft, false);
  assert.equal(a.state, "open");
  assert.equal(a.url, "https://git.example.org/grp/app/-/merge_requests/12");
  assert.equal(a.pipeline, "manual");
  assert.equal(a.pipelineRunId, "1042");
  assert.equal(a.approvals, 1);
  assert.equal(a.approvalsRequired, null);
  assert.deepEqual([...a.approvedBy], ["carol"]);
  assert.deepEqual([...a.reviewers], ["bob"]);
  assert.deepEqual([...a.assignees], ["alice"]);
  assert.equal(a.unresolved, 3);
  assert.equal(a.headSha, "sha12");
  const b = mrs[1];
  assert.equal(b.draft, true);
  assert.equal(b.pipeline, null);
  assert.equal(b.pipelineRunId, null);
  assert.equal(b.approvalsRequired, null);
  assert.equal(b.unresolved, 0);
});

test("mrDetail keeps thread order, flags system notes, carries path/line", async () => {
  const { exec } = recorder(() => ok(fixture("gitlab-mr-detail.json")));
  const d = await gitlabProvider(exec, repo).mrDetail(12);
  assert.equal(d.mr.number, 12);
  assert.equal(d.mr.unresolved, 1);
  assert.equal(d.description, "Adds the widget.");
  assert.deepEqual([...d.threads.map((t) => t.id)], ["a".repeat(40), "b".repeat(40), "c".repeat(40)]);
  assert.equal(d.threads[0].notes[0].system, true);
  assert.equal(d.threads[0].resolvable, false);
  assert.equal(d.threads[1].path, "src/widget.js");
  assert.equal(d.threads[1].line, 7);
  assert.equal(d.threads[1].notes.length, 2);
  assert.equal(d.threads[1].notes[0].author, "bob");
  assert.equal(d.threads[1].notes[0].id, "2");
  assert.equal(d.threads[2].resolved, true);
  assert.equal(d.threads[2].path, null);
  assert.equal(d.threads[2].line, null);
  assert.deepEqual({ ...d.files[0] }, { path: "src/widget.js", add: 10, del: 2, status: "modified" });
});

const callOf = (calls, i = 0) => {
  const a = calls[i].args;
  const method = a.includes("-X") ? a[a.indexOf("-X") + 1] : "GET";
  const endpoint = a.find((x) => x.startsWith("projects/"));
  const fields = a.filter((x, j) => j > 0 && (a[j - 1] === "-f" || a[j - 1] === "-F") && !x.startsWith("query=") && !x.startsWith("p="));
  return { method, endpoint, fields: [...fields] };
};

test("simple writes call the expected method, endpoint and fields", async () => {
  const cases = [
    [(p) => p.approve(12), "POST", "projects/grp%2Fapp/merge_requests/12/approve", []],
    [(p) => p.unapprove(12), "POST", "projects/grp%2Fapp/merge_requests/12/unapprove", []],
    [(p) => p.comment(12, "hi"), "POST", "projects/grp%2Fapp/merge_requests/12/notes", ["body=hi"]],
    [(p) => p.reply(12, D2, "yo"), "POST", `projects/grp%2Fapp/merge_requests/12/discussions/${D2}/notes`, ["body=yo"]],
    [(p) => p.resolve(12, D2, true), "PUT", `projects/grp%2Fapp/merge_requests/12/discussions/${D2}`, ["resolved=true"]],
    [(p) => p.resolve(12, D2, false), "PUT", `projects/grp%2Fapp/merge_requests/12/discussions/${D2}`, ["resolved=false"]],
    [(p) => p.update(12, { title: "T" }), "PUT", "projects/grp%2Fapp/merge_requests/12", ["title=T"]],
    [(p) => p.update(12, { title: "T", description: "D" }), "PUT", "projects/grp%2Fapp/merge_requests/12", ["title=T", "description=D"]],
    [(p) => p.close(12), "PUT", "projects/grp%2Fapp/merge_requests/12", ["state_event=close"]],
    [(p) => p.reopen(12), "PUT", "projects/grp%2Fapp/merge_requests/12", ["state_event=reopen"]],
  ];
  for (const [fn, method, endpoint, fields] of cases) {
    const { exec, calls } = recorder(() => ok());
    assert.equal(await fn(gitlabProvider(exec, repo)), undefined);
    assert.equal(calls.length, 1);
    const c = callOf(calls);
    assert.equal(c.method, method);
    assert.equal(c.endpoint, endpoint);
    assert.deepEqual(c.fields, fields);
  }
});

test("setDraft uses the GraphQL mutation", async () => {
  const { exec, calls } = recorder(() => ok('{"data":{"mergeRequestSetDraft":{"errors":[]}}}'));
  await gitlabProvider(exec, repo).setDraft(12, true);
  const q = calls[0].args.find((a) => a.startsWith("query="));
  assert.ok(q.includes("mergeRequestSetDraft") && q.includes('projectPath: "grp/app"') && q.includes('iid: "12"') && q.includes("draft: true"));
});

test("setDraft surfaces mutation errors", async () => {
  const { exec } = recorder(() => ok('{"data":{"mergeRequestSetDraft":{"errors":["nope"]}}}'));
  await assert.rejects(gitlabProvider(exec, repo).setDraft(12, false), /nope/);
});

test("setReviewers resolves usernames to ids and replaces the list", async () => {
  const { exec, calls } = recorder((cmd, args) => (args.some((a) => a.includes("/members/all")) ? ok(members) : ok()));
  await gitlabProvider(exec, repo).setReviewers(12, ["bob"]);
  const lookup = callOf(calls, 0);
  assert.equal(lookup.method, "GET");
  assert.ok(lookup.endpoint.startsWith("projects/grp%2Fapp/members/all?query=bob"));
  const put = callOf(calls, 1);
  assert.equal(put.method, "PUT");
  assert.equal(put.endpoint, "projects/grp%2Fapp/merge_requests/12");
  assert.deepEqual(put.fields, ["reviewer_ids=[7]"]);
});

test("setAssignees with an empty list clears, unknown user fails", async () => {
  const { exec, calls } = recorder(() => ok(members));
  await gitlabProvider(exec, repo).setAssignees(12, []);
  assert.equal(calls.length, 1);
  assert.deepEqual(callOf(calls).fields, ["assignee_ids=[]"]);
  await assert.rejects(gitlabProvider(exec, repo).setAssignees(12, ["zed"]), /zed/);
});

test("searchUsers and defaultBranch", async () => {
  let { exec, calls } = recorder(() => ok(members));
  const users = await gitlabProvider(exec, repo).searchUsers("bo");
  assert.deepEqual([...users].map((u) => ({ ...u })), [{ username: "bob", name: "Bob B" }, { username: "bobby", name: "Bobby" }]);
  assert.ok(calls[0].args.some((a) => a.includes("members/all?query=bo")));
  ({ exec } = recorder(() => ok('{"data":{"project":{"repository":{"rootRef":"main"}}}}')));
  assert.equal(await gitlabProvider(exec, repo).defaultBranch(), "main");
});

test("createMr posts branches and a Draft: title, then returns the MR", async () => {
  const { exec, calls } = recorder((cmd, args) => {
    if (args.includes("graphql")) return ok(fixture("gitlab-mr-detail.json"));
    if (args.some((a) => a.includes("members/all"))) return ok(members);
    return ok('{"iid":12}');
  });
  const mr = await gitlabProvider(exec, repo).createMr({ source: "feat-12", target: "main", title: "Add widget", description: "D", draft: true, reviewers: ["bob"] });
  const post = calls.map((_, i) => callOf(calls, i)).find((c) => c.method === "POST");
  assert.equal(post.endpoint, "projects/grp%2Fapp/merge_requests");
  assert.deepEqual(post.fields, ["source_branch=feat-12", "target_branch=main", "title=Draft: Add widget", "description=D", "reviewer_ids=[7]"]);
  assert.equal(mr.number, 12);
});

test("createMr without draft keeps the title", async () => {
  const { exec, calls } = recorder((cmd, args) => (args.includes("graphql") ? ok(fixture("gitlab-mr-detail.json")) : ok('{"iid":12}')));
  await gitlabProvider(exec, repo).createMr({ source: "a", target: "main", title: "T", description: "", draft: false, reviewers: [] });
  const post = calls.map((_, i) => callOf(calls, i)).find((c) => c.method === "POST");
  assert.deepEqual(post.fields, ["source_branch=a", "target_branch=main", "title=T", "description="]);
});

test("mrDetail carries me (currentUser) and asks for the newest 100 discussions", async () => {
  const { exec, calls } = recorder(() => ok(fixture("gitlab-mr-detail.json")));
  const d = await gitlabProvider(exec, repo).mrDetail(12);
  assert.equal(d.me, "bob");
  assert.equal(d.olderThreads, false);
  const q = calls[0].args.find((a) => a.startsWith("query="));
  assert.ok(q.includes("currentUser{username}"));
  assert.ok(q.includes("discussions(last: 100){pageInfo{hasPreviousPage}"));
});

test("mrDetail olderThreads follows discussions.pageInfo.hasPreviousPage", async () => {
  const data = JSON.parse(fixture("gitlab-mr-detail.json"));
  data.data.project.mergeRequest.discussions.pageInfo = { hasPreviousPage: true };
  const { exec } = recorder(() => ok(JSON.stringify(data)));
  assert.equal((await gitlabProvider(exec, repo).mrDetail(12)).olderThreads, true);
});
