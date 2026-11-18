const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { load } = require("./load.cjs");
const { gitlabProvider, chipOf } = load(["forge/cli.js", "forge/model.js", "forge/gitlab.js"]);
const { execFile } = require("node:child_process");
const os = require("node:os");
const fixture = (n) => fs.readFileSync(path.join(__dirname, "fixtures", n), "utf8");

function recorder(reply) {
  const calls = [];
  const exec = async (cmd, args, opts) => {
    if (args[0] === "auth") return { code: 0, stdout: "", stderr: "" }; // glab auth status: logged in
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
  assert.equal(runs[0].branch, "feat-x");
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
  const q = calls[0].args.find((a) => a.startsWith("query="));
  assert.ok(q.includes("sourceBranches") && q.includes("opened") && q.includes("ref:"));
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

test("listRuns dedupes a branch pipeline that is also an MR pipeline and keeps request", async () => {
  const { exec } = recorder(() => ({ code: 0, stdout: fixture("gitlab-list-dedup.json"), stderr: "" }));
  const runs = await gitlabProvider(exec, repo).listRuns({ branch: "feat-x" });
  assert.equal(runs.length, 2);
  const r = runs.find((x) => x.id === "1042");
  assert.equal(r.request, 12);
  assert.equal(r.branch, "feat-x");
});

test("listRuns without a branch sends no ref or mergeRequests and maps warnings to success", async () => {
  const { exec, calls } = recorder(() => ({ code: 0, stdout: fixture("gitlab-list-all.json"), stderr: "" }));
  const runs = await gitlabProvider(exec, repo).listRuns({ branch: null });
  assert.equal(runs.length, 1);
  assert.equal(runs[0].status, "success");
  assert.equal(runs[0].branch, "main");
  assert.equal(runs[0].request, null);
  const q = calls[0].args.find((a) => a.startsWith("query="));
  assert.ok(!q.includes("mergeRequests(") && !q.includes("ref:"));
});

test("CANCELING maps to running", async () => {
  const body = JSON.parse(fixture("gitlab-list-all.json"));
  body.data.project.pipelines.nodes[0].status = "CANCELING";
  const { exec } = recorder(() => ({ code: 0, stdout: JSON.stringify(body), stderr: "" }));
  assert.equal((await gitlabProvider(exec, repo).listRuns({})) [0].status, "running");
});

test("jobLog compares bytes, not characters, and drops a broken leading char", async () => {
  const fake = "\uFFFD" + "ы".repeat(5); // tail -c 11 of a Cyrillic log: 1 cut byte + 10 bytes
  const { exec } = recorder(() => ({ code: 0, stdout: fake, stderr: "" }));
  const r = await gitlabProvider(exec, repo).jobLog("70", { maxBytes: 10 });
  assert.equal(r.truncated, true);
  assert.equal(r.text, "ы".repeat(5));
  const fit = await gitlabProvider(recorder(() => ({ code: 0, stdout: "ы".repeat(5), stderr: "" })).exec, repo).jobLog("70", { maxBytes: 10 });
  assert.equal(fit.truncated, false);
});

test("sh failures keep status and hints", async () => {
  const { exec } = recorder(() => ({ code: 1, stdout: "", stderr: "HTTP 401 Unauthorized" }));
  await assert.rejects(gitlabProvider(exec, repo).jobLog("70", { maxBytes: 10 }), (e) => e.status === 401 && e.hint.includes("glab auth login --hostname git.example.org"));
  const slow = async () => { throw new Error("command timed out"); };
  await assert.rejects(gitlabProvider(slow, repo).jobLog("70", { maxBytes: 10 }), (e) => /timed out/.test(e.hint));
});

// Real scripts against a fake glab on PATH.
function realExec(binDir) {
  return (cmd, args) => new Promise((resolve) => {
    execFile(cmd, args, { env: { ...process.env, PATH: binDir + ":" + process.env.PATH } }, (e, stdout, stderr) =>
      resolve({ code: e ? (typeof e.code === "number" ? e.code : 1) : 0, stdout, stderr }));
  });
}
function fakeGlab(body) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fg-"));
  fs.writeFileSync(path.join(dir, "glab"), "#!/bin/sh\n[ \"$1\" = auth ] && exit 0\n" + body + "\n", { mode: 0o755 });
  return dir;
}

test("real jobLog script: a failing glab is an error, not an empty log", async () => {
  const bin = fakeGlab('echo "HTTP 404 Not Found" >&2; exit 1');
  await assert.rejects(gitlabProvider(realExec(bin), repo).jobLog("70", { maxBytes: 10 }), (e) => e.status === 404);
});

test("real jobLog script: tails bytes and flags truncation", async () => {
  const bin = fakeGlab("printf '0123456789ABCDEF'");
  const r = await gitlabProvider(realExec(bin), repo).jobLog("70", { maxBytes: 10 });
  assert.equal(r.truncated, true);
  assert.equal(r.text, "6789ABCDEF");
});

test("real downloadArtifact script: failure removes the partial file", async () => {
  const bin = fakeGlab('printf partial; echo "HTTP 403" >&2; exit 1');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dl-"));
  await assert.rejects(gitlabProvider(realExec(bin), repo).downloadArtifact({ name: "archive.zip", jobId: "70" }, dir), (e) => e.status === 403);
  assert.deepEqual([...fs.readdirSync(dir)], []);
  const ok = fakeGlab("printf zipdata");
  const out = await gitlabProvider(realExec(ok), repo).downloadArtifact({ name: "archive.zip", jobId: "70" }, dir);
  assert.equal(fs.readFileSync(out, "utf8"), "zipdata");
  const empty = fakeGlab("true");
  await assert.rejects(gitlabProvider(realExec(empty), repo).downloadArtifact({ name: "archive.zip", jobId: "70" }, dir), (e) => e.name === "ForgeError");
  assert.equal(fs.existsSync(out), false);
});

// glab auth status gates every GitLab call; the result is cached per host once it succeeds.
function authExec(authCode, reply = () => ({ code: 0, stdout: fixture("gitlab-list-all.json"), stderr: "" })) {
  const calls = [];
  const state = { authCode };
  const exec = async (cmd, args) => {
    calls.push({ cmd, args });
    if (args[0] === "auth") return { code: state.authCode, stdout: "", stderr: state.authCode ? "x could not authenticate" : "" };
    return reply(cmd, args);
  };
  return { exec, calls, state };
}

test("glab auth failure: Not logged in with the login command, no API call", async () => {
  const { exec, calls } = authExec(1);
  await assert.rejects(gitlabProvider(exec, { host: "gl.one", path: "g/p" }).listRuns({}), (e) => {
    assert.equal(e.name, "ForgeError");
    assert.equal(e.message, "Not logged in to gl.one");
    assert.equal(e.hint, "glab auth login --hostname gl.one");
    return true;
  });
  assert.deepEqual(calls.map((c) => c.args.slice(0, 2).join(" ")), ["auth status"]);
  assert.ok(calls[0].args.includes("--hostname") && calls[0].args.includes("gl.one"));
});

test("glab auth status runs once per host, and again after a failure", async () => {
  const { exec, calls, state } = authExec(1);
  const p = gitlabProvider(exec, { host: "gl.two", path: "g/p" });
  await assert.rejects(p.listRuns({}));
  state.authCode = 0;
  await p.listRuns({});
  await gitlabProvider(exec, { host: "gl.two", path: "g/q" }).listRuns({});
  await p.retryRun("1");
  const auths = calls.filter((c) => c.args[0] === "auth").length;
  assert.equal(auths, 2);
  await gitlabProvider(exec, { host: "gl.three", path: "g/p" }).listRuns({});
  assert.equal(calls.filter((c) => c.args[0] === "auth").length, 3);
});

test("null project: hint names the login command", async () => {
  const { exec } = recorder(() => ({ code: 0, stdout: JSON.stringify({ data: { project: null } }), stderr: "" }));
  await assert.rejects(gitlabProvider(exec, repo).listRuns({}), (e) => e.message === "Project not found" && e.hint.includes("glab auth login --hostname git.example.org"));
});

test("Forbidden without an HTTP code: hint names the login command", async () => {
  const gql = recorder(() => ({ code: 0, stdout: JSON.stringify({ errors: [{ message: "Forbidden" }] }), stderr: "" }));
  await assert.rejects(gitlabProvider(gql.exec, repo).listRuns({}), (e) => e.hint.includes("glab auth login --hostname git.example.org"));
  const bare = recorder(() => ({ code: 1, stdout: "", stderr: "Forbidden" }));
  await assert.rejects(gitlabProvider(bare.exec, repo).listRuns({}), (e) => e.hint.includes("glab auth login --hostname git.example.org"));
});
