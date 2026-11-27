// NewMrView: prefill from git, Create gating, push, createMr and the hand-off to the full tab, with herdr stubbed.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { load } = require("./load.cjs");
const plain = (x) => JSON.parse(JSON.stringify(x));

function fakeState() {
  let v = "";
  const handlers = {};
  return { on(n, f) { handlers[n] = f; }, value: () => v, set_value(x) { v = x; }, type(x, cx) { v = x; handlers.change?.({}, cx); } };
}

const ok = (stdout = "") => ({ code: 0, stdout, stderr: "" });
const fail = (stderr = "fatal") => ({ code: 128, stdout: "", stderr });

function setup({ git = {}, provider = {}, panes = [{ pane: "pf", tab: "F", mod: "omni-forge", terminal: null }], checking = false, kind = "gitlab" } = {}) {
  const env = { execs: [], runs: [], shared: {}, closed: [], notified: [], created: [], git: { branch: ok("feature/x\n"), upstream: ok("origin/feature/x\n"), subject: ok("Fix totals\n"), remote: ok("origin\n"), push: ok(), ...git } };
  const exec = async (cmd, args, opts) => {
    env.execs.push({ cmd, args: [...args], opts: plain(opts) });
    const key = args[0] === "rev-parse" ? (args.includes("@{u}") ? "upstream" : "branch") : args[0] === "log" ? "subject" : args[0] === "remote" ? "remote" : args[0] === "push" ? "push" : "?";
    const r = env.git[key];
    if (r instanceof Error) throw r;
    return typeof r === "function" ? r(args) : r;
  };
  const prov = {
    defaultBranch: async () => "main",
    searchUsers: async () => [],
    createMr: async (a) => { env.created.push(plain(a)); return { number: 12, reviewers: a.reviewers }; },
    ...provider,
  };
  const mod = load(["views/locate.js", "views/mrs.js", "views/ui.js", "views/people.js", "views/new-mr.js"], {
    InputState: { new: fakeState },
    TextareaState: { new: () => Object.assign(fakeState(), { set_auto_grow() {} }) },
    exec,
    providerFor: () => prov,
    props: () => ({}),
    checking: () => checking,
    notify: (n) => env.notified.push(plain(n)),
    openOverlay: (o) => env.opened = o,
    closeOverlay: (id) => env.closed.push(id),
    shared: (k) => env.shared[k],
    setShared: (k, v) => { env.shared[k] = v; },
    runCommand: (name, args) => env.runs.push(plain([name, args])),
    focused: () => ({ space: "s1", tab: "F" }),
    panes: () => panes,
    spaces: () => [{ id: "s1", tabs: [{ id: "F" }] }],
    layout: () => ({ id: "root", type: "row", children: [] }),
  });
  const view = new mod.NewMrView();
  const pending = [];
  const cx = { timer: { after() { return { cancel() {} }; }, every() {} }, notify() {}, spawn(fn) { const p = fn(cx); pending.push(p); return p; } };
  const settle = async () => { while (pending.length) await pending.shift(); };
  const repo = { kind, host: "git.example.org", path: "group/app", url: "u" };
  view.init({ repo, loc: { cwd: "/w/app", machine: "m1" }, overlay: "ov1" }, cx);
  return { view, env, cx, settle, mod };
}

test("openNewMrDialog opens a dialog with plain repo and loc", () => {
  const { mod, env } = setup();
  mod.openNewMrDialog({ repo: { kind: "github", host: "github.com", path: "o/r", url: "u" }, loc: { cwd: "/w", machine: null, branch: "b", key: "k" } });
  assert.equal(env.opened.kind, "dialog");
  assert.equal(env.opened.mod, "omni-forge");
  assert.equal(env.opened.props.view, "new-mr");
  assert.equal(env.opened.props.repo.path, "o/r");
  assert.equal(env.opened.props.loc.cwd, "/w");
});

