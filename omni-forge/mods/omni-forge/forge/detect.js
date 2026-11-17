// Finds the forge (GitHub or GitLab) and the project path from a space's git remote.
// `exec` is passed in (herdr's exec), so this file does not import herdr.

export function parseRemote(url) {
  const text = (url ?? "").trim();
  let m = text.match(/^[a-z+]+:\/\/(?:[^@/]+@)?([^/:]+)(?::\d+)?\/(.+?)(?:\.git)?\/?$/i);
  if (!m) m = text.match(/^(?:[^@/\s]+@)?([^/:\s]+):(?!\/)(.+?)(?:\.git)?\/?$/);
  if (!m || !m[2]) return null;
  return { host: m[1], path: m[2] };
}

export function forgeKind(host) {
  return host === "github.com" ? "github" : "gitlab";
}

async function git(exec, cwd, machine, args) {
  return exec("git", args, { cwd, on: machine });
}

export async function detectRepo(cwd, machine, exec) {
  let res = await git(exec, cwd, machine, ["remote", "get-url", "origin"]);
  if (res.code !== 0 && /not a git repository/i.test(res.stderr ?? "")) {
    return { error: "Not a Git repository", hint: "Open a space inside a Git checkout." };
  }
  if (res.code !== 0) {
    const list = await git(exec, cwd, machine, ["remote"]);
    const first = list.code === 0 ? list.stdout.split("\n").map((s) => s.trim()).find(Boolean) : null;
    if (!first) {
      if (list.code !== 0 && /not a git repository/i.test(list.stderr ?? "")) return { error: "Not a Git repository", hint: "Open a space inside a Git checkout." };
      return { error: "No Git remote", hint: "Add one with: git remote add origin <url>" };
    }
    res = await git(exec, cwd, machine, ["remote", "get-url", first]);
    if (res.code !== 0) return { error: "No Git remote", hint: (res.stderr ?? "").trim() };
  }
  const url = res.stdout.trim();
  const parsed = parseRemote(url);
  if (!parsed) return { error: "Unrecognised remote URL", hint: url };
  return { kind: forgeKind(parsed.host), host: parsed.host, path: parsed.path, url };
}
