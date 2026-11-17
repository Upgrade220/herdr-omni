const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { load } = require("./load.cjs");
const { gitlabProvider, chipOf } = load(["forge/cli.js", "forge/model.js", "forge/gitlab.js"]);
const fixture = (n) => fs.readFileSync(path.join(__dirname, "fixtures", n), "utf8");

function recorder(reply) {
  const calls = [];
  const exec = async (cmd, args, opts) => {
    calls.push({ cmd, args });
    return reply(cmd, args);
  };
  return { exec, calls };
}
const repo = { host: "git.example.org", path: "grp/app" };

test("listRuns on a branch merges branch and MR pipelines, newest first", async () => {
  const { exec, calls } = recorder(() => ({ code: 0, stdout: fixture("gitlab-list-branch.json"), stderr: "" }));
  const runs = await gitlabProvider(exec, repo).listRuns({ branch: "feat-x" });
  assert.equal(runs.length, 2);
  assert.deepEqual([...runs.map((r) => r.number)], [42, 41]);
  assert.equal(runs[0].request, 12);
  assert.equal(runs[0].status, "manual");
  assert.equal(runs[0].id, "1042");
  assert.equal(runs[0].author, "bob");
  assert.equal(runs[0].title, "Fix widget");
  assert.equal(runs[0].durationSec, null);
  assert.equal(runs[1].durationSec, 120);
  assert.equal(runs[0].url, "https://git.example.org/grp/app/-/pipelines/1042");
  assert.equal(calls[0].cmd, "glab");
  assert.ok(calls[0].args.includes("p=grp/app"));
  assert.ok(calls[0].args.some((a) => a.startsWith("query=") && a.includes("mergeRequests")));
});

test("chipOf", () => {
  assert.equal(chipOf("manual"), "other");
  assert.equal(chipOf("pending"), "running");
  assert.equal(chipOf("running"), "running");
  assert.equal(chipOf("success"), "passed");
  assert.equal(chipOf("failed"), "failed");
});

test("runDetail groups jobs by stage in order", async () => {
  const { exec } = recorder(() => ({ code: 0, stdout: fixture("gitlab-detail.json"), stderr: "" }));
  const d = await gitlabProvider(exec, repo).runDetail("1042");
  assert.deepEqual([...d.groups.map((g) => g.name)], ["build", "deploy"]);
  assert.equal(d.groups[1].jobs[0].manual, true);
  assert.equal(d.groups[1].jobs[0].allowFailure, true);
  assert.equal(d.groups[1].jobs[0].status, "manual");
  assert.equal(d.groups[0].jobs[0].group, "build");
  assert.equal(d.groups[0].jobs[0].id, "gid://gitlab/Ci::Build/70");
  assert.equal(d.run.request, null);
  assert.equal(d.artifacts.length, 1);
  assert.equal(d.artifacts[0].jobId, "gid://gitlab/Ci::Build/70");
  assert.equal(d.artifacts[0].sizeBytes, 2048);
});

test("playJob posts to the REST endpoint", async () => {
  const { exec, calls } = recorder(() => ({ code: 0, stdout: "{}", stderr: "" }));
  await gitlabProvider(exec, repo).playJob("gid://gitlab/Ci::Build/77");
  const a = calls[0].args;
  assert.ok(a.includes("projects/grp%2Fapp/jobs/77/play"));
  assert.equal(a[a.indexOf("-X") + 1], "POST");
});

test("pipeline actions use the numeric id", async () => {
  const { exec, calls } = recorder(() => ({ code: 0, stdout: "{}", stderr: "" }));
  const p = gitlabProvider(exec, repo);
  await p.retryRun("1042");
  await p.cancelRun("1042");
  assert.ok(calls[0].args.includes("projects/grp%2Fapp/pipelines/1042/retry"));
  assert.ok(calls[1].args.includes("projects/grp%2Fapp/pipelines/1042/cancel"));
});

test("jobLog flags truncation", async () => {
  const { exec, calls } = recorder(() => ({ code: 0, stdout: "x".repeat(11), stderr: "" }));
  const r = await gitlabProvider(exec, repo).jobLog("gid://gitlab/Ci::Build/70", { maxBytes: 10 });
  assert.equal(r.truncated, true);
  assert.equal(r.text.length, 10);
  assert.equal(r.available, true);
  assert.equal(calls[0].cmd, "sh");
  assert.ok(calls[0].args.includes("projects/grp%2Fapp/jobs/70/trace"));
  assert.ok(calls[0].args.includes("11"));
  const ok = await gitlabProvider(recorder(() => ({ code: 0, stdout: "abc", stderr: "" })).exec, repo).jobLog("70", { maxBytes: 10 });
  assert.equal(ok.truncated, false);
});

test("jobLog wraps failures in ForgeError", async () => {
  const { exec } = recorder(() => ({ code: 1, stdout: "", stderr: "HTTP 404 Not Found" }));
  await assert.rejects(gitlabProvider(exec, repo).jobLog("70", { maxBytes: 10 }), (e) => e.name === "ForgeError" && e.status === 404);
  const bad = async () => { throw new Error("spawn sh ENOENT"); };
  await assert.rejects(gitlabProvider(bad, repo).jobLog("70", { maxBytes: 10 }), (e) => e.name === "ForgeError");
});

test("downloadArtifact writes a zip named after project, job and artifact", async () => {
  const { exec, calls } = recorder(() => ({ code: 0, stdout: "", stderr: "" }));
  const out = await gitlabProvider(exec, repo).downloadArtifact({ id: "70:archive.zip", name: "archive.zip", jobId: "gid://gitlab/Ci::Build/70" }, "/tmp/dl");
  assert.equal(out, "/tmp/dl/app-70-archive.zip");
  assert.ok(calls[0].args.includes("projects/grp%2Fapp/jobs/70/artifacts"));
  assert.ok(calls[0].args.includes("/tmp/dl/app-70-archive.zip"));
});

test("capabilities", () => {
  assert.deepEqual({ ...gitlabProvider(async () => ({}), repo).capabilities }, { play: true, retryFailed: false, liveLog: true });
});
