// The Recent tab: files that changed on disk under the shown folder, newest first.
// A click opens one as a tree row does; a right-click gives the row's menu.
import { div } from "gpui-kit";
import { h_flex } from "gpui-base";
import { shared } from "herdr";
import { recentRows } from "../files/recent.js";
import { baseName } from "../files/model.js";
import { TEXT, FileIcon, Message } from "./ui.js";

export const recentMethods = {
  recentView(body, t) {
    const list = shared("better-files.recent")?.[this.root] ?? [];
    const known = this.recentKinds?.key === this.key ? this.recentKinds.kinds : null;
    // Unknown until checked: drawn as still there.
    const rows = recentRows(
      list.filter((e) => known?.get(e.path) !== "d"),
      (path) => known?.get(path) !== "-",
      Date.now(),
    );
    if (!rows.length) return body.child(Message("Files that change here show up in this list."));
    body.children(rows.map((r) => this.recentRow(r, t)));
  },

  recentRow({ path: relative, ago, gone }, t) {
    const path = `${this.root}/${relative}`;
    const folder = relative.includes("/") ? relative.slice(0, relative.lastIndexOf("/")) : "";
    return h_flex()
      .id(`files-recent-${relative}`)
      .h(26)
      .flex_none()
      .px(8)
      .gap(6)
      .min_w(0)
      .items_center()
      .rounded(7)
      .text_size(TEXT.small)
      .cursor_pointer()
      .hover((s) => s.bg(t.hover))
      .on_click((event, cx) => this.clickFile(relative, event, cx))
      .on_mouse_down("right", (_e, cx) => {
        cx.stop_propagation();
        this.showRowMenu(this.targetOf(relative, false));
      })
      .child(FileIcon({ icons: this.fileIcons, path, color: t.muted, t }))
      .child(
        div()
          .flex_none()
          .max_w(180)
          .truncate()
          .when(gone, (el) => el.line_through().text_color(t.dim))
          .child(baseName(relative)),
      )
      .child(div().flex_1().min_w(0).truncate().text_size(TEXT.caption).text_color(t.dim).child(folder))
      .child(div().flex_none().text_size(TEXT.caption).text_color(t.dim).child(ago));
  },
};
