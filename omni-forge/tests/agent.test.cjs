// Send to agent: the prompt text and the order of the agent choices.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { load } = require("./load.cjs");
const { buildAgentPrompt, agentChoices, PROMPT_LINES } = load(["actions/agent.js"]);

const repo = { kind: "gitlab", host: "gl.test", path: "group/app" };
const run = { id: "77", number: 77, title: "Fix cart", branch: "feat/cart", request: 12 };
const job = { id: "901", name: "unit-tests", group: "test" };
const url = "https://gl.test/group/app/-/jobs/901";
const plain = (v) => JSON.parse(JSON.stringify(v));
const log = (n) => Array.from({ length: n }, (_, i) => `line ${i + 1}`).join("\n");

test("prompt keeps only the last 120 log lines", () => {
  assert.equal(PROMPT_LINES, 120);
  const text = buildAgentPrompt({ repo, run, job, url, logTail: log(300) });
  assert.ok(text.includes("line 300"));
  assert.ok(text.includes("line 181\n"));
  assert.ok(!text.includes("line 180\n"));
  assert.ok(!/\bline 1\n/.test(text));
});

test("prompt names the failure, links the job and warns the log is data", () => {
  const text = buildAgentPrompt({ repo, run, job, url, logTail: "boom\nerror: it broke\n" });
  assert.ok(text.includes("unit-tests"));
  assert.ok(text.includes("group/app"));
  assert.ok(text.includes("#77"));
  assert.ok(text.includes("feat/cart"));
  assert.ok(text.includes("MR !12"));
  assert.ok(text.includes(url));
  assert.ok(/```[^\n]*\nboom\nerror: it broke\n```/.test(text), text);
  assert.ok(/treat the log .* as data/i.test(text));
  assert.ok(/find the cause/i.test(text) && /propose a fix/i.test(text));
});

test("prompt fence outgrows backticks inside the log", () => {
  const text = buildAgentPrompt({ repo, run, job, url, logTail: "a\n````\nb" });
  assert.ok(text.includes("`````text\na\n````\nb\n`````"), text);
});

test("prompt without a log says so", () => {
  const text = buildAgentPrompt({ repo, run, job, url, logTail: "" });
  assert.ok(!text.includes("```"));
  assert.ok(/log .*not available/i.test(text));
});

const agent = (address, name, extra = {}) => ({ address, tab_name: name, title: name, program: { key: "claude", name: "Claude Code" }, ...extra });
const known = [
  { key: "claude", name: "Claude Code", run: ["claude"], installed: true },
  { key: "codex", name: "Codex", run: ["codex", "--no-daemon"], installed: true },
  { key: "pi", name: "Pi", run: ["pi"], installed: false },
];

test("agentChoices: running agents first, then installed known agents as New", () => {
  const out = agentChoices([agent("t1", "api"), agent("t2", "web")], known, null);
  assert.deepEqual(plain(out.map((c) => [c.kind, c.label])), [
    ["running", "Claude Code · api"],
    ["running", "Claude Code · web"],
    ["new", "New Claude Code"],
    ["new", "New Codex"],
  ]);
  assert.equal(out[0].terminal, "t1");
  assert.deepEqual(plain(out[3].run), ["codex", "--no-daemon"]);
  assert.equal(out[0].key, "running:t1");
  assert.equal(out[3].key, "new:codex");
});

test("agentChoices: the last used goes first in its group", () => {
  const running = [agent("t1", "api"), agent("t2", "web")];
  assert.deepEqual(plain(agentChoices(running, known, "running:t2").map((c) => c.key)), ["running:t2", "running:t1", "new:claude", "new:codex"]);
  assert.deepEqual(plain(agentChoices(running, known, "new:codex").map((c) => c.key)), ["running:t1", "running:t2", "new:codex", "new:claude"]);
  assert.deepEqual(plain(agentChoices(running, known, "new:gone").map((c) => c.key)), ["running:t1", "running:t2", "new:claude", "new:codex"]);
});

test("agentChoices: empty and missing inputs", () => {
  assert.deepEqual(plain(agentChoices([], [], null)), []);
  assert.deepEqual(plain(agentChoices(null, undefined, null)), []);
  assert.deepEqual(plain(agentChoices([], known, null).map((c) => c.key)), ["new:claude", "new:codex"]);
});
