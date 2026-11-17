# better-sidebar Folding Tree Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In the `lists` view's Spaces tab, make every space / main-checkout node / worktree foldable (tab-level folded by default, with a status dot when folded, auto-opening where the shown tab is), and put a space's main-checkout tabs under their own node named after its branch when the space has worktrees.

**Architecture:** Borrow munza's `better-sidebar` with `scripts/upstream.sh`. All new logic lives in `better-sidebar/mods/better-sidebar/views/folds.js`. `views/lists.js` and `views/spaces.js` get only small hooks, in the style upstream already uses (`under`, `quiet`, `above`: optional functions that `Lists` sets on its `Spaces` instance and resets to `null` at the top of each `render`).

**Tech Stack:** Herdr gpui-kit mods (plain JS ES modules, no build), node `--test` with upstream's `vm` harness (`tests/*.test.cjs`), `herdr-app check`.

**Spec:** `docs/superpowers/specs/2026-11-18-better-sidebar-folding-design.md`

## Global Constraints

- Mod keeps the name `better-sidebar`; no renamed asset paths, settings name or shared keys.
- Changes are limited to the Spaces tab of `props.view: "lists"` with `combined` on and not collapsed. The standalone `spaces` view, the Agents tab, `combined: false` and the compact rail must render exactly as upstream (all upstream tests keep passing).
- Statuses are ordered blocked > done > working; idle and null show no dot. Dot colors are `theme()[status]`.
- Fold state is in `localStorage` (per mod copy), key `spaces.folds`; never `setShared` from render.
- No `setTimeout`, no stored `cx` (AGENTS.md rules).
- Commands: tests `node --test tests/*.test.cjs` from `better-sidebar/`; check `herdr-app check "$PWD/mods/better-sidebar"`.

## Review Focus

1. Clicking a chevron must not select the space or start a drag (`withDragging` sets `pressed` on mouse-down). Test in Task 3.
2. Auto-open fires only when the shown tab changes, so folding the row that holds the current tab keeps it folded. Test in Task 2.
3. Agents inside folded rows stay in `setAgentOrder` order, so next/prev agent still reaches them. Test in Task 3.
4. With the shown tab's row folded away, the nearest drawn ancestor is lit (the `quiet` hook must not darken every row). Test in Task 4.
5. A worktree whose main space isn't open stays top-level and gets the plain worktree fold (no main-checkout node anywhere). Test in Task 4.

---

### Task 1: Import better-sidebar and record provenance

**Files:**
- Create (via script): `better-sidebar/**`, row in `upstreams.tsv`
- Create: `better-sidebar/LICENSE`, `better-sidebar/NOTICE` (copied from upstream repo root)
- Modify: `README.md` (mods table)

