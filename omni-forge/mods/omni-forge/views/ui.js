// Shared visual pieces of omni-forge: pills, status icons, filter chips, tab pills, the filter
// box, buttons and message/error states. Shared by the full and side views.
//
// The look is adapted from cybertron288/herdr-mods `ci-dash` (mods/ci-dash/ui.js and main.js),
// MIT licensed, Copyright (c) cybertron288. The icons in ../icons/ are copied from it.
import { div, svg } from "gpui-kit";
import { v_flex, h_flex, Input } from "gpui-base";
import { settings } from "herdr";
import { dur as durText } from "./runs.js";

export const MOD = "omni-forge";
export const icon = (name) => `mods/${MOD}/icons/${name}.svg`;

/** A translucent version of a theme color, for tinted pills. Non-hex colors pass through. */
export const tint = (color, alpha = "24") => (/^#[0-9a-f]{6}$/i.test(color || "") ? color + alpha : color);

export const mono = () => settings().font_family ?? "JetBrains Mono";

// ---- status --------------------------------------------------------------

const GLYPH = { success: "✓", failed: "✕", canceled: "–", skipped: "–", pending: "○", manual: "▶", other: "•" };
const WORD = { success: "passed", failed: "failed", canceled: "canceled", skipped: "skipped", pending: "pending", manual: "manual", running: "running", other: "other" };

/** The theme color for a forge Status (forge/model.js). */
export function statusColor(t, status) {
  return { success: t.ansi2, failed: t.ansi1, running: t.working, pending: t.blocked, manual: t.accent }[status] ?? t.dim;
}

/** A 14px status mark: a spinning ring while running, else a glyph. */
export function statusIcon(t, status, size = 14) {
  if (status === "running") return svg(icon("spinner")).size(size).flex_none().text_color(t.working).spin(900);
  return div().w(size).flex_none().text_center().text_size(size - 1).text_color(statusColor(t, status)).child(GLYPH[status] ?? GLYPH.other);
}

/** The tinted status pill: `✓ passed`, `✕ failed`, a spinner and `running`… */
export function statusPill(t, status) {
  const running = status === "running";
  return pill(t, { label: WORD[status] ?? status, color: statusColor(t, status), glyph: running ? undefined : GLYPH[status], spin: running });
}

// ---- pills, chips, tabs ----------------------------------------------------

/** `MR !12` on GitLab, `PR #12` on GitHub, or "" without a request. */
export const requestLabel = (kind, request) => (request == null ? "" : kind === "gitlab" ? `MR !${request}` : `PR #${request}`);

/**
 * A run's pills in one row: branch, status, duration, trigger, MR/PR, attempt, then the author as
 * dim text (`author: false` leaves it out). `kind` is the forge ("gitlab" | "github").
 */
export function runPills(t, run, kind, { author = true } = {}) {
  const request = requestLabel(kind, run.request);
  return h_flex().flex_wrap().gap(6).items_center()
    .when(Boolean(run.branch), (e) => e.child(pill(t, { label: run.branch, symbol: "branch", code: true })))
    .child(statusPill(t, run.status))
    .when(run.durationSec != null, (e) => e.child(pill(t, { label: durText(run.durationSec) })))
    .when(Boolean(run.trigger), (e) => e.child(pill(t, { label: run.trigger.replace(/_/g, " "), color: run.trigger === "push" ? undefined : t.accent })))
    .when(Boolean(request), (e) => e.child(pill(t, { label: request, color: t.accent })))
    .when((run.attempt ?? 1) > 1, (e) => e.child(pill(t, { label: `attempt ${run.attempt}` })))
    .when(author && Boolean(run.author), (e) => e.child(div().min_w(0).truncate().text_size(11).text_color(t.dim).child(run.author)));
}

/**
 * A small rounded label. `color` tints the background and colors the text;
 * without it the pill is neutral. `glyph` is a text mark, `symbol` an icon name.
 */
export function pill(t, { label, color, glyph, symbol, spin = false, code = false }) {
  const fg = color || t.muted;
  return h_flex().h(20).px(7).gap(4).flex_none().items_center().rounded(6).text_size(11)
    .bg(color ? tint(color) : tint(t.foreground, "1a")).text_color(fg)
    .when(code, (e) => e.font_family(mono()))
    .when(Boolean(glyph), (e) => e.child(div().flex_none().child(glyph)))
    .when(Boolean(symbol) && !spin, (e) => e.child(svg(icon(symbol)).size(11).flex_none()))
    .when(spin, (e) => e.child(svg(icon("spinner")).size(11).flex_none().spin(900)))
    .child(div().truncate().child(label));
}

/** `ARTIFACTS  2  ─────────`. `meta` is a dim note that shrinks first. */
export function section(t, label, count, color, meta = "") {
  return h_flex().flex_none().w_full().px(14).pt(14).pb(4).gap(8).items_center()
    .child(div().flex_none().text_size(11).font_semibold().text_color(color || t.muted).child(label))
    .when(count != null, (e) => e.child(div().flex_none().text_size(11).text_color(t.dim).child(String(count))))
    .when(Boolean(meta), (e) => e.child(div().min_w(0).truncate().text_size(11).text_color(t.dim).child(meta)))
    .child(div().flex_1().min_w(8).h(1).bg(t.border));
}

const countBadge = (t, active, count) => div().h(16).px(6).rounded(8).flex().items_center().text_size(10)
  .bg(active ? t.hover : t.raised).text_color(t.dim).child(String(count));

/** A selectable filter such as `● Failed 2`. */
export function filterChip(t, id, label, count, active, onClick, color) {
  return h_flex().id(id).h(26).px(10).gap(6).flex_none().items_center().rounded(8).text_size(12).cursor_pointer()
    .bg(active ? t.raised : t.background).border_1().border_color(active ? t.border : t.background)
    .text_color(active ? t.foreground : t.muted).hover((s) => s.bg(t.hover))
    .on_click((_e, cx) => onClick(cx))
    .when(Boolean(color), (e) => e.child(div().size(6).rounded(3).flex_none().bg(color)))
    .child(label)
    .when(count != null, (e) => e.child(countBadge(t, active, count)));
}

/** A tab-like pill (`Runs 12`); also used as an on/off toggle such as `✓ This branch`. */
export function tabPill(t, id, label, active, onClick, { count = null, check = false } = {}) {
  return h_flex().id(id).h(28).px(10).gap(6).flex_none().items_center().rounded(8).text_size(12)
    .bg(active ? t.raised : t.background).border_1().border_color(active ? t.border : t.background)
    .text_color(active ? t.foreground : t.muted).cursor_pointer().hover((s) => s.bg(active ? t.raised : t.hover))
    .on_click((_e, cx) => onClick(cx))
    .when(check, (e) => e.child(div().flex_none().w(10).text_color(active ? t.ansi2 : t.dim).child(active ? "✓" : "")))
    .child(label)
    .when(count != null, (e) => e.child(countBadge(t, active, count)));
}

// ---- inputs and buttons ----------------------------------------------------

/** A filter box with a magnifier, the typed text, `right` (a count) and a clear button. */
export function searchBox(t, id, state, { right = "", onClear } = {}) {
  const typed = state.value().length > 0;
  return h_flex().id(id).h(36).flex_none().px(12).gap(8).items_center().rounded(10).bg(t.raised)
    .border_1().border_color(t.border).cursor_text()
    .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
    .child(svg(icon("search")).size(14).flex_none().text_color(t.dim))
    .child(Input.new(state).h_full().flex_1().min_w(0).text_size(12).text_color(t.foreground))
    .when(Boolean(right), (e) => e.child(div().flex_none().text_size(11).text_color(t.dim).child(right)))
    .when(typed && Boolean(onClear), (e) => e.child(div().id(`${id}-clear`).size(18).flex_none().flex().items_center().justify_center()
      .rounded(5).cursor_pointer().hover((s) => s.bg(t.hover)).on_click((_e, cx) => onClear(cx))
      .child(svg(icon("close")).size(11).text_color(t.muted))));
}

/**
 * An outlined button. `busy` shows a spinner and disables it; `danger` colors it red.
 * `symbol` puts an icon before the label.
 */
export function button(t, id, label, onClick, { primary = false, disabled = false, busy = false, danger = false, symbol = null } = {}) {
  const off = disabled || busy;
  const accent = danger ? t.ansi1 : t.accent;
  return h_flex().id(id).h(26).px(10).gap(6).flex_none().items_center().rounded(7).text_size(12)
    .border_1().border_color(primary || danger ? accent : t.border)
    .text_color(off ? t.dim : primary || danger ? accent : t.muted)
    .when(!off, (e) => e.cursor_pointer().hover((s) => s.bg(t.hover)).on_click((_e, cx) => onClick(cx)))
    .when(busy, (e) => e.child(svg(icon("spinner")).size(11).flex_none().spin(900)))
    .when(!busy && Boolean(symbol), (e) => e.child(svg(icon(symbol)).size(11).flex_none()))
    .child(label);
}

// ---- states ------------------------------------------------------------------

/** A centered spinner with a title and an optional hint, for loading states. */
export function busyState(t, title, detail = "") {
  return v_flex().flex_1().min_h(0).items_center().justify_center().gap(10).p(24)
    .child(svg(icon("spinner")).size(22).flex_none().text_color(t.accent).spin(900))
    .child(div().text_size(13).text_color(t.foreground).child(title))
    .when(Boolean(detail), (e) => e.child(div().text_size(11).text_color(t.dim).child(detail)));
}

/** A plain title with a dim detail line. */
export function message(t, title, detail = "") {
  return v_flex().flex_1().min_h(0).p(16).gap(6)
    .child(div().text_color(t.foreground).child(title))
    .when(Boolean(detail), (e) => e.child(div().text_size(12).text_color(t.dim).child(detail)));
}

/**
 * An error from the forge layer ({message, hint}, a ForgeError or a detectRepo failure
 * {error, hint}): the message, the hint in code font, and a Try again button.
 */
export function errorState(t, id, err, onRetry) {
  const text = String(err?.message ?? err?.error ?? err ?? "Something went wrong");
  const hint = err?.hint ?? "";
  return v_flex().flex_1().min_h(0).p(16).gap(10).items_start()
    .child(div().text_color(t.ansi1).child(text))
    .when(Boolean(hint), (e) => e.child(div().px(8).py(4).rounded(6).bg(t.raised).text_size(12).font_family(mono())
      .text_color(t.foreground).child(hint)))
    .when(Boolean(onRetry), (e) => e.child(button(t, id, "Try again", onRetry)));
}
