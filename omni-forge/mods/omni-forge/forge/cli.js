// Runs gh / glab locally and turns failures into ForgeError with a hint for the user.
// `exec` is passed in (herdr's exec), so this file does not import herdr.

const toolOf = (kind) => (kind === "gitlab" ? "glab" : "gh");

export class ForgeError extends Error {
  constructor(message, status = null, hint = "") {
    super(message);
    this.name = "ForgeError";
    this.status = status;
    this.hint = hint;
  }
}

export function httpStatus(stderr) {
  const m = stderr.match(/HTTP\s+(\d{3})/i) ?? stderr.match(/\b(401|403|404|429)\b/);
  return m ? Number(m[1]) : null;
}

export function hintFor(kind, host, stderr, status) {
  const login = kind === "gitlab" ? `glab auth login --hostname ${host}` : "gh auth login";
  if (status === 401 || /not logged|no token|not authenticated/i.test(stderr)) return login;
  // GitLab answers some unauthenticated calls with a bare "Forbidden" and no HTTP code.
  if (status === 403 || (status === null && /\bforbidden\b/i.test(stderr))) return `Access denied. Check the token's scopes (${login}) or your access to the project.`;
  if (status === 404) return "Not found. Check the project path and your access to it.";
  if (status === 429) return "Rate limited. Wait a moment and refresh.";
  return "";
}

// An exec that rejected (tool missing, timeout) as a ForgeError with an install or network hint.
export function execFailure(kind, e, tool = toolOf(kind)) {
  const msg = String(e?.message ?? e);
  const timedOut = /time(d)? ?out/i.test(msg);
  const hint = timedOut
    ? `${tool} timed out. Check the network or VPN and refresh.`
    : `Could not run ${tool}. Install it (${kind === "gitlab" ? "https://gitlab.com/gitlab-org/cli" : "https://cli.github.com"}) and make sure it is on PATH.`;
  return new ForgeError(msg, null, hint);
}

// Runs `cmd` through exec; rejections and non-zero exits become ForgeError. `tool` names gh/glab in messages.
async function run(exec, kind, host, cmd, args, timeout, tool) {
  let res;
  try {
    res = await exec(cmd, args, { timeout });
  } catch (e) {
    throw execFailure(kind, e, tool);
  }
  if (res.code !== 0) {
    const stderr = (res.stderr ?? "").trim();
    const status = httpStatus(stderr);
    throw new ForgeError(stderr || `${tool} exited with ${res.code}`, status, hintFor(kind, host, stderr, status));
  }
  return res;
}

export async function cli(exec, kind, host, args, { timeout = 30000, raw = false } = {}) {
  const tool = toolOf(kind);
  const res = await run(exec, kind, host, tool, args, timeout, tool);
  if (raw) return res.stdout;
  try {
    return JSON.parse(res.stdout);
  } catch {
    throw new ForgeError(`${tool} returned invalid JSON`, null, "");
  }
}

// Runs a shell script (pipes, redirects) that calls gh/glab; returns stdout. Same errors and hints as cli().
export async function shell(exec, kind, host, script, args, { timeout = 60000 } = {}) {
  const res = await run(exec, kind, host, "sh", ["-c", script, "sh", ...args], timeout, toolOf(kind));
  return res.stdout ?? "";
}

function utf8Len(s) {
  let n = 0;
  for (const ch of s) {
    const c = ch.codePointAt(0);
    n += c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4;
  }
  return n;
}

// `out` is the result of `tail -c maxBytes+1`: keeps at most maxBytes bytes and reports whether it had to cut.
// tail -c counts bytes; a cut multibyte char decodes to leading U+FFFD, which is dropped.
export function tailText(out, maxBytes) {
  const truncated = utf8Len(out) > maxBytes;
  let text = out.replace(/^\uFFFD+/, "");
  while (utf8Len(text) > maxBytes) text = text.slice(text.codePointAt(0) > 0xffff ? 2 : 1);
  return { text, truncated };
}
