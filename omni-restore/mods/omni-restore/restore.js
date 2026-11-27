// What to remember about Claude Code sessions in Herdr terminals, and when to bring one back.
// Pure: no herdr import, so tests pass plain objects.
//
// A record per terminal address: where it is, the folder Claude runs in, how it was started, the
// session it is on, and the pid of the shell holding it. A lost terminal (reboot, logout, core
// crash) comes back at the same address with a new shell, so a new shell pid with nothing in front
// of it means "resume". The same shell with nothing in front means the person quit Claude: forget it.

// How long a new shell may run something else before its Claude is given up.
export const BUSY_MS = 30000;

const RESUME_VALUE = new Set(["--resume", "-r", "--session-id"]);
const RESUME_FLAG = new Set(["--continue", "-c", "--fork-session"]);

const base = (p) => String(p ?? "").split("/").pop();

// The foreground process is Claude Code.
export function isClaude(fg) {
  if (!fg) return false;
  return fg.name === "claude" || base(fg.argv?.[0]) === "claude";
}

// An entry of herdr's terminals(): Herdr shows it (it has a tab) and its agent is Claude Code.
export function looksClaude(t) {
  if (!t?.labels?.["herdr.tab"]) return false;
  const app = t.report?.app ?? t.status?.app ?? null;
  return app === "claude-code" || t.agent === "claude-code" || t.program?.key === "claude";
}

// Nothing runs in front of the terminal's own shell.
function idleShell(t) {
  return !t.foreground || t.foreground.pid === t.pid;
}

// The start command with its flags, minus any earlier resume/continue and a prompt typed on the
// command line (a positional with spaces: it was the first message and is in the session already).
export function resumeArgv(argv, sessionId) {
  const out = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (i > 0 && RESUME_VALUE.has(a)) { i++; continue; }
    if (i > 0 && (RESUME_FLAG.has(a) || /^--(resume|session-id)=/.test(a))) continue;
    if (i > 0 && !a.startsWith("-") && /\s/.test(a)) continue;
    out.push(a);
  }
  return [...out, "--resume", sessionId];
}

const quote = (s) => (/^[\w@%+=:,./-]+$/.test(s) ? s : `'${s.replaceAll("'", "'\\''")}'`);

export function shellLine(cwd, argv) {
  return `cd ${quote(cwd)} && ${argv.map(quote).join(" ")}`;
}

// One look at the terminals. `records`: { address: record }. `seen`: Map address -> { t, sessionId }
// where t is `hc get --json` (null: no such terminal; undefined: couldn't ask, keep as is) and
// sessionId the one ~/.claude/sessions/<pid>.json names (null if none). Returns the new records and
// the terminals to resume ({address, pid, line}); call markResumed after sending each.
export function step(records, seen, now) {
  const next = {};
  const resume = [];
  const addresses = new Set([...Object.keys(records), ...seen.keys()]);
  for (const address of addresses) {
    const old = records[address] ?? null;
    const look = seen.get(address);
    if (!look || look.t === undefined) {
      if (old) next[address] = old;
      continue;
    }
    const t = look.t;
    if (!t || t.state !== "live") continue;
    if (isClaude(t.foreground)) {
      const sessionId = look.sessionId ?? old?.sessionId ?? null;
      if (!sessionId) continue;
      next[address] = {
        address,
        space: t.labels?.["herdr.space"] ?? old?.space ?? null,
        tab: t.labels?.["herdr.tab"] ?? old?.tab ?? null,
        cwd: t.foreground.cwd ?? old?.cwd ?? t.cwd,
        argv: t.foreground.argv,
        sessionId,
        shellPid: t.pid,
        savedAt: now,
      };
      continue;
    }
    if (!old || t.pid === old.shellPid) continue; // same shell, nothing in front: the person quit Claude
    if (idleShell(t)) {
      const { busySince, ...rec } = old;
      next[address] = rec;
      resume.push({ address, pid: t.pid, line: shellLine(old.cwd, resumeArgv(old.argv, old.sessionId)) });
      continue;
    }
    // A new shell with something in front: often the prompt's own git for a moment. Wait; past
    // BUSY_MS it is the person's program, and the terminal is theirs now.
    const since = old.busySince ?? now;
    if (now - since <= BUSY_MS) next[address] = { ...old, busySince: since };
  }
  return { records: next, resume };
}

export function markResumed(records, address, pid) {
  if (!records[address]) return records;
  return { ...records, [address]: { ...records[address], shellPid: pid } };
}

export function parseRecords(text) {
  if (!text) return {};
  try {
    const v = JSON.parse(text);
    return v && typeof v.terminals === "object" && v.terminals ? v.terminals : {};
  } catch {
    return {};
  }
}

export function recordsText(records) {
  return `${JSON.stringify({ version: 1, terminals: records }, null, 2)}\n`;
}