- [ ] **Step 1:** Run `scripts/upstream.sh add better-sidebar https://github.com/munza/herdr-mods.git`. Expected: `added ./better-sidebar`, two commits (`Add better-sidebar from …`, `Track better-sidebar upstream`).
- [ ] **Step 2:** Copy `LICENSE` and `NOTICE` from the root of `https://github.com/munza/herdr-mods` (main) into `better-sidebar/`. (Upstream's README links `../LICENSE`; leave that line.)
- [ ] **Step 3:** Replace the `_none yet_` README row with: `| [better-sidebar](better-sidebar/) | Spaces and agents sidebar with branches, worktrees and PR status; folding tree | [munza/herdr-mods better-sidebar](https://github.com/munza/herdr-mods/tree/main/better-sidebar) |`
- [ ] **Step 4:** From `better-sidebar/`: `node --test tests/*.test.cjs` → 36 pass, 0 fail.
- [ ] **Step 5:** Commit `Credit better-sidebar upstream (Apache-2.0)`.

### Task 2: `folds.js`: fold state, defaults, auto-open, status

**Files:**
- Create: `better-sidebar/mods/better-sidebar/views/folds.js`
- Test: `better-sidebar/tests/folds.test.cjs` (load `views/ui.js` then `views/folds.js` with the same import-stripping `vm` loader as `tests/lists.test.cjs`; copy its `element()` proxy and give it `localStorage` and `theme`)

**Interfaces:**
- Produces:
  - `mainNodeId(spaceId: string): string` returns `` `${spaceId}:main` ``
  - `mostUrgent(statuses: (string|null)[]): "blocked"|"done"|"working"|null`
  - `class Folds`: `constructor(storage = localStorage, key = "spaces.folds")`; `isOpen(id: string, byDefault: boolean): boolean`; `toggle(id: string, byDefault: boolean): void`; `follow(tabId: string|null, path: string[]): void`
  - `Chevron({ id: string, open: boolean, onToggle: (cx) => void })`: element
  - `StatusDot(status: string|null)`: element or `null`

- [ ] **Step 1: Write failing tests** in `tests/folds.test.cjs`:
  - `mostUrgent` → `mostUrgent(["idle","working","done"]) === "done"`, `mostUrgent(["working","blocked"]) === "blocked"`, `mostUrgent(["idle",null]) === null`, `mostUrgent([]) === null`.
  - `isOpen falls back to the default and toggle persists the opposite`: fresh `Folds(store)`: `isOpen("s",false)===false`, `isOpen("s",true)===true`; `toggle("s",false)` → `isOpen("s",false)===true` and `JSON.parse(store["spaces.folds"]).s === true`; a new `Folds(store)` reads it back.
  - `follow opens the path only when the tab changes`: `follow("t1",["s","s:main"])` → both open; `toggle("s",false)` (now closed); `follow("t1",[...])` again → `s` stays closed; `follow("t2",["s"])` → `s` open.
  - `bad saved state is ignored`: store `"spaces.folds": "{not json"` → `isOpen("s",false)===false`, no throw.
  - `Chevron stops the press and toggles`: its `mouse_down_left`, `mouse_up_left` and `click` handlers each call `cx.stop_propagation()`; only `click` calls `onToggle`.
  - `StatusDot`: `StatusDot("idle") === null`, `StatusDot(null) === null`, `StatusDot("blocked")` is an element.
- [ ] **Step 2:** `node --test tests/folds.test.cjs` → FAIL (`Folds is not defined`).
- [ ] **Step 3: Implement** in `views/folds.js`. `Folds` keeps `{id: boolean}` of explicit choices only (defaults are not stored) and remembers the last followed tab id in memory (not persisted, so the first render after a restart opens the current tab's path). `Chevron` uses `Icon(open ? "chevron-down" : "chevron-right", 11)` in a 16px `.flex_none()` hit area with `.id(id)`. `StatusDot` is a 6px `rounded(3)` `bg(theme()[status])` div, matching the machine header's dot.
- [ ] **Step 4:** `node --test tests/*.test.cjs` → all pass.
- [ ] **Step 5:** Commit `better-sidebar: fold state, chevron and status dot`.

### Task 3: Fold spaces and worktrees in the Spaces tab

**Files:**
- Modify: `better-sidebar/mods/better-sidebar/views/spaces.js`. Add hooks, each one line: in `rowTitle` prepend `.children(this.lead?.(w, tree) ?? [])` before the avatar/branch icon and append `.children(this.trail?.(w) ?? [])` after `gitTail`. In `grouped`'s `draw`, return `[]` when `this.hidden?.(r)`. In `ordered`, give nested kids `parent: r.w.id`.
- Modify: `better-sidebar/mods/better-sidebar/views/lists.js`. Hold `this.folds = new Folds()` from `init`; reset `lead`/`trail`/`hidden` to `null` with the other hooks; set them in the combined Spaces branch; in `under`, push the items' agent addresses to `order` **before** returning `[]` for a folded row.
- Test: `better-sidebar/tests/lists.test.cjs`. Extend `harness` with options `spaces` (override the two default spaces, which gain `status`), `focusedTab` (`focused: () => focusedTab ? { tab: focusedTab } : null`), and `git` (an object assigned onto `mod.spaces.git` after init, keyed `JSON.stringify([null, folder])`, values `{ branch, repo, linked, ahead: 0, behind: 0 }`); add `views/folds.js` to the loaded files after `views/ui.js`.

**Interfaces:**
- Consumes: `Folds`, `mainNodeId`, `mostUrgent`, `Chevron`, `StatusDot` (Task 2)
- Produces: `Spaces` hooks `lead(w, tree): element[]`, `trail(w): element[]`, `hidden(row): boolean`; `ordered()` rows for nested worktrees carry `parent: string`. Fold ids: space and worktree rows use `w.id`.

Defaults: a space with nested worktrees (`kids > 0`) is open; any other space and every worktree are folded.

- [ ] **Step 1: Write failing tests:**
  - Update the first upstream test: with `focusedTab: null` and no saved folds, the drawn ids are `["space-shop","space-docs"]` and `live.order` is still `["t1","t3","t2"]`. (This intentionally changes upstream's expectation; note it in the test name: `"…folded by default, and next-agent keys still reach folded agents"`.)
  - `clicking a space's chevron shows its tabs and keeps it after restart`: click `fold-shop` → drawn `["space-shop","ag-t1","ag-t3","tab-d","space-docs"]`; `stored["spaces.folds"]` has `shop: true`; a new harness with the same store draws the same.
  - `the chevron neither selects nor drags`: `find(root,"fold-shop")`'s `mouse_down_left` handler is called with a `cx` whose `stop_propagation` records the call; it was called, and `mod.spaces.pressed === null`.
  - `a folded space shows its most urgent status; open, it shows none`: spaces with `status: "blocked"` for shop: `find(root,"dot-shop")` exists when folded, and is absent after opening.
  - `the shown tab's space opens by itself`: `focusedTab: "b"` → `ag-t3` is drawn.
- [ ] **Step 2:** `node --test tests/lists.test.cjs` → the new tests FAIL.
- [ ] **Step 3: Implement** the hooks above. `lead` returns `[Chevron({id: `fold-${w.id}`, …})]` for rows that have children (a space with tabs or kids, a worktree with tabs). `trail` returns `[StatusDot(…)]` with an id of `dot-${w.id}` only when that row is folded; a folded space with kids uses `mostUrgent` over its own and its kids' `w.status`. `hidden(r)` is true when `r.parent` is folded. Before building the body, call `this.folds.follow(shownTab, pathOf(shownTab))`, where `pathOf` is the containing space's id, plus its `parent` when it's a nested worktree (Task 4 adds the main node).
- [ ] **Step 4:** `node --test tests/*.test.cjs` → all pass.
- [ ] **Step 5:** Commit `better-sidebar: fold spaces and worktrees in the lists view`.

### Task 4: Main-checkout node, lighting

**Files:**
- Modify: `better-sidebar/mods/better-sidebar/views/folds.js` (add `mainNodeRow`)
- Modify: `better-sidebar/mods/better-sidebar/views/lists.js` (`under`, `quiet`, `pathOf`)
- Test: `better-sidebar/tests/lists.test.cjs`

**Interfaces:**
- Consumes: Task 3 hooks and harness options
- Produces: `mainNodeRow({ id: string, branch: string|null, open: boolean, status: string|null, onToggle })`: element with `.id(`space-main-${spaceId}`)`; label is the branch, `"(detached)"`/null shown as `detached`; `Icon("branch", 13)`; height 28 (as upstream's worktree row), `rounded(8)`, hover `t.hover`; the whole row toggles on click; `StatusDot` with id `dot-<spaceId>:main` when folded.

- [ ] **Step 1: Write failing tests** with `spaces` = shop (`/shop`, tabs a, b, d) and a third space `wt` (`/wt`, tab `e`, agent `t4`, status `blocked`), and `git` marking `/shop` as `{branch:"main", repo:R, linked:false}` and `/wt` as `{branch:"fix", repo:R, linked:true}`:
  - `a space with a worktree puts its own tabs under a node named for its branch`: with `shop` and `shop:main` open (saved folds), drawn order is `["space-shop","space-main-shop","ag-t1","ag-t3","tab-d","space-wt", …]` and `text(find(root,"space-main-shop"))` matches `/main/`.
  - `a space with worktrees starts open, its node and worktrees folded`: fresh store, `focusedTab: null` → drawn `["space-shop","space-main-shop","space-wt","space-docs"]`, and `dot-wt` exists.
  - `folding the space hides its node and worktrees and shows the worktree's status`: toggle `fold-shop` → drawn `["space-shop","space-docs"]`, and `dot-shop` exists (blocked from `wt`).
  - `the shown main-checkout tab opens the space and the node`: `focusedTab:"d"` → `tab-d` drawn, and it is lit while `space-shop` is not (inspect the `bg` attribute as upstream's spaces tests do).
  - `a folded-away shown tab leaves its nearest drawn row lit`: `focusedTab:"d"`, then toggle `space-main-shop` closed → `space-main-shop` has `bg` `selected`.
  - `an orphan worktree stays top-level with a plain fold`: drop `shop` from `spaces` → no `space-main-*` id, and `fold-wt` exists.
- [ ] **Step 2:** Run → new tests FAIL.
- [ ] **Step 3: Implement.** In `under`, for a space row with `kids > 0`: return `[nest(["├"], mainNodeRow(...)), ...(open ? tabRows nested under ["│", last ? "└" : "├"] : [])]`, where the node is never `last` because worktrees follow. Get the branch from `this.spaces.git[checkoutKey(w, panes())]?.branch`. `pathOf` adds `mainNodeId(space)` when the shown tab belongs to a space with kids. `quiet(w)` keeps upstream's rule, and additionally returns false when the shown tab's row is hidden by a fold. The main node row is lit (`t.selected`) when it is folded and holds the shown tab.
- [ ] **Step 4:** `node --test tests/*.test.cjs` → all pass.
- [ ] **Step 5:** Commit `better-sidebar: main-checkout node for spaces with worktrees`.

### Task 5: Install, check in the app, document

**Files:**
- Modify: `better-sidebar/README.md` (append a `## Changes in herdr-omni` section: what Tasks 2–4 changed, in 4–6 bullets; Apache-2.0 asks for it)

- [ ] **Step 1:** From `better-sidebar/`: `./sync.sh` (rsyncs into `~/.config/herdr-app/mods/better-sidebar/`; replaces the identical upstream v3.3.0 copy).
- [ ] **Step 2:** `herdr-app check "$PWD/mods/better-sidebar"` → passes, exit 0; `herdr-app status` shows no better-sidebar error.
- [ ] **Step 3:** `herdr-app shot <scratchpad>/folds.png`, then look at it: spaces folded with chevrons, the current space open down to its tab, dots on folded rows with blocked/done agents.
- [ ] **Step 4:** Write the README section; commit `better-sidebar: document herdr-omni changes`.
