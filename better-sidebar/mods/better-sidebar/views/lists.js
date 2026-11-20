// Spaces and agents in one block. Combined (the default): tabs for Spaces, with
// each space's tabs and agents under it, and Agents. With `combined: false` in the settings: the
// two lists one above the other, as two blocks of this mod would draw them.
import { v_flex, h_flex } from "gpui-base";
import { agents, focused, theme, setAgentOrder, props, layout, shared, setShared } from "herdr";
import { Spaces } from "./spaces.js";
import { Agents } from "./agents.js";
import { TEXT, Rail, IconButton, TabChip } from "./ui.js";
import { TAB_KEY, TABS, readTab, hasFilesStack } from "./switcher-state.js";
import { showFiles } from "./switcher.js";
import { Folds, SpaceTree, Chevron, StatusDot, mainNodeRow, mainNodeId, mostUrgent } from "./folds.js";

export class Lists {
  init(props, cx) {
    this.spaces = new Spaces();
    this.spaces.init(props, cx);
    this.agents = new Agents();
    this.agents.init(props, cx);
    const saved = localStorage.getItem("lists.tab");
    this.tab = TABS.includes(saved) ? saved : "spaces";
    // herdr-omni: the tab is shared, so the switcher block can set it; the one this copy
    // kept before the shared key starts it.
    if (!TABS.includes(shared(TAB_KEY)) && TABS.includes(saved)) setShared(TAB_KEY, saved);
    this.folds = new Folds();
  }

  pick(tab, cx) {
    this.tab = tab;
    localStorage.setItem("lists.tab", tab);
    setShared(TAB_KEY, tab);
    cx.notify();
  }

  render() {
    const t = theme();
    const collapsed = this.spaces.collapsed();
    this.tab = readTab(shared(TAB_KEY), this.tab);
    const root = v_flex()
      .id("better-sidebar-lists")
      .size_full()
      .min_h(0)
      .bg(t.chrome)
      .text_size(TEXT.body)
      .on_size_change((size, cx) => this.spaces.resized(size, cx));
    this.spaces.under = null;
    this.spaces.quiet = null;
    this.spaces.above = null;
    this.spaces.lead = null;
    this.spaces.trail = null;
    this.spaces.hidden = null;
    this.spaces.lit = null;
    // The rail has no room for tabs: both lists, as numbers.
    if (!this.spaces.settings.combined || collapsed)
      return root
        .when(collapsed && hasFilesStack(layout()), (el) => el.child(this.railFiles()))
        .child(
          v_flex()
            .flex_1()
            .min_h(0)
            .child(this.spaces.header(t, collapsed))
            .child(this.spaces.body(t, collapsed)),
        )
        .child(v_flex().flex_1().min_h(0).child(this.agents.render()));

    const view = this.agents.readView();
    // herdr-omni: under the switcher block, its strip stands in for this one.
    if (props()?.strip !== false) root.child(this.tabBar(t, view));
    if (this.tab !== "spaces") return root.child(this.agents.render({ view, heading: false }));

    // Spaces, each with its tabs and agents beneath in tab order, so rows don't move as
    // their state changes; next-agent keys follow that order.
    const nested = { ...view, sort: { id: "grouped" }, byPriority: false, nested: true };
    const order = [];
    const all = agents();
    // Pinned agents go above every space, in the Agents tab's Pinned group.
    const pinned = view.groups.find((g) => g.id === "pinned");
    const pins = pinned?.members.map((a) => a.address) ?? [];
    order.push(...pins);
    this.spaces.above = () => (pinned ? this.agents.groupRows(pinned, 0, view, t) : []);
    const nest = (lines, row) => h_flex().children(lines.map((l) => Rail(l))).child(row.flex_1().min_w(0));
    // A space's agents hang from its line; a main space's worktrees come after them,
    // so its line carries on, and a worktree's own agents sit one step further in.
    // Every tab shows: a tab with agents as its agents, any other as itself.
    const shownTab = focused()?.tab;
    const plain = (tab) => !all.some((a) => a.tab === tab.id);
    const itemsOf = (w) =>
      w.tabs.flatMap((tab) =>
        plain(tab)
          ? tab.settled ? [] : [{ tab }]
          : all.filter((a) => a.tab === tab.id && !pins.includes(a.address)).map((a) => ({ a })),
      );
    // herdr-omni: every row folds; agents in folded rows keep their place in the order.
    const folding = new SpaceTree(this.folds, this.spaces.ordered(), (w) => itemsOf(w).length > 0);
    this.folds.follow(shownTab, folding.path(shownTab));
    for (const r of this.drawOrder(folding.rows)) order.push(...itemsOf(r.w).filter((x) => x.a).map((x) => x.a.address));
    this.wireFolds(folding);
    // One row lit: a space whose focused agent or tab shows beneath it leaves it to that row.
    this.spaces.quiet = (w) =>
      all.some((a) => a.space === w.id && a.focused) || w.tabs.some((tab) => tab.id === shownTab && plain(tab));
    // herdr-omni: or the folded row the shown tab is hidden in.
    const litId = folding.lit(shownTab, folding.rows.find((r) => r.w.active)?.w, this.spaces.quiet);
    this.spaces.lit = (w) => litId === w.id;
    this.spaces.under = (r) => {
      const { w, tree, kids } = r;
      // herdr-omni: a space with worktrees keeps its own tabs under a node for its branch.
      if (folding.hasNode(r)) {
        if (!folding.open(w.id)) return [];
        const id = mainNodeId(w.id);
        const open = folding.open(id);
        const onToggle = (cx) => {
          folding.toggle(id);
          cx.notify();
        };
        const status = mostUrgent([w.status]);
        const node = mainNodeRow({ spaceId: w.id, branch: r.g?.branch, open, status, lit: litId === id, onToggle });
        return [nest(["├"], node), ...(open ? tabRows(w, ["│"], false) : [])];
      }
      if (!folding.tabsOpen(r)) return [];
      return tabRows(w, tree ? [tree.startsWith("└") ? "" : "│"] : [], kids > 0);
    };
    const tabRows = (w, before, more) => {
      const items = itemsOf(w);
      return items.flatMap((x, i) => {
        const last = i === items.length - 1 && !more;
        const [row, ...subs] = x.a
          ? this.agents.agentWithSubs(x.a, i, nested, t)
          : [this.agents.tabRow(w, x.tab, x.tab.id === shownTab, t)];
        return [nest([...before, last ? "└" : "├"], row), ...subs.map((s) => nest([...before, last ? "" : "│"], s))];
      });
    };
    const body = this.spaces.body(t, false);
    setAgentOrder(order);
    return root.child(body);
  }

