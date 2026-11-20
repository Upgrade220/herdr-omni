// Git in the sidebar: the header's Tree | Recent and Git switch, the branch line under it,
// and each row's +N -N, a folder's changed count, and the dimming of what Git ignores.
// Ideas from cybertron288/herdr-mods filetree (MIT).
import { div } from "gpui-kit";
import { h_flex } from "gpui-base";
import { setShared } from "herdr";
import { gitOn } from "../files/reads.js";
import { isIgnored } from "../files/git-extras.js";
import { TEXT, Icon, TextButton } from "./ui.js";

const BAR = 36;

export const gitMethods = {
  headerTabs() {
    const tab = (id, label) =>
      TextButton({
        id: `files-tab-${id}`,
        label,
        active: (this.tab ?? "tree") === id,
        onClick: (cx) => this.showTab(id, cx),
      });
    return h_flex().id("files-tabs").flex_none().gap(2).child(tab("tree", "Tree")).child(tab("recent", "Recent"));
  },

  showTab(id, cx) {
    this.tab = id;
    // The Recent list asks once which of its files are still there.
    if (id === "recent") this.refresh(cx);
    cx.notify();
  },

  gitToggle(t) {
    const on = gitOn();
    const label = on ? "Git on: click to hide changes" : "Git off: click to show changes";
    return div()
      .id("files-git")
      .size(26)
      .flex_none()
      .flex()
      .items_center()
      .justify_center()
      .rounded(6)
      .text_color(on ? t.accent : t.dim)
      .cursor_pointer()
      .accessibility_label(label)
      .tooltip(label)
      .hover((el) => el.bg(t.hover))
      .on_click((_e, cx) => {
        cx.stop_propagation();
        setShared("better-files.git", !on);
        if (on) {
          this.marks = {};
          this.gitInfo = null;
        } else this.refresh(cx);
        cx.notify();
      })
      .child(Icon("branch", 15));
  },

  // branch  ↑1 ↓2  +10 −3  [bar of modified, added, deleted]
  summaryLine(t) {
    const s = gitOn() ? this.gitInfo?.summary : null;
    if (!s) return null;
    const total = s.modified + s.added + s.deleted;
    const part = (n, color) => div().h(4).flex_none().w((BAR * n) / total).bg(color);
    return h_flex()
      .id("files-summary")
      .h(26)
      .flex_none()
      .px(14)
      .gap(8)
      .items_center()
      .border_b(1)
      .border_color(t.border)
      .text_size(TEXT.caption)
      .text_color(t.muted)
      .child(Icon("branch", 12))
      .child(div().flex_1().min_w(0).truncate().child(s.branch))
      .when(Boolean(s.ahead || s.behind), (el) => el.child(div().flex_none().child(`↑${s.ahead} ↓${s.behind}`)))
      .when(Boolean(s.add || s.del), (el) =>
        el
          .child(div().flex_none().text_color(t.ansi2).child(`+${s.add}`))
          .child(div().flex_none().text_color(t.ansi1).child(`−${s.del}`)),
      )
      .when(total > 0, (el) =>
        el.child(
          h_flex()
            .id("files-summary-bar")
            .w(BAR)
            .flex_none()
            .rounded(2)
            .overflow_hidden()
            .child(part(s.modified, t.ansi3))
            .child(part(s.added, t.ansi2))
            .child(part(s.deleted, t.ansi1)),
        ),
      );
  },

  // `+N −N` after a changed file, the changed count after a folder.
  rowExtras(relative, dir, t) {
    const info = gitOn() ? this.gitInfo : null;
    if (!info) return null;
    if (dir) {
      const n = info.counts[relative];
      return n ? div().flex_none().text_size(TEXT.caption).text_color(t.ansi3).child(String(n)) : null;
    }
    const lines = info.numstat[relative];
    if (!lines || lines.add === null || !(lines.add || lines.del)) return null;
    return h_flex()
      .flex_none()
      .gap(3)
      .text_size(TEXT.caption)
      .child(div().text_color(t.ansi2).child(`+${lines.add}`))
      .child(div().text_color(t.ansi1).child(`−${lines.del}`));
  },

  ignoredRow(relative, dir) {
    const set = gitOn() ? this.gitInfo?.ignored : null;
    return Boolean(set?.size) && isIgnored(set, dir ? `${relative}/` : relative);
  },
};
