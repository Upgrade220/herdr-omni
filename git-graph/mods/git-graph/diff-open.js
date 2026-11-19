// Shows a file in the space's Diff tab: hands the target over through shared DIFF_OPEN, then selects
// the tab, or opens one when the space has none and none is on its way (see openDiffPlan).
// Called from click handlers only, never in render.
import { focused, spaces, shared, setShared, run } from "herdr";
import { MOD, DIFF_TABS, DIFF_OPEN, openDiffPlan } from "./place.js";

// target: { root, on, path, source, commit? }; see diff-view.js.
export function openDiff(target) {
  const spaceId = focused()?.space;
  if (!spaceId || !target?.root || !target.path) return;
  const open = shared(DIFF_OPEN) ?? {};
  const plan = openDiffPlan({ map: shared(DIFF_TABS), open, spaces: spaces(), spaceId, target, now: Date.now() });
  setShared(DIFF_OPEN, { ...open, ...plan.open });
  if (plan.select) run("tab.select", { id: plan.select });
  else if (plan.newTab) run("tab.new", { name: plan.newTab.name, mod: MOD, props: { view: "diff" } });
}