  // herdr-omni: rows in the order Spaces.grouped() draws them: this computer, then
  // other machines by name, leaving out machines whose header is folded.
  drawOrder(rows) {
    const remote = [
      ...new Set([...rows.map((r) => r.w.machine).filter(Boolean), ...this.spaces.machines.map((m) => m.name)]),
    ].sort();
    if (!remote.length) return rows;
    return [null, ...remote]
      .filter((m) => !this.spaces.folded.has(m))
      .flatMap((m) => rows.filter((r) => (r.w.machine ?? null) === m));
  }

  // herdr-omni: the chevron and folded status dot on space and worktree rows.
  wireFolds(tree) {
    this.spaces.lead = (w) => {
      const r = tree.row(w.id);
      if (!r || !tree.hasChildren(r)) return [];
      const onToggle = (cx) => {
        tree.toggle(w.id);
        cx.notify();
      };
      return [Chevron({ id: `fold-${w.id}`, open: tree.open(w.id), onToggle })];
    };
    this.spaces.trail = (w) => {
      const r = tree.row(w.id);
      if (!r || !tree.hasChildren(r) || tree.open(w.id)) return [];
      return [StatusDot(tree.status(r), `dot-${w.id}`)].filter(Boolean);
    };
    this.spaces.hidden = (r) => tree.hidden(r);
  }

  // herdr-omni: on the rail, the way to Files: it widens the sidebar, then shows Files.
  railFiles() {
    return h_flex()
      .h(31)
      .flex_none()
      .justify_center()
      .items_center()
      .child(IconButton({ id: "rail-files", icon: "file", label: "Files", iconSize: 14, muted: true, onClick: showFiles }));
  }

  // Tabs side by side from the left, the picked one filled.
  tabBar(t, view) {
    const tab = (id, label, count) =>
      TabChip({ id: `lists-tab-${id}`, label, count, on: this.tab === id, onClick: (cx) => this.pick(id, cx) });
    return h_flex()
      .px(8)
      .pt(6)
      .pb(6)
      .mb(4)
      .border_b(1)
      .border_color(t.border)
      .flex_none()
      .gap(6)
      .items_center()
      .child(
        h_flex()
          .flex_1()
          .gap(2)
          .child(tab("spaces", "Spaces", null))
          .child(tab("agents", "Agents", view.count)),
      )
      .child(this.tab === "spaces" ? this.spaces.newSpaceButton() : this.agents.sortMenu());
  }
}
