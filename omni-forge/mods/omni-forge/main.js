// omni-forge: CI for the current space's GitHub or GitLab project. A layout puts one copy per
// block, and `view` in its props picks which part. `side` is a stub until its task lands.
import { View, div } from "gpui-kit";
import { props } from "herdr";
import { LogView } from "./views/log.js";
import { FullView } from "./views/full.js";

const stub = (name) => class {
  init() {}
  render() {
    return div().child(name);
  }
};

const PARTS = { side: stub("side"), full: FullView, log: LogView };

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
