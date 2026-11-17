// herdr-omni: folding for the lists view's Spaces tab. Which rows are open,
// remembered per mod copy; the chevron that folds them; the dot a folded row
// shows for the most urgent agent inside it.
import { div } from "gpui-kit";
import { theme } from "herdr";
import { Icon } from "./ui.js";

const URGENCY = ["blocked", "done", "working"];

export const mainNodeId = (spaceId) => `${spaceId}:main`;

// The most urgent of the statuses that need showing; idle and none show nothing.
export function mostUrgent(statuses) {
  return URGENCY.find((s) => statuses.includes(s)) ?? null;
}

// Only explicit choices are saved; a row nobody touched uses its default.
export class Folds {
  constructor(storage = localStorage, key = "spaces.folds") {
    this.storage = storage;
    this.key = key;
    this.lastTab = undefined;
    try {
      const saved = JSON.parse(storage.getItem(key) ?? "{}");
      this.choices = saved && typeof saved === "object" && !Array.isArray(saved) ? saved : {};
    } catch {
      this.choices = {};
    }
  }

  isOpen(id, byDefault) {
    return typeof this.choices[id] === "boolean" ? this.choices[id] : byDefault;
  }

  toggle(id, byDefault) {
    this.set(id, !this.isOpen(id, byDefault));
  }

  // Opens the rows down to the shown tab, once per tab change, so folding that
  // row again afterwards sticks.
  follow(tabId, path) {
    if (tabId === this.lastTab) return;
    this.lastTab = tabId;
    if (!tabId) return;
    for (const id of path) if (this.choices[id] !== true) this.set(id, true);
  }

  set(id, open) {
    this.choices[id] = open;
    try {
      this.storage.setItem(this.key, JSON.stringify(this.choices));
    } catch {
      /* Folding still works for this session. */
    }
  }
}

// Stops every part of the press so the row under it neither selects nor drags.
export function Chevron({ id, open, onToggle }) {
  const t = theme();
  return div()
    .id(id)
    .size(16)
    .flex_none()
    .flex()
    .items_center()
    .justify_center()
    .rounded(4)
    .text_color(t.dim)
    .cursor_pointer()
    .hover((s) => s.bg(t.hover).text_color(t.foreground))
    .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
    .on_mouse_up("left", (_e, cx) => cx.stop_propagation())
    .on_click((_e, cx) => {
      cx.stop_propagation();
      onToggle(cx);
    })
    .child(Icon(open ? "chevron-down" : "chevron-right", 11));
}

export function StatusDot(status, id) {
  if (!URGENCY.includes(status)) return null;
  const dot = div().size(6).rounded(3).flex_none().bg(theme()[status]).tooltip(status);
  return id ? dot.id(id) : dot;
}

// The Spaces tab's rows (from Spaces.ordered()) seen as a tree: which rows can
// fold, what is open by default, what a folded row hides and shows.
// A space with worktrees starts open; any other row starts folded.
export class SpaceTree {
  constructor(folds, rows, hasItems) {
    this.folds = folds;
    this.rows = rows;
    this.hasItems = hasItems;
  }

  row(id) {
    return this.rows.find((r) => r.w.id === id);
  }

  kids(id) {
    return this.rows.filter((r) => r.parent === id);
  }

  byDefault(id) {
    return (this.row(id)?.kids ?? 0) > 0;
  }

  open(id) {
    return this.folds.isOpen(id, this.byDefault(id));
  }

  toggle(id) {
    this.folds.toggle(id, this.byDefault(id));
  }

  hasChildren(r) {
    return r.kids > 0 || this.hasItems(r.w);
  }

  // A worktree inside a folded space.
  hidden(r) {
    return Boolean(r.parent) && !this.open(r.parent);
  }

  // Whether a row's own tabs show beneath it.
  tabsOpen(r) {
    return this.open(r.w.id);
  }

  // The rows to open so the tab `tabId` shows, outermost first.
  path(tabId) {
    const r = this.rows.find((x) => (x.w.tabs ?? []).some((tab) => tab.id === tabId));
    if (!r) return [];
    return r.parent ? [r.parent, r.w.id] : [r.w.id];
  }

  // A folded space speaks for its worktrees too.
  status(r) {
    return mostUrgent([r.w.status, ...this.kids(r.w.id).map((k) => k.w.status)]);
  }
}
