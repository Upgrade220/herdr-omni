// omni-forge: CI for the current space's GitHub or GitLab project. A layout puts one copy per
// block, and `view` in its props picks which part: side (the default), mrs (the MR side list), full, log, or send (a dialog).
import { View } from "gpui-kit";
import { props } from "herdr";
import { LogView } from "./views/log.js";
import { FullView } from "./views/full.js";
import { SideView } from "./views/side.js";
import { MrSideView } from "./views/mr-side.js";
import { SendView } from "./views/send.js";

const PARTS = { side: SideView, mrs: MrSideView, full: FullView, log: LogView, send: SendView };

export default class OmniForge extends View {
  init(given, cx) {
    const Part = PARTS[props()?.view] ?? PARTS.side;
    this.part = new Part();
    this.part.init(given, cx);
  }

  render(cx) {
    return this.part.render(cx);
  }
}
