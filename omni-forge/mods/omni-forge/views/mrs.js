// Pure MR list logic: which chips an MR belongs to, counts, text filter, number label.
export const MR_CHIPS = [
  { id: "review", label: "To review" },
  { id: "mine", label: "Mine" },
  { id: "all", label: "All open" },
];

/** The chips ("review", "mine") an MR falls under for `me`; every MR is also under "all". */
export function chipOfMr(mr, me) {
  const set = new Set();
  if (!me) return set;
  if ((mr.reviewers ?? []).includes(me) && !(mr.approvedBy ?? []).includes(me)) set.add("review");
  if (mr.author === me) set.add("mine");
  return set;
}

export function mrCounts(mrs, me) {
  const counts = { review: 0, mine: 0, all: mrs.length };
  for (const m of mrs) for (const c of chipOfMr(m, me)) counts[c]++;
  return counts;
}

/** "!n" on GitLab, "#n" on GitHub. */
export const mrNumber = (kind, n) => (kind === "gitlab" ? `!${n}` : `#${n}`);

/** MRs in the chip whose title, number (`!n` or `#n`), author or source branch contain `text`. */
export function filterMrs(mrs, { chip = "all", text = "", me = "" } = {}) {
  const q = String(text).trim().toLowerCase();
  return mrs.filter((m) => {
    if (chip !== "all" && !chipOfMr(m, me).has(chip)) return false;
    if (!q) return true;
    return [m.title, `!${m.number}`, `#${m.number}`, m.author, m.source].some((s) => String(s ?? "").toLowerCase().includes(q));
  });
}
