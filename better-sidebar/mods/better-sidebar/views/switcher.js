// herdr-omni: Spaces | Agents | Files above the sidebar's body, a stack of the lists
// block (`spaces`, with `strip: false`) and a Better Files block (`files`). Spaces and
// Agents show the lists on that tab; Files shows the Files block. The `files` command
// (a key bound to `better-sidebar.files`) shows Files and gives it the keyboard.
import { h_flex } from "gpui-base";
import { agents, theme, run, layout, shared, setShared, nextCommand } from "herdr";
import { Agents, narrow, toggleSidebar, showListsIfFiles } from "./agents.js";
import { newSpaceButton } from "./spaces.js";
import { findNode } from "./find-node.js";
import { STACK, LISTS, FILES, TAB_KEY, readTab, switcherState, filesShowing } from "./switcher-state.js";
import { TEXT, TabChip } from "./ui.js";

// How long the files key waits for Files to show (looks × ms) before it gives up.
const LOOKS = 5;
const LOOK_MS = 150;

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
    cx.spawn(async (cx) => {
      for (;;) await this.command(await nextCommand(), cx);
    });
  }

  // `better-sidebar.files`. A copy hears commands only while it shows, and starts the
  // first time it shows: wait until the stack shows Files, then a tick, then focus it.
  async command(name, cx) {
    if (name !== "files" || !findNode(layout(), STACK)) return;
    showFiles();
    for (let look = 0; look < LOOKS; look++) {
      await cx.sleep(LOOK_MS);
      if (!filesShowing(layout())) continue;
      await cx.sleep(LOOK_MS);
      run("better-files.focus");
      return;
    }
  }

  pick(id, cx) {
    if (id === FILES) showFiles();
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
      .text_size(TEXT.body)
      // A sidebar dragged down to the rail shows the lists, never Files.
      .on_size_change((size) => {
        if (size.width < 160) showListsIfFiles();
      });
    // The rail has no room for tabs.
    if (narrow()) return bar;
    const tab = (id, label, count = null) =>
      TabChip({ id: `switcher-${id}`, label, count, on: on === id, onClick: (cx) => this.pick(id, cx) });
    const trailing = on === "spaces" ? [newSpaceButton()] : on === "agents" ? [this.agents.sortMenu()] : [];
    return bar
      .child(
        h_flex()
          .flex_1()
          .gap(2)
          .child(tab("spaces", "Spaces"))
          .child(tab("agents", "Agents", agents().length))
          .child(tab(FILES, "Files")),
      )
      .children(trailing);
  }
}