test("prefill: source, upstream, title from the last commit, target from defaultBranch; git runs on the machine in cwd", async () => {
  const { view, env, settle } = setup();
  await settle();
  assert.equal(view.branch, "feature/x");
  assert.equal(view.upstream, "origin/feature/x");
  assert.equal(view.title.value(), "Fix totals");
  assert.equal(view.target.value(), "main");
  for (const e of env.execs) {
    assert.equal(e.cmd, "git");
    assert.deepEqual(e.opts, { cwd: "/w/app", on: "m1" });
  }
  assert.equal(view.canCreate(), true);
  assert.equal(env.execs.some((e) => e.args[0] === "push"), false); // loading never pushes
});

test("Create is disabled while the title is blank, with no upstream, busy, or detached", async () => {
  const a = setup();
  await a.settle();
  a.view.title.type("   ", a.cx);
  assert.equal(a.view.canCreate(), false);
  a.view.title.type("T", a.cx);
  assert.equal(a.view.canCreate(), true);
  a.view.busy = true;
  assert.equal(a.view.canCreate(), false);

  const b = setup({ git: { upstream: fail("no upstream") } });
  await b.settle();
  assert.equal(b.view.upstream, null);
  assert.equal(b.view.canCreate(), false);

  const c = setup({ git: { branch: ok("HEAD\n") } });
  await c.settle();
  assert.equal(c.view.detached, true);
  assert.equal(c.view.canCreate(), false);
});

test("push runs git push --set-upstream with origin preferred, then re-reads the upstream", async () => {
  let pushed = false;
  const { view, env, cx, settle } = setup({ git: { upstream: () => (pushed ? ok("up/feature/x\n") : fail()), remote: ok("up\norigin\n"), push: () => { pushed = true; return ok(); } } });
  await settle();
  assert.equal(view.canCreate(), false);
  view.push(cx);
  await settle();
  const push = env.execs.find((e) => e.args[0] === "push");
  assert.deepEqual(push.args, ["push", "--set-upstream", "--", "origin", "feature/x"]);
  assert.deepEqual(push.opts, { cwd: "/w/app", on: "m1" });
  assert.equal(view.upstream, "up/feature/x");
  assert.equal(view.canCreate(), true);
});

test("push falls back to the first remote when there is no origin; a failed push stays in the dialog", async () => {
  const { view, env, cx, settle } = setup({ git: { upstream: fail(), remote: ok("up\nother\n"), push: fail("rejected") } });
  await settle();
  view.push(cx);
  await settle();
  assert.deepEqual(env.execs.find((e) => e.args[0] === "push").args, ["push", "--set-upstream", "--", "up", "feature/x"]);
  assert.match(view.error, /rejected/);
  assert.equal(view.canCreate(), false);
  assert.deepEqual(env.closed, []);
});

test("create: createMr args, then OPEN is set for the full tab and the overlay closes", async () => {
  const { view, env, cx, settle } = setup();
  await settle();
  view.title.type("My title", cx);
  view.description.set_value("body");
  view.target.type("develop", cx);
  view.draft = true;
  view.reviewers = ["ann", "bob"];
  view.create(cx);
  await settle();
  assert.deepEqual(env.created, [{ source: "feature/x", target: "develop", title: "My title", description: "body", draft: true, reviewers: ["ann", "bob"] }]);
  assert.deepEqual(plain(env.shared["omni-forge.open"]), { tab: "F", key: JSON.stringify({ kind: "gitlab", host: "git.example.org", path: "group/app", mr: 12, cwd: "/w/app", machine: "m1" }) });
  assert.deepEqual(env.runs[0], ["tab.select", { id: "F" }]);
  assert.deepEqual(env.closed, ["ov1"]);
});

