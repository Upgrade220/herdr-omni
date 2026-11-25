// herdr-omni: the + menu when settings name its agents (`new_menu.agents`). Like Herdr's own
// new menu, but its agents are exactly the ones set, each started with its own command.
// A popup is another copy of this mod, with props { mode: "new-menu", agents }.
import { div, svg, image } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { theme, spaces, panes, run, openOverlay, closeOverlay, props } from "herdr";
import { TEXT } from "./ui.js";

const ROW = 31;

// The popup's height for this many agents: Terminal, the "Start an agent" heading, the agents,
// a divider and the three space/worktree rows, inside 5px padding.
export const newMenuHeight = (count) => 172 + ROW * count;

// An agent's icon: its own, else Herdr's shipped icon named after the command.
const agentIcon = (agent) => agent.icon ?? `icons/${agent.run[0]}.svg`;

export const newMenuMethods = {
  openNewMenu(agents) {
    openOverlay({
      mod: "better-tabs",
      kind: "popup",
      width: 250,
      height: newMenuHeight(agents.length),
      props: { mode: "new-menu", agents },
    });
  },

  newMenuRow(id, icon, name, action, enabled = true) {
    const t = theme();
    return h_flex()
      .id(id)
      .h(ROW)
      .px(9)
      .gap(10)
      .rounded(7)
      .items_center()
      .flex_none()
      .text_color(enabled ? t.foreground : t.dim)
      .when(enabled, (el) => el.hover((s) => s.bg(t.selected)))
      .on_click(() => {
        if (!enabled) return;
        closeOverlay(props().overlay);
        action();
      })
      .child(icon)
      .child(div().flex_1().child(name));
  },

  startAgent(agent) {
    const space = spaces().find((s) => s.active);
    run("tab.new", { name: agent.name, space: space?.id, argv: agent.run });
  },

  renderNewMenu() {
    const t = theme();
    const space = spaces().find((s) => s.active);
    const agents = (this.config().agents ?? []).filter((a) => a?.name && a.run?.length);
    const worktree = (action, width, height) => () =>
      openOverlay({
        mod: "worktree",
        kind: "dialog",
        width,
        height,
        props: { space: space?.id, folder: panes().find((p) => p.focused)?.cwd, action },
      });
    const branch = () => svg("mods/workspace-chrome/branch.svg").size(14);
    return v_flex()
      .id("new-menu")
      .w_full()
      .h(newMenuHeight(agents.length))
      .p(5)
      .bg(t.popover)
      .text_size(TEXT.menu)
      .on_key_down((e) => {
        if (e.modifiers?.control || e.modifiers?.platform || e.modifiers?.alt) return;
        const agent = /^[1-9]$/.test(e.key) ? agents[Number(e.key) - 1] : null;
        if (!agent) return;
        closeOverlay(props().overlay);
        this.startAgent(agent);
      })
      .when(Boolean(this.menuFocus), (el) => el.track_focus(this.menuFocus))
      .child(
        this.newMenuRow("new-terminal", svg("icons/shell.svg").size(14), "Terminal", () =>
          run("tab.new", { space: space?.id }),
        ),
      )
      .child(div().px(9).pt(8).pb(4).text_size(11).text_color(t.dim).child("Start an agent"))
      .children(
        agents.map((agent, i) =>
          this.newMenuRow(`agent-${i}`, image(agentIcon(agent)).size(14), agent.name, () =>
            this.startAgent(agent),
          ),
        ),
      )
      .child(div().h(1).mx(4).my(5).bg(t.border))
      .child(this.newMenuRow("new-space", div().w(14).child("+"), "New space", () => run("space.new")))
      .child(
        this.newMenuRow("new-worktree", branch(), "New worktree…", worktree("new", 460, 280), Boolean(space)),
      )
      .child(
        this.newMenuRow("open-worktree", branch(), "Open worktree…", worktree("open", 560, 480), Boolean(space)),
      );
  },
};
