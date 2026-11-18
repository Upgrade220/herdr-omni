# Tab Titles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unnamed tabs show a label from their lead pane (title → program → folder → mod title) instead of "1", "2", in Better Sidebar and Better Tabs.

**Architecture:** A pure `tabLabel(tab, panes)` (no herdr import) in each mod, the same rules duplicated; each mod's renderer calls it where it drew `tab.name`. Better Tabs comes into the repo with `scripts/upstream.sh`.

**Tech Stack:** Herdr gpui-kit mods (JS); node `--test` with each mod's existing vm harness.

**Spec:** `docs/superpowers/specs/2026-11-19-tab-titles-design.md`

## Global Constraints

- Display only: never `tab.rename`; a named tab (`named: true`) shows `tab.name` unchanged.
- Rules, in order: telling terminal title (leading non-letter/digit stripped; not a path `~/`, `/`, `X:\`; no `@`; not equal to program name or key) → program name if not a shell (`program.shell`) → cwd's last segment → a mod-only tab's mod pane title → `tab.name`.
- Lead pane: the tab's terminal panes; an agent first, else the focused one, else the first.
- Tests: `cd better-sidebar && node --test tests/*.test.cjs`; `cd better-tabs && node --test tests/*.test.cjs`; `herdr-app check` on each mod folder.
- No employer names in committed files.

## Review Focus

1. A Claude Code tab whose title is "✳ Fix totals" shows "Fix totals". Test in Tasks 1 and 3.
2. A zsh tab whose title is "~/repos/x" shows "x" (folder), not "~/repos/x" or "zsh". Tasks 1 and 3.
3. A named tab keeps its name even when its title is telling. Tasks 1 and 3.
4. A tab with only the CI mod pane shows "omni-forge" (its title). Tasks 1 and 3.

---

### Task 1: Better Sidebar label

**Files:** Modify `better-sidebar/mods/better-sidebar/views/agents.js` (replace `title()` with exported `tabLabel(tab, all)`; `tabRow` and `agentName` use it); Test `better-sidebar/tests/agents.test.cjs`.

- [ ] Tests for the four Review Focus cases plus "nvim tab with no title shows nvim" → RED → implement → GREEN; full suite; commit `better-sidebar: unnamed tabs show their title, not a number`.

### Task 2: Bring Better Tabs into the repo

- [ ] `scripts/upstream.sh add better-tabs https://github.com/munza/herdr-mods.git`; copy munza's `LICENSE`/`NOTICE` into `better-tabs/`; add a README row; run its tests (baseline green); commit `Credit better-tabs upstream (Apache-2.0)`.

### Task 3: Better Tabs label

**Files:** Create `better-tabs/mods/better-tabs/views/tab-label.js` (`tabLabel(tab, panes)`); Modify `views/tab-bar.js:84-85` (label + tooltip; the zoom ` Z` suffix kept); Test `better-tabs/tests/tab-label.test.cjs`.

- [ ] Same cases as Task 1 → RED → implement → GREEN; suite; commit `better-tabs: unnamed tabs show their title, not a number`.

### Task 4: Install and check

- [ ] `better-sidebar/sync.sh`, `better-tabs/sync.sh`; `herdr-app check` both; `herdr-app status` no errors; screenshot: tabs and sidebar rows show titles. Note changes in each mod's README "Changes in herdr-omni". Commit `docs: tab titles`.
