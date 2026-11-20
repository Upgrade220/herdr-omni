// Better Sidebar: spaces, agents, both in one block (lists), a footer and a right
// panel toggle. A layout puts one copy per block, and `view` in its props picks which part.
import { View } from "gpui-kit";
import { props } from "herdr";
import { Spaces } from "./views/spaces.js";
import { Agents } from "./views/agents.js";
import { Lists } from "./views/lists.js";
import { Footer } from "./views/footer.js";
import { PanelToggle } from "./views/panel-toggle.js";
import { Switcher } from "./views/switcher.js";

// herdr-omni: `switcher` is Spaces | Agents | Files above a stack of lists and Better Files.
const PARTS = { lists: Lists, agents: Agents, footer: Footer, "panel-toggle": PanelToggle, switcher: Switcher };

export default class BetterSidebar extends View {
  init(given, cx) {
    const Part = PARTS[props()?.view] ?? Spaces;
    this.part = new Part();
    this.part.init(given, cx);
  }

  render(cx) {
    return this.part.render(cx);
  }
}
