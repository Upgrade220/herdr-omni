// Runs gh / glab locally and turns failures into ForgeError with a hint for the user.
// `exec` is passed in (herdr's exec), so this file does not import herdr.

export class ForgeError extends Error {
  constructor(message, status = null, hint = "") {
    super(message);
    this.name = "ForgeError";
    this.status = status;
    this.hint = hint;
  }
}

function httpStatus(stderr) {
  const m = stderr.match(/HTTP\s+(\d{3})/i) ?? stderr.match(/\b(401|403|404|429)\b/);
  return m ? Number(m[1]) : null;
}

function hintFor(kind, host, stderr, status) {
  const login = kind === "gitlab" ? `glab auth login --hostname ${host}` : "gh auth login";
  if (status === 401 || /not logged|no token|not authenticated/i.test(stderr)) return login;
  if (status === 403) return `Access denied. Check the token's scopes (${login}) or your access to the project.`;
  if (status === 404) return "Not found. Check the project path and your access to it.";
  if (status === 429) return "Rate limited. Wait a moment and refresh.";
  return "";
}

export async function cli(exec, kind, host, args, { timeout = 30000, raw = false } = {}) {
  const tool = kind === "gitlab" ? "glab" : "gh";
  const res = await exec(tool, args, { timeout });
  if (res.code !== 0) {
    const stderr = (res.stderr ?? "").trim();
    const status = httpStatus(stderr);
    throw new ForgeError(stderr || `${tool} exited with ${res.code}`, status, hintFor(kind, host, stderr, status));
  }
  if (raw) return res.stdout;
  try {
    return JSON.parse(res.stdout);
  } catch {
    throw new ForgeError(`${tool} returned invalid JSON`, null, "");
  }
}