test("create with no full tab opens a new one", async () => {
  const { view, env, cx, settle } = setup({ panes: [] });
  await settle();
  view.create(cx);
  await settle();
  assert.equal(env.runs[0][0], "tab.new");
  assert.equal(env.runs[0][1].props.view, "full");
  assert.deepEqual(env.closed, ["ov1"]);
});

test("missing reviewers on the created MR are reported, and the MR still opens", async () => {
  const { view, env, cx, settle } = setup({ provider: { createMr: async () => ({ number: 5, reviewers: ["ann"] }) } });
  await settle();
  view.reviewers = ["ann", "bob"];
  view.create(cx);
  await settle();
  assert.ok(env.notified.some((n) => /Created, but reviewers weren't set/.test(n.title ?? n.body ?? "")));
  assert.equal(env.shared["omni-forge.open"].tab, "F");
  assert.deepEqual(env.closed, ["ov1"]);
});

test("a createMr error stays in the dialog, keeps the form and re-enables Create", async () => {
  const { view, env, cx, settle } = setup({ provider: { createMr: async () => { throw new Error("already exists"); } } });
  await settle();
  view.title.type("Keep me", cx);
  view.create(cx);
  await settle();
  assert.match(view.error, /already exists/);
  assert.equal(view.busy, false);
  assert.equal(view.title.value(), "Keep me");
  assert.deepEqual(env.closed, []);
  assert.equal(env.shared["omni-forge.open"], undefined);
  assert.equal(view.canCreate(), true);
});

test("closing disposes the reviewer picker and closes the overlay", async () => {
  const { view, env, settle } = setup();
  await settle();
  let disposed = 0;
  view.picker.dispose = () => { disposed++; };
  view.close();
  assert.equal(disposed, 1);
  assert.deepEqual(env.closed, ["ov1"]);
});

test("during check nothing is read", () => {
  const { env } = setup({ checking: true });
  assert.deepEqual(env.execs, []);
});

test("an upstream of another branch (checkout -b feat origin/main) counts as unpublished", async () => {
  const a = setup({ git: { upstream: ok("origin/main\n") } });
  await a.settle();
  assert.equal(a.view.upstream, null);
  assert.equal(a.view.canCreate(), false);
  // a branch with a slash keeps its own name after the remote
  const b = setup({ git: { upstream: ok("origin/feature/x\n") } });
  await b.settle();
  assert.equal(b.view.upstream, "origin/feature/x");
  assert.equal(b.view.canCreate(), true);
});

test("a branch named like an option cannot become a push flag", async () => {
  const { view, env, cx, settle } = setup({ git: { branch: ok("-n\n"), upstream: fail() } });
  await settle();
  view.push(cx);
  await settle();
  assert.deepEqual(env.execs.find((e) => e.args[0] === "push").args, ["push", "--set-upstream", "--", "origin", "-n"]);
});

test("a failed rev-parse HEAD shows its error, not Detached HEAD", async () => {
  const { view, settle } = setup({ git: { branch: fail("fatal: not a git repository") } });
  await settle();
  assert.equal(view.detached, false);
  assert.match(view.error, /not a git repository/);
  assert.equal(view.canCreate(), false);
});

test("the reviewers notice uses the forge's number style", async () => {
  for (const [kind, want] of [["github", "#5 was created"], ["gitlab", "!5 was created"]]) {
    const { view, env, cx, settle } = setup({ kind, provider: { createMr: async () => ({ number: 5, reviewers: [] }) } });
    await settle();
    view.reviewers = ["ann"];
    view.create(cx);
    await settle();
    assert.ok(env.notified.some((n) => n.body.startsWith(want)), kind);
  }
});

test("the hand-off key carries the dialog's folder and machine", async () => {
  const { view, env, cx, settle } = setup();
  await settle();
  view.create(cx);
  await settle();
  const key = JSON.parse(env.shared["omni-forge.open"].key);
  assert.equal(key.mr, 12);
  assert.equal(key.cwd, "/w/app");
  assert.equal(key.machine, "m1");
});
