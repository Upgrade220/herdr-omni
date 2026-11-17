const { test } = require("node:test");
const assert = require("node:assert/strict");
const { load } = require("./load.cjs");
const { parseRemote, forgeKind, detectRepo, cli, ForgeError } = load(["forge/detect.js", "forge/cli.js"]);

test("parseRemote handles scp-style, ssh:// and https remotes", () => {
  assert.deepEqual({ ...parseRemote("git@git.example.org:grp/sub/app.git") }, { host: "git.example.org", path: "grp/sub/app" });
  assert.deepEqual({ ...parseRemote("https://github.com/o/r") }, { host: "github.com", path: "o/r" });
  assert.deepEqual({ ...parseRemote("https://github.com/o/r.git") }, { host: "github.com", path: "o/r" });
  assert.deepEqual({ ...parseRemote("ssh://git@h.example:2222/a/b.git") }, { host: "h.example", path: "a/b" });
});

test("parseRemote returns null for garbage", () => {
  assert.equal(parseRemote("garbage"), null);
  assert.equal(parseRemote(""), null);
});

test("forgeKind", () => {
  assert.equal(forgeKind("github.com"), "github");
  assert.equal(forgeKind("git.example.org"), "gitlab");
});

const fake = (replies) => async (cmd, args, opts) => {
  const key = args.join(" ");
  const r = replies[key];
  if (!r) return { code: 1, stdout: "", stderr: "unexpected " + key };
  return r;
};

test("detectRepo: not a repository", async () => {
  const exec = fake({ "remote get-url origin": { code: 128, stdout: "", stderr: "fatal: not a git repository (or any of the parent directories): .git" } });
  assert.equal((await detectRepo("/x", "m", exec)).error, "Not a Git repository");
});

test("detectRepo: no remotes", async () => {
  const exec = fake({
    "remote get-url origin": { code: 2, stdout: "", stderr: "error: No such remote 'origin'" },
    "remote": { code: 0, stdout: "\n", stderr: "" },
  });
  assert.match((await detectRepo("/x", "m", exec)).error, /remote/i);
});

test("detectRepo: origin, and fallback to first remote", async () => {
  const ok = fake({ "remote get-url origin": { code: 0, stdout: "git@git.example.org:grp/app.git\n", stderr: "" } });
  const r = await detectRepo("/x", "m", ok);
  assert.equal(r.kind, "gitlab");
  assert.equal(r.host, "git.example.org");
  assert.equal(r.path, "grp/app");
  const fb = fake({
    "remote get-url origin": { code: 2, stdout: "", stderr: "error: No such remote 'origin'" },
    "remote": { code: 0, stdout: "up\nother\n", stderr: "" },
    "remote get-url up": { code: 0, stdout: "https://github.com/o/r.git\n", stderr: "" },
  });
  const f = await detectRepo("/x", "m", fb);
  assert.equal(f.kind, "github");
  assert.equal(f.path, "o/r");
});

test("detectRepo passes cwd and machine to exec", async () => {
  let seen;
  const exec = async (cmd, args, opts) => ((seen = [cmd, opts]), { code: 0, stdout: "https://github.com/o/r\n", stderr: "" });
  await detectRepo("/work", "box", exec);
  assert.equal(seen[0], "git");
  assert.equal(seen[1].cwd, "/work");
  assert.equal(seen[1].on, "box");
});

test("cli maps auth failures to a login hint", async () => {
  const exec = async () => ({ code: 1, stdout: "", stderr: "401 Unauthorized" });
  await assert.rejects(cli(exec, "gitlab", "git.example.org", ["api", "x"]), (e) => {
    assert.ok(e instanceof ForgeError);
    assert.equal(e.hint, "glab auth login --hostname git.example.org");
    assert.equal(e.status, 401);
    return true;
  });
  const gh = async () => ({ code: 1, stdout: "", stderr: "You are not logged into any GitHub hosts" });
  await assert.rejects(cli(gh, "github", "github.com", ["x"]), (e) => e.hint === "gh auth login");
});

test("cli maps 403, 404, 429", async () => {
  for (const [stderr, status] of [["HTTP 403: Forbidden", 403], ["404 Not Found", 404], ["HTTP 429 Too Many Requests", 429]]) {
    const exec = async () => ({ code: 1, stdout: "", stderr });
    await assert.rejects(cli(exec, "github", "github.com", ["x"]), (e) => e.status === status && e.hint.length > 0);
  }
});

test("cli runs gh/glab, parses JSON, returns raw, default timeout", async () => {
  let seen;
  const exec = async (cmd, args, opts) => ((seen = { cmd, args, opts }), { code: 0, stdout: '{"a":1}', stderr: "" });
  assert.equal((await cli(exec, "gitlab", "h", ["api", "p"])).a, 1);
  assert.equal(seen.cmd, "glab");
  assert.equal(seen.opts.timeout, 30000);
  assert.equal(await cli(exec, "github", "github.com", ["run", "view"], { raw: true }), '{"a":1}');
  assert.equal(seen.cmd, "gh");
});

test("cli: unknown failure keeps status null", async () => {
  const exec = async () => ({ code: 1, stdout: "", stderr: "boom" });
  await assert.rejects(cli(exec, "github", "github.com", []), (e) => e.status === null && e.message.includes("boom"));
});

test("detectRepo: unreachable machine returns an error result", async () => {
  const exec = async () => { throw new Error("machine offline"); };
  const r = await detectRepo("/x", "box", exec);
  assert.equal(r.error, "Cannot reach machine");
  assert.match(r.hint, /machine offline/);
});

test("cli: rejected exec becomes a ForgeError with install or timeout hint", async () => {
  const missing = async () => { throw new Error("No such file or directory: glab"); };
  await assert.rejects(cli(missing, "gitlab", "h", []), (e) => e instanceof ForgeError && e.status === null && /Install/.test(e.hint) && /glab/.test(e.hint));
  const slow = async () => { throw new Error("command timed out"); };
  await assert.rejects(cli(slow, "github", "github.com", []), (e) => e instanceof ForgeError && /timed out/.test(e.hint));
});
