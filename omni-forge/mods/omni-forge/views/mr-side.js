// Side MRs view: the narrow block in the right panel listing merge requests (views/mr-list.js).
// Follows the focused terminal like the CI side view (views/repo.js) but never polls CI runs or
// runs the watch tick. A row opens the MR in the space's full tab (shared("omni-forge.open"), or a
// new tab named MRs); the Full button opens that tab on its MRs tab. Both close the side panel.
import { div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { theme, focused, panes, spaces, layout, setShared, checking, run as runCommand } from "herdr";
import { spaceFullTabs, sideVisible, sidePanelId, OPEN, MRS_KEY, MOD, mrKey } from "./locate.js";
import { RepoView } from "./repo.js";
import { openNewMrDialog } from "./new-mr.js";
import { MrList } from "./mr-list.js";
import { button, busyState, errorState } from "./ui.js";

const TICK_MS = 1000;
const TAB_NAME = "MRs";

export class MrSideView extends RepoView {
  init(_given, cx) {
    this.initRepo("mrs", { placeholder: "Filter MRs" });
    this.mrList = new MrList(this);
    cx.timer.every(TICK_MS, (cx) => this.tick(cx));
  }

  // A new repo starts a new list (the gen bump in resetList drops the old one's answer).
  repoChanged() {
    this.mrList = new MrList(this);
  }

  pollVisible() {
    return sideVisible(layout(), "mrs");
  }

  tick(cx) {
    if (checking()) return;
    this.follow(cx);
    if (this.provider && this.pollVisible() && this.mrList.tickDue()) this.mrList.load(cx);
  }

  refresh(cx) {
    if (this.retryRepo(cx)) return;
    this.mrList.load(cx);
  }

  openInFull(m) {
    this.showFull(mrKey(this.repo, m.number));
  }

  newMr() {
    if (this.repo && this.loc) openNewMrDialog({ repo: this.repo, loc: this.loc });
  }

  openFull() {
    this.showFull(MRS_KEY);
  }

  showFull(key) {
    const f = focused();
    const tabs = spaceFullTabs(panes(), spaces(), f?.space);
    const tab = tabs.includes(f?.tab) ? f.tab : tabs[0];
    if (tab) {
      setShared(OPEN, { tab, key });
      runCommand("tab.select", { id: tab });
    } else {
      runCommand("tab.new", { name: TAB_NAME, mod: MOD, props: { view: "full", open: key } });
    }
    const panel = sidePanelId(layout(), "mrs");
    if (panel) runCommand("layout.hide", { id: panel });
  }

  render(_cx) {
    const t = theme();
    const header = h_flex().h(36).flex_none().px(12).gap(8).items_center().border_b_1().border_color(t.border)
      .child(div().flex_none().font_semibold().child("MRs"))
      .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(t.dim).child(this.repo?.path ?? ""))
      .child(button(t, "mrs-full", "⤢ Full", () => this.openFull()))
      .child(button(t, "mrs-refresh", "⟳", (cx) => this.refresh(cx), { busy: this.mrList.busy || this.detecting }));
    let body;
    if (!this.repo) {
      body = this.repoError
        ? errorState(t, "mrs-repo-retry", this.repoError, (cx) => this.refresh(cx))
        : busyState(t, "Looking for a repository…", "MRs follow the focused terminal.");
    } else {
      body = this.mrList.render(t, { compact: true, ids: "mrs", onOpen: (m) => this.openInFull(m), onNew: () => this.newMr() });
    }
    return v_flex().id("mrs-root").size_full().min_h(0).bg(t.background).text_color(t.foreground).text_size(13)
      .child(header).child(body);
  }
}
