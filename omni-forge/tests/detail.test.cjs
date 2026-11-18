// The run detail's job actions, with herdr stubbed.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { load } = require("./load.cjs");

function setup() {
  const env = { commands: [], logs: [] };
  const { Detail } = load(["ci/poller.js", "ci/watch.js", "forge/model.js", "views/runs.js", "views/ui.js", "views/detail.js"], {
    exec: async () => ({ code: 0 }),
    home: () => "/home/u",
    notify: () => {},
    focused: () => null,
    runCommand: (name, args) => env.commands.push(name),
    openSendDialog: () => {},
  });
  const owner = {
    repo: { kind: "gitlab", host: "gl.test", path: "g/p" },
    provider: { capabilities: { play: true, retryFailed: false, liveLog: true } },
    watches: { add() {} },
    details: new Map(),
    openLog: (runId, job) => env.logs.push([runId, job.id]),
  };
  const detail = new Detail(owner, "12", { id: "12", status: "failed" });
  return { detail, env };
}

test("Log opens the job in the owner's log tab, never a pane split", () => {
  const { detail, env } = setup();
  const job = { id: "gid://gitlab/Ci::Build/77", name: "Build", status: "failed" };
  const log = detail.jobActions(job, "j").find((a) => a.label === "Log");
  log.onClick({});
  assert.deepEqual(env.logs, [["12", job.id]]);
  assert.deepEqual(env.commands, []);
});
