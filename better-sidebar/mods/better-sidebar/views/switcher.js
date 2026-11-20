// herdr-omni: Spaces | Agents | Files above the sidebar's body, a stack of the lists
// block (`spaces`, with `strip: false`) and a Better Files block (`files`). Spaces and
// Agents show the lists on that tab; Files shows the Files block. The `files` command
// (a key bound to `better-sidebar.files`) shows Files and gives it the keyboard.
import { h_flex } from "gpui-base";
import { agents, theme, run, layout, shared, setShared, nextCommand } from "herdr";
import { Agents, narrow, toggleSidebar } from "./agents.js";
import { findNode } from "./find-node.js";
import { STACK, LISTS, FILES, TAB_KEY, readTab, switcherState } from "./switcher-state.js";
import { TEXT, Badge, IconButton } from "./ui.js";

// Shows Files, first widening the rail, as its » does.
export function showFiles() {
  if (!findNode(layout(), STACK)) return;
  if (narrow()) toggleSidebar();
  run("layout.select", { stack: STACK, child: FILES });
}

export class Switcher {
  init(props, cx) {
    // For the Agents tab's sort menu; the sort itself is shared.
    this.agents = new Agents();
    this.agents.init(props, cx);
    cx.spawn(async () => {
      for (;;) this.command(await nextCommand());
    });
  }

  command(name) {
    if (name !== "files" || !findNode(layout(), STACK)) return;
    showFiles();
    run("better-files.focus");
  }

  pick(id, cx) {
    if (id === "files") showFiles();
    else {
      setShared(TAB_KEY, id);
      if (findNode(layout(), STACK)) run("layout.select", { stack: STACK, child: LISTS });
    }
    cx.notify();
  }

  render() {
    const t = theme();
    const on = switcherState(layout(), readTab(shared(TAB_KEY), null));
    const bar = h_flex()
      .id("better-sidebar-switcher")
      .size_full()
      .px(8)
      .gap(6)
      .items_center()
      .bg(t.chrome)
      .border_b(1)
      .border_color(t.border)
      .text_size(TEXT.body);
    // The rail has no room for tabs; Files left showing there gets a way back.
    if (narrow())
      return bar.justify_center().when(on === "files", (el) =>
        el.child(
          IconButton({ id: "switcher-lists", icon: "layers", label: "Spaces", iconSize: 14, muted: true, onClick: (cx) => this.pick(readTab(shared(TAB_KEY), null), cx) }),
        ),
      );
    // Drawn as the lists view's own tabs.
    const tab = (id, label, count) =>
      h_flex()
        .id(`switcher-${id}`)
        .px(10)
        .h(24)
        .gap(5)
        .justify_center()
        .items_center()
        .rounded(6)
        .cursor_pointer()
        .text_size(TEXT.label)
        .font_medium()
        .text_color(on === id ? t.foreground : t.dim)
        .when(on === id, (el) => el.bg(t.selected))
        .when(on !== id, (el) => el.hover((s) => s.bg(t.hover).text_color(t.foreground)))
        .on_click((_e, cx) => this.pick(id, cx))
        .child(label)
        .when(count !== null, (el) => el.child(Badge(count)));
    const trailing =
      on === "spaces"
        ? [IconButton({ id: "space-new", icon: "plus", label: "New space", iconSize: 14, muted: true, onClick: () => run("space.new") })]
        : on === "agents"
          ? [this.agents.sortMenu()]
          : [];
    return bar
      .child(
        h_flex()
          .flex_1()
          .gap(2)
          .child(tab("spaces", "Spaces", null))
          .child(tab("agents", "Agents", agents().length))
          .child(tab(FILES, "Files", null)),
      )
      .children(trailing);
  }
}
