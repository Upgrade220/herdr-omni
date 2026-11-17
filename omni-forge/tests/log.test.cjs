const { test } = require("node:test");
const assert = require("node:assert/strict");
const { load } = require("./load.cjs");
const { cleanLog } = load(["ci/log.js"]);
const plain = (line) => line.spans.map((s) => s.text).join("");

test("GitLab sections are stripped and SGR green becomes a span", () => {
  const raw = "section_start:1700000000:step_script\r\x1b[0K\x1b[36;1mRunning\x1b[0;m\n\x1b[32mok\x1b[0m done\nsection_end:1700000001:step_script\r\x1b[0K\n";
  const { lines, firstError } = cleanLog(raw);
  const all = lines.map(plain).join("\n");
  assert.ok(!all.includes("section_"));
  assert.ok(!all.includes("\x1b"));
  const ok = lines.find((l) => plain(l) === "ok done");
  assert.ok(ok);
  assert.equal(ok.spans[0].text, "ok");
  assert.equal(ok.spans[0].fg, 2);
  assert.equal(ok.spans[1].fg, undefined);
  assert.equal(firstError, null);
});

test("carriage return keeps text after the last overwrite", () => {
  assert.equal(plain(cleanLog("foo\rbar").lines[0]), "bar");
});

test("GitHub timestamp is stripped and firstError found", () => {
  const raw = "2026-01-01T00:00:00.0000000Z hello\n2026-01-01T00:00:01.0000000Z ##[error]boom\n";
  const { lines, firstError } = cleanLog(raw);
  assert.equal(plain(lines[1]), "##[error]boom");
  assert.equal(firstError, 1);
});

test("plain log has no firstError", () => {
  assert.equal(cleanLog("all good\nstill fine\n").firstError, null);
});

test("bold and bright colours, other escapes dropped", () => {
  const { lines } = cleanLog("\x1b[1m\x1b[91mbad\x1b[0m\x1b[2K x");
  assert.equal(lines[0].spans[0].bold, true);
  assert.equal(lines[0].spans[0].fg, 9);
  assert.equal(plain(lines[0]), "bad x");
});

test("findJob matches numeric and gid ids", () => {
  const { findJob } = load(["ci/log.js"]);
  const detail = { groups: [{ name: "build", jobs: [{ id: "gid://gitlab/Ci::Build/123", url: "u1" }] }, { name: "t", jobs: [{ id: "456", url: "u2" }] }] };
  assert.equal(findJob(detail, 123).url, "u1");
  assert.equal(findJob(detail, "gid://gitlab/Ci::Build/123").url, "u1");
  assert.equal(findJob(detail, "456").url, "u2");
  assert.equal(findJob(detail, 999), null);
});
