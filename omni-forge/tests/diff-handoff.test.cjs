// actions/diff.js: the copy of git-graph's Diff hand-off, and openMrFile with herdr stubbed.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { load } = require("./load.cjs");

const plain = (x) => JSON.parse(JSON.stringify(x)); // objects from the vm context have another prototype
const spaces = [{ id: "s1", tabs: [{ id: "A" }, { id: "G" }] }, { id: "s2", tabs: [{ id: "B" }] }];

function setup({ exec, focus = { space: "s1" }, shared = {}, machineHome = "/home/remote", local = true } = {}) {
  const env = { shared: { ...shared }, runs: [], execs: [], ensures: [], ensureResult: null };
  const files = ["forge/mr-cache.js", "views/mrs.js", "actions/diff.js"];
  const stubExec = async (cmd, args, opts = {}) => {
    env.execs.push({ cmd, args, on: opts.on });
    if (exec) { const r = await exec(cmd, args, opts); if (r) return r; }
    if (cmd === "git" && args.includes("--show-toplevel")) return { code: 0, stdout: "/w/repo\n", stderr: "" };
    if (cmd === "git" && args.includes("get-url")) return { code: 0, stdout: "https://git.example.org/group/app.git\n", stderr: "" };
    if (cmd === "sh" && args[1] === 'printf %s "$HOME"') return { code: 0, stdout: machineHome, stderr: "" };
    return { code: 0, stdout: "", stderr: "" };
  };
  const mod = load(files, {
    exec: stubExec,
    appHome: () => "/app",
    focused: () => env.focus ?? focus,
    spaces: () => spaces,
    shared: (k) => env.shared[k],
    setShared: (k, v) => { env.shared[k] = v; },
    run: (name, args) => env.runs.push([name, args]),
    ensureMr: undefined,
  });
  env.focus = focus;
  return { mod, env };
}

// Stubbing ensureMr: the real one drives git through exec, so make exec answer like a healthy cache.
function healthyExec(fail) {
  return async (cmd, args) => {
    if (fail && cmd === "git" && args.includes("fetch")) return { code: 1, stdout: "", stderr: "fatal: unable to access 'https://git.example.org/': Could not resolve host" };
    if (cmd === "git" && args.includes("--git-common-dir")) return { code: 0, stdout: "/w/repo/.git\n", stderr: "" };
    return null;
  };
}

const repo = { kind: "gitlab", host: "git.example.org", path: "group/app", url: "https://git.example.org/group/app.git" };
const mr = { number: 7, target: "main" };

test("the keys and the plan are git-graph's", async () => {
  const { mod } = setup();
  const place = path.join(__dirname, "../../git-graph/mods/git-graph/place.js");
  if (!fs.existsSync(place)) return;
  const g = await import(pathToFileURL(place).href);
  assert.equal(mod.DIFF_TABS, g.DIFF_TABS);
  assert.equal(mod.DIFF_OPEN, g.DIFF_OPEN);
  assert.equal(mod.PENDING_MS, g.PENDING_MS);
  const target = { root: "/r", on: null, path: "a/b c.js", source: "range" };
  const pending = { s1: { target, at: 100, pendingTab: { at: 100, before: ["A"] } } };
  const cases = [
    { map: { s1: "G" }, open: {}, spaceId: "s1", now: 1 },
    { map: { s1: "gone" }, open: {}, spaceId: "s1", now: 1 },
    { map: undefined, open: undefined, spaceId: "s1", now: 1 },
    { map: {}, open: pending, spaceId: "s1", now: 100 + g.PENDING_MS - 1 },
    { map: {}, open: pending, spaceId: "s1", now: 100 + g.PENDING_MS },
    { map: {}, open: pending, spaceId: "s2", now: 101 },
    { map: {}, open: {}, spaceId: "nowhere", now: 1 },
  ];
  for (const c of cases) assert.deepEqual(plain(mod.openDiffPlan({ ...c, spaces, target })), g.openDiffPlan({ ...c, spaces, target }), JSON.stringify(c));
  for (const [map, id] of [[{ s1: "G" }, "s1"], [{ s1: "x" }, "s1"], [undefined, "s1"]]) {
    assert.equal(mod.diffTabOf(map, spaces, id), g.diffTabOf(map, spaces, id));
  }
});

