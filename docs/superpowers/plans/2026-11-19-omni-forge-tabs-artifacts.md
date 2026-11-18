# omni-forge Tabs + Per-Job Artifacts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The full CI view gets its own tab strip (Runs, run tabs, log tabs; logs full width instead of `pane.split`), and GitLab artifacts move onto their job rows.

**Architecture:** A pure `views/tabs.js` model (open/select/close/evict/reset) drives the full view. Run tabs hold `Detail` instances; log tabs embed `LogView`, refactored so its polling is driven by the owner's tick instead of a timer it owns (embedded copies must not leak timers after their tab closes). A pure `artifactsByJob` splits artifacts into per-job and run-level.

**Tech Stack:** Herdr gpui-kit mod (JS), node `--test` with `tests/load.cjs`.

**Spec:** `docs/superpowers/specs/2026-11-19-omni-forge-tabs-artifacts-design.md` (amends `2026-11-18-forge-ci-design.md`)

## Global Constraints

- Mod: `omni-forge/mods/omni-forge/`; tests `cd omni-forge && node --test tests/*.test.cjs`; `herdr-app check "$PWD/mods/omni-forge"` passes.
- AGENTS.md rules: no stored `cx`, no `run`/`setShared`/`notify` in render, no timers for animation, `checking()` guards network calls.
- No employer names, hosts, projects or product terms anywhere in committed files or messages; examples use `git.example.org`, `group/app`.
- Tab limit 8 including Runs; Runs can't be closed; tabs are not persisted.

## Review Focus

1. Closing a log tab must stop its polling (no orphaned refresh loop). Test in Task 2.
2. Opening the same run or job twice selects the existing tab, never a duplicate. Test in Task 1.
3. A side-view/notification open (`omni-forge.open`, `props.open`) lands in a run tab. Test in Task 2.
4. Repo change closes run and log tabs and selects Runs. Test in Task 2.
5. A GitHub run (artifacts with `jobId: null`) still lists its artifacts at run level. Test in Task 3.

---

### Task 1: Tab model

**Files:** Create `views/tabs.js`; Test `tests/tabs.test.cjs`

**Interfaces — Produces:** `class Tabs` with `list: Tab[]`, `selected: string`, where `Tab = {id, kind: "runs"|"run"|"log", label, runId?, jobId?, status?}`; ids `"runs"`, `"run:<runId>"`, `"log:<runId>:<jobId>"`.
`openRun({id, title, number, status}) -> Tab`, `openLog({runId, jobId, name, status}) -> Tab`, `select(id)`, `close(id) -> Tab|null` (returns the closed tab; selecting falls back to the previously selected, else Runs), `reset()`, `setStatus(id, status)`, `MAX_TABS = 8`.

- [ ] **Step 1:** Tests: new `Tabs` has only Runs, selected; `openRun` twice with the same id → one tab, selected; `openLog` id format; `close("runs")` → null and Runs stays; closing the selected tab selects the previously selected one; opening a 9th tab evicts the least recently selected non-Runs tab (and never the newly opened one); `reset()` → only Runs.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS. **Step 5:** Commit `omni-forge: CI view tab model`.

### Task 2: Full view tabs, embedded logs

**Files:** Modify `views/full.js`, `views/detail.js` (Log button), `views/log.js` (owner-driven polling), `views/ui.js` (tab strip using existing pill styles); Test `tests/full.test.cjs`, `tests/log.test.cjs`

**Interfaces:**
- Consumes: Task 1 `Tabs`.
- `LogView`: keep standalone pane use working (`props.view:"log"` still registers its own timer), and add embedded use: `new LogView(); view.initEmbedded(props, cx)` registers **no** timer; the owner calls `view.tick(cx, now)` from its tick while the tab exists; dropping the tab drops the instance (nothing left polling).
- `FullView`: `this.tabs = new Tabs()`; `this.details: Map<runId, Detail>`; `this.logs: Map<tabId, LogView>`.
  - `openRun(run, cx)` → `tabs.openRun`, create/reuse the `Detail`, select it (replaces today's single `this.detail`). `openKey`/`omni-forge.open` use it.
  - `openLog(runId, job, cx)` → `tabs.openLog`, create/reuse an embedded `LogView`. `Detail`'s Log button calls `owner.openLog(...)` instead of `pane.split`.
  - Tick: only the selected run tab's `Detail` and the selected log tab's `LogView` poll (others idle); Runs polls as today.
  - `closeTab(id, cx)` deletes the matching `Detail`/`LogView`; evicted tabs (Task 1 eviction) are deleted the same way.
  - Repo change (where today `detail = null` on a new repo) → `tabs.reset()`, clear both maps.
  - Run/log tab status icons follow the latest loaded status (`tabs.setStatus` after loads).
  - Render: tab strip under the header (label truncated, status icon, × on non-Runs tabs), then the selected tab's body. `back()` in `Detail` selects Runs.

- [ ] **Step 1:** Tests (full.test.cjs, with the existing stubs): Log on a job opens tab `log:<run>:<job>` and calls no `pane.split`; opening it again selects the same tab; closing a log tab removes its `LogView` and a later tick makes no `jobLog` call for it; `omni-forge.open` request → run tab selected; a repo change → only Runs left and maps empty. (log.test.cjs): `initEmbedded` registers no timer; `tick` refreshes only while `live`.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Tests + `herdr-app check` pass. **Step 5:** Commit `omni-forge: tabs inside the full CI view, logs as tabs`.

### Task 3: Per-job artifacts

**Files:** Modify `views/detail.js`; Create helper in `views/runs.js` (pure); Test `tests/runs.test.cjs`

**Interfaces — Produces:** `artifactsByJob(artifacts) -> {byJob: Map<lastId(jobId), Artifact[]>, runLevel: Artifact[]}` (artifacts with `jobId: null` go to `runLevel`; job keys compare by the last id segment, as `findJob` does).

Detail: each job row with artifacts gets a `⬇ Artifacts` button (downloads that job's archive(s); state busy/done/error as today, keyed by artifact id); the bottom ARTIFACTS section shows only `runLevel` (GitHub) and is hidden when empty.

- [ ] **Step 1:** Tests: GitLab-shaped artifacts (`jobId: "gid://gitlab/Ci::Build/7"`) → `byJob.get("7")` has them and `runLevel` is empty; GitHub-shaped (`jobId: null`) → all in `runLevel`.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Tests + check pass. **Step 5:** Commit `omni-forge: artifacts on their job rows`.

### Task 4: Install, live check, docs

- [ ] **Step 1:** `omni-forge/sync.sh`; `herdr-app check`; `herdr-app status` shows no errors.
- [ ] **Step 2:** Live (read-only): in a GitLab repo terminal open the CI tab, open a run, open two job logs → three tabs, logs full width, no split pane; close a log tab; a job with artifacts shows `⬇ Artifacts` on its row (don't press it). Screenshots stay in the scratchpad (they show real names).
- [ ] **Step 3:** Update `omni-forge/README.md` and `RECIPE.md` (tabs; per-job artifacts; GitHub run-level). Commit `omni-forge: docs for CI tabs and per-job artifacts`.
