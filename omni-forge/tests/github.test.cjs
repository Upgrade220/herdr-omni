const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { execFile } = require("node:child_process");
const { load } = require("./load.cjs");
const { githubProvider, ForgeError } = load(["forge/cli.js", "forge/model.js", "forge/github.js"]);
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

test("listRuns maps fields", async () => {
  const { exec, calls } = recorder(() => ok(fixture("github-runs.json")));
  const runs = await githubProvider(exec, repo).listRuns({ limit: 10 });
  assert.equal(calls[0].cmd, "gh");
  assert.ok(calls[0].args.includes("repos/acme/app/actions/runs?per_page=10"));
  assert.equal(runs.length, 2);
  const r = runs[0];
  assert.equal(r.id, "9002");
  assert.equal(r.number, 15);
  assert.equal(r.title, "Add widget");
  assert.equal(r.branch, "feat-x");
  assert.equal(r.status, "running");
  assert.equal(r.trigger, "pull_request");
  assert.equal(r.author, "bob");
  assert.equal(r.durationSec, 120);
  assert.equal(r.request, 7);
  assert.equal(r.attempt, 2);
  assert.equal(r.url, "https://github.com/acme/app/actions/runs/9002");
  assert.equal(runs[1].request, null);
  assert.equal(runs[1].status, "success");
  assert.equal(runs[1].durationSec, 90);
});

test("listRuns branch is passed and encoded", async () => {
  const { exec, calls } = recorder(() => ok('{"workflow_runs":[]}'));
  await githubProvider(exec, repo).listRuns({ branch: "main" });
  assert.ok(calls[0].args.some((a) => a.includes("branch=main")));
  await githubProvider(exec, repo).listRuns({ branch: "feat/x y" });
  assert.ok(calls[1].args.some((a) => a.includes("branch=feat%2Fx%20y")));
});

test("status and conclusion mapping", async () => {
  const table = [
    ["in_progress", null, "running"], ["queued", null, "pending"], ["waiting", null, "pending"],
    ["requested", null, "pending"], ["pending", null, "pending"],
    ["completed", "success", "success"], ["completed", "failure", "failed"],
    ["completed", "cancelled", "canceled"], ["completed", "skipped", "skipped"],
    ["completed", "timed_out", "failed"], ["completed", "startup_failure", "failed"],
    ["completed", "action_required", "other"], ["completed", "neutral", "other"],
  ];
  for (const [status, conclusion, want] of table) {
    const body = JSON.stringify({ workflow_runs: [{ id: 1, status, conclusion, actor: {}, pull_requests: [] }] });
    const { exec } = recorder(() => ok(body));
    const [r] = await githubProvider(exec, repo).listRuns();
    assert.equal(r.status, want, `${status}/${conclusion}`);
  }
});

test("runDetail: one group per job with steps, plus artifacts", async () => {
  const { exec, calls } = recorder((cmd, args) => {
    const p = args.join(" ");
    if (p.includes("/jobs")) return ok(fixture("github-jobs.json"));
    if (p.includes("/artifacts")) return ok(fixture("github-artifacts.json"));
    return ok(fixture("github-run.json"));
  });
  const d = await githubProvider(exec, repo).runDetail("9002");
  assert.ok(calls.some((c) => c.args.includes("repos/acme/app/actions/runs/9002/jobs?per_page=100")));
  assert.equal(d.run.id, "9002");
  assert.deepEqual([...d.groups.map((g) => g.name)], ["build", "deploy"]);
  const job = d.groups[0].jobs[0];
  assert.equal(job.id, "501");
  assert.equal(job.group, "build");
  assert.equal(job.status, "success");
  assert.equal(job.durationSec, 60);
  assert.equal(job.steps.length, 2);
  assert.equal(job.steps[1].status, "failed");
  assert.equal(job.steps[1].durationSec, 45);
  assert.equal(d.groups[1].jobs[0].status, "pending");
  assert.equal(d.groups[1].jobs[0].durationSec, null);
  assert.equal(d.artifacts.length, 1);
  assert.equal(d.artifacts[0].name, "dist");
  assert.equal(d.artifacts[0].sizeBytes, 4096);
  assert.equal(d.artifacts[0].jobId, null);
});

test("jobLog runs gh run view --log and returns the tail", async () => {
  const { exec, calls } = recorder(() => ok("56789"));
  const r = await githubProvider(exec, repo).jobLog("501", { maxBytes: 4 });
  assert.equal(calls[0].cmd, "sh");
  assert.ok(calls[0].args.includes("501") && calls[0].args.includes("github.com/acme/app"));
  assert.ok(calls[0].args.some((a) => a.includes("gh run view")));
  assert.equal(r.available, true);
  assert.equal(r.text, "6789");
  assert.equal(r.truncated, true);
});