test("openMrFile hands a range target over: gitDir is the cache dir, refs are MR_REFS(n)", async () => {
  const { mod, env } = setup({ exec: healthyExec() });
  const res = await mod.openMrFile({ repo, loc: { cwd: "/w/repo/src", machine: null }, mr, path: "src/cart.js" });
  assert.deepEqual(plain(res), { ok: true });
  const open = env.shared[mod.DIFF_OPEN].s1;
  assert.deepEqual(plain(open.target), {
    root: "/w/repo", on: null, path: "src/cart.js", source: "range",
    gitDir: "/app/data/omni-forge/mr-cache/git.example.org/group/app.git",
    base: "refs/omni-forge/mr/7/base", head: "refs/omni-forge/mr/7/head",
    label: "!7 · src/cart.js",
  });
  assert.deepEqual(plain(env.runs), [["tab.new", { name: "cart.js", mod: "git-graph", props: { view: "diff" } }]]);
});

test("a live Diff tab is selected instead of a new one", async () => {
  const { mod, env } = setup({ exec: healthyExec(), shared: { "git-graph.diff-tabs": { s1: "G" } } });
  await mod.openMrFile({ repo, loc: { cwd: "/w/repo", machine: null }, mr, path: "a.js" });
  assert.deepEqual(plain(env.runs), [["tab.select", { id: "G" }]]);
});

test("a fetch failure returns { ok:false, error } and leaves DIFF_OPEN alone", async () => {
  const { mod, env } = setup({ exec: healthyExec(true), shared: { "git-graph.diff-open": { keep: 1 } } });
  const res = await mod.openMrFile({ repo, loc: { cwd: "/w/repo", machine: null }, mr, path: "a.js" });
  assert.equal(res.ok, false);
  assert.match(res.error, /Could not resolve host/);
  assert.deepEqual(plain(env.shared[mod.DIFF_OPEN]), { keep: 1 });
  assert.deepEqual(env.runs, []);
});

test("a remote machine's cache lives under that machine's $HOME, read once", async () => {
  const { mod, env } = setup({ exec: healthyExec(), machineHome: "/home/remote" });
  const loc = { cwd: "/w/repo", machine: "box" };
  await mod.openMrFile({ repo, loc, mr, path: "a.js" });
  await mod.openMrFile({ repo, loc, mr, path: "b.js" });
  assert.equal(env.shared[mod.DIFF_OPEN].s1.target.gitDir, "/home/remote/.cache/omni-forge/mr-cache/git.example.org/group/app.git");
  assert.equal(env.shared[mod.DIFF_OPEN].s1.target.on, "box");
  const homeReads = env.execs.filter((e) => e.cmd === "sh" && e.args[1] === 'printf %s "$HOME"');
  assert.equal(homeReads.length, 1);
  assert.equal(homeReads[0].on, "box");
});

test("no folder to read the repository from is an error, not a hand-over", async () => {
  const { mod, env } = setup();
  const res = await mod.openMrFile({ repo, loc: { cwd: null, machine: null }, mr, path: "a.js" });
  assert.equal(res.ok, false);
  assert.deepEqual(env.runs, []);
});

test("a repo without a url takes the folder's origin", async () => {
  const { mod, env } = setup({ exec: healthyExec() });
  await mod.openMrFile({ repo: { ...repo, url: undefined }, loc: { cwd: "/w/repo", machine: null }, mr, path: "a.js" });
  const fetch = env.execs.find((e) => e.cmd === "git" && e.args.includes("fetch"));
  assert.ok(fetch.args.includes("https://git.example.org/group/app.git"));
});

test("two opens on one cache dir never fetch at the same time", async () => {
  let active = 0, peak = 0;
  const { mod } = setup({
    exec: async (cmd, args) => {
      if (cmd === "git" && args.includes("fetch")) {
        active++; peak = Math.max(peak, active);
        await new Promise((r) => setTimeout(r, 15));
        active--;
        return { code: 0, stdout: "", stderr: "" };
      }
      return null;
    },
  });
  const loc = { cwd: "/w/repo", machine: null };
  await Promise.all([mod.openMrFile({ repo, loc, mr, path: "a.js" }), mod.openMrFile({ repo, loc, mr, path: "b.js" })]);
  assert.equal(peak, 1);
});
