# omni-forge: tabs inside the CI view, per-job artifacts

A small change to omni-forge part 1 (`docs/superpowers/specs/2026-11-18-forge-ci-design.md`).

## Why

- A job log opens with `pane.split`, which splits the full CI tab itself in two, so
  both halves are cramped and the log is hard to read.
- Artifacts are one list at the bottom of the run. GitLab archives are often all named
  `artifacts.zip`, so it isn't clear which job produced which.

## What changes

**Tabs inside the full CI view**

```
CI  group/app                                                     ⟳
[ Runs ] [ ● #8123 Fix totals × ] [ ✕ Test · log × ] [ ⟳ Build · log × ]
──────────────────────────────────────────────────────────────────────
  (the selected tab's content, full width)
```

- `Runs` is always first and can't be closed (today's list).
- Opening a run opens a run tab, or selects it if already open. Opens from the side
  view and from notifications land in a run tab too.
- `Log` on a job opens a log tab named after the job (reused if open); the log fills
  the CI view. No more `pane.split`.
- Each tab shows its run's or job's status icon and has ×.
- At most 8 tabs; opening a ninth closes the least recently selected one.
- When the view's repo changes (a terminal in another repo was focused), run and log
  tabs close.
- Open tabs are not restored after a restart.

**Artifacts per job**

- GitLab: a job with an artifact archive gets a `⬇ Artifacts` button on its row that
  downloads that job's archive; the bottom list goes.
- GitHub: artifacts stay listed at run level — GitHub's API doesn't say which job
  uploaded an artifact.

## Non-goals

Restoring tabs across restarts; tabs in the narrow side view (it stays a list that opens
the full view); dragging or reordering tabs.

## Approaches

- **A. Tabs inside the CI view — chosen.** Several logs and runs open at once, full width.
- B. Drill-down in place (Runs → Run → Log with back): least UI, but one log at a time
  and the run view is lost while reading.
- C. Each log as its own Herdr tab: native tabs, but crowds the person's tab bar.

## Left to the builder

Tab strip styling within ci-dash's look (reuse `ui.js` pills); whether the log view
component is embedded or wrapped; tab label truncation.