test("jobLog 404 means not available", async () => {
  const { exec } = recorder(() => ({ code: 1, stdout: "", stderr: "gh: Not Found (HTTP 404)" }));
  const r = await githubProvider(exec, repo).jobLog("501");
  assert.deepEqual({ ...r }, { text: "", truncated: false, available: false });
});

test("jobLog other errors still throw", async () => {
  const { exec } = recorder(() => ({ code: 1, stdout: "", stderr: "HTTP 403" }));
  await assert.rejects(() => githubProvider(exec, repo).jobLog("501"), (e) => e.status === 403);
});

test("actions hit the right endpoints", async () => {
  const { exec, calls } = recorder(() => ok());
  const p = githubProvider(exec, repo);
  await p.retryRun("5");
  await p.retryRun(5, { failedOnly: true });
  await p.retryJob("501");
  await p.cancelRun("5");
  const eps = calls.map((c) => c.args.find((a) => a.startsWith("repos/")));
  assert.deepEqual(eps, [
    "repos/acme/app/actions/runs/5/rerun",
    "repos/acme/app/actions/runs/5/rerun-failed-jobs",
    "repos/acme/app/actions/jobs/501/rerun",
    "repos/acme/app/actions/runs/5/cancel",
  ]);
  for (const c of calls) assert.equal(c.args[c.args.indexOf("-X") + 1], "POST");
});

test("playJob is unsupported; capabilities", async () => {
  const p = githubProvider(async () => ok(), repo);
  await assert.rejects(() => p.playJob("1"), (e) => e.message === "Not supported on GitHub");
  assert.deepEqual({ ...p.capabilities }, { play: false, retryFailed: true, liveLog: false });
});

test("non-github host uses --hostname and -R host/path", async () => {
  const { exec, calls } = recorder(() => ok('{"workflow_runs":[]}'));
  const p = githubProvider(exec, { host: "ghe.example.org", path: "acme/app" });
  await p.listRuns();
  assert.ok(calls[0].args.join(" ").includes("--hostname ghe.example.org"));
});

function fakeGh(body) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fgh-"));
  fs.writeFileSync(path.join(dir, "gh"), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
  return dir;
}
const realExec = (binDir) => (cmd, args) =>
  new Promise((resolve) =>
    execFile(cmd, args, { env: { ...process.env, PATH: binDir + ":" + process.env.PATH } }, (e, stdout, stderr) =>
      resolve({ code: e ? (typeof e.code === "number" ? e.code : 1) : 0, stdout, stderr })));

test("real jobLog script strips the job/step prefix and tails", async () => {
  const bin = fakeGh("printf 'build\\tRun tests\\t\\357\\273\\277line one\\nbuild\\tRun tests\\t\\357\\273\\277line two\\n'");
  const p = githubProvider(realExec(bin), repo);
  const full = await p.jobLog("5");
  assert.equal(full.text, "line one\nline two\n");
  assert.equal(full.truncated, false);
  const cut = await p.jobLog("5", { maxBytes: 5 });
  assert.equal(cut.truncated, true);
  assert.equal(cut.text, "two\n");
  assert.ok(Buffer.byteLength(cut.text) <= 5);
});

test("real jobLog script: job still in progress is unavailable", async () => {
  const bin = fakeGh('echo "job 5 is still in progress; logs will be available when it is complete" >&2; exit 1');
  const r = await githubProvider(realExec(bin), repo).jobLog("5");
  assert.deepEqual({ ...r }, { text: "", truncated: false, available: false });
});

test("real jobLog script: other failures throw with a hint", async () => {
  const bin = fakeGh('echo "boom" >&2; exit 1');
  await assert.rejects(() => githubProvider(realExec(bin), repo).jobLog("5"), (e) => e.message === "boom" && e.hint.length > 0);
});

test("real jobLog script maps 404 to unavailable", async () => {
  const bin = fakeGh('echo "gh: Not Found (HTTP 404)" >&2; exit 1');
  const r = await githubProvider(realExec(bin), repo).jobLog("5");
  assert.equal(r.available, false);
});

test("downloadArtifact calls gh run download and returns the directory", async () => {
  const bin = fakeGh('echo "$@" > "$GH_OUT"');
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "fgo-")), "args");
  process.env.GH_OUT = out;
  const a = { id: "9002:dist", name: "dist", sizeBytes: 1, jobId: null };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fgd-"));
  const res = await githubProvider(realExec(bin), repo).downloadArtifact(a, dir);
  delete process.env.GH_OUT;
  assert.equal(res, `${dir}/app-9002-dist`);
  assert.equal(fs.readFileSync(out, "utf8").trim(), `run download 9002 -R github.com/acme/app -n dist -D ${dir}/app-9002-dist`);
});
