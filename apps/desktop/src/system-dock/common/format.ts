/**
 * [INPUT]: Depends on the shared i18n runtime, the renderer Intl locale, Usage token/cost formatting, Agent display names, and the Dock bar item/face projections.
 * [OUTPUT]: Provides the Dock translator, the privacy mask glyph, quota percent/clock/window labels, per-source limits readings, today's token/cost reading, relative file times, detail availability, and the single accessible name/tooltip of a Dock item.
 * [POS]: system-dock/common presentation policy; bar faces, tooltips, VoiceOver names and panel rows all read values through here so the mask and "never a fake number" rules exist once (INV-06, INV-12).
 */

import type { AppLocale } from "@ai-chat/ui/lib/locale";
import { backendLabel } from "@ai-chat/ui/components/identity/agent";
import type { DockBarItem, LimitsFaceSource, WidgetFace } from "../../../shared/system-dock/ipc";
import { translate } from "../../../shared/i18n/runtime";
import { intlLocale } from "../../lib/i18n-locale";
import { costText, formatCompactTokens, formatUsd } from "../../lib/usage-client";

export type DockT = (key: string, values?: Record<string, unknown>) => string;
export const dockTranslator = (locale: AppLocale): DockT => (key, values) => translate(locale, key, values);
/** One glyph for every masked value, so a masked face never reveals its magnitude by its width. */
export const MASK = "••";

/* Mirrors the shared quota formatter's percent/clock rules without its schema module: the bar
   renderer stays free of the validator library (5.4 budget) while reading identically. */
export function percentText(value: number | null) {
  if (value === null || !Number.isFinite(value) || value < 0) return "—";
  if (value > 0 && value < 1) return "<" + new Intl.NumberFormat(intlLocale(), { style: "percent" }).format(0.01);
  return new Intl.NumberFormat(intlLocale(), { style: "percent", maximumFractionDigits: 0 }).format(Math.floor(Math.min(100, value)) / 100);
}
export function clockText(at: number, now: number) {
  const sameDay = new Date(at).toDateString() === new Date(now).toDateString();
  return new Intl.DateTimeFormat(intlLocale(), sameDay ? { hour: "numeric", minute: "2-digit" }
    : { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(at);
}
export function windowLabel(source: Pick<LimitsFaceSource, "windowMins" | "calendar">, t: DockT) {
  if (source.calendar) return t("settings.usage.limits.month");
  const minutes = source.windowMins;
  if (minutes === 10080) return t("settings.usage.limits.week");
  if (minutes === null) return t("settings.usage.limits.period");
  const unit = minutes % 1440 === 0 ? "day" : minutes % 60 === 0 ? "hour" : "minute";
  const count = minutes / (unit === "day" ? 1440 : unit === "hour" ? 60 : 1);
  return new Intl.NumberFormat(intlLocale(), { style: "unit", unit, unitDisplay: "narrow", maximumFractionDigits: 1 }).format(count);
}

export type LimitsReading = Readonly<{ value: string; spoken: string; note: string; low: boolean; muted: boolean; numeric: boolean }>;
/** A source that cannot answer shows a neutral glyph and its reason, never a number (INV-12). */
export function limitsReading(source: LimitsFaceSource, t: DockT, mask: boolean, now: number): LimitsReading {
  const name = backendLabel(source.backend);
  const numeric = (source.state === "ok" || source.state === "stale") && source.remaining !== null;
  if (!numeric) {
    const reason = source.state === "loading" ? t("settings.usage.limits.loading")
      : source.state === "needs-auth" ? t("settings.usage.limits.signIn")
        : source.state === "not-installed" ? t("settings.usage.limits.notInstalled")
          : source.state === "ok" || source.state === "stale" ? t("settings.usage.limits.unknown") : t("settings.usage.limits.unavailable");
    return { value: source.state === "loading" ? "…" : "—", spoken: t("systemDock.limits.sourceState", { agent: name, state: reason }), note: reason, low: false, muted: true, numeric: false };
  }
  const reset = source.resetsAt !== null && source.resetsAt > now ? t("settings.usage.limits.resets", { date: clockText(source.resetsAt, now) }) : null;
  const reading = t("settings.usage.limits.left", { percent: mask ? MASK : percentText(source.remaining) });
  const parts = [reading, windowLabel(source, t), ...(reset && !mask ? [reset] : []), ...(source.state === "stale" ? [t("settings.usage.limits.stale")] : [])];
  return { value: mask ? MASK : percentText(source.remaining), spoken: t("systemDock.limits.sourceReading", { agent: name, reading: parts.join(" · ") }), note: "",
    low: !mask && source.remaining! < 20, muted: source.state === "stale", numeric: true };
}

export type ActivityReading = Readonly<{ tokens: string; cost: string; spoken: string; state: Extract<WidgetFace, { type: "builtin.ai-activity" }>["state"] }>;
export function activityReading(face: Extract<WidgetFace, { type: "builtin.ai-activity" }>, t: DockT, mask: boolean): ActivityReading {
  if (face.state === "loading" || face.state === "error" || face.state === "no-data" || face.tokens === null) {
    const spoken = face.state === "loading" ? t("systemDock.activity.loading") : face.state === "error" ? t("systemDock.activity.error") : t("systemDock.activity.noData");
    return { tokens: face.state === "loading" ? "…" : "—", cost: "", spoken, state: face.state };
  }
  const tokens = mask ? MASK : formatCompactTokens(face.tokens);
  const cost = mask ? MASK : face.costUsd === null ? "—" : costText(face.costUsd, face.tokens, face.unpricedTokens, formatUsd);
  const spokenCost = cost === "—" ? t("systemDock.activity.costUnpriced") : t("systemDock.activity.costReading", { cost });
  const spoken = [t("systemDock.activity.tokensReading", { tokens }), spokenCost, ...(face.state === "partial" ? [t("systemDock.activity.partial")] : [])].join(" · ");
  return { tokens, cost, spoken, state: face.state };
}

export function relativeTime(at: number, now: number) {
  const seconds = Math.round((at - now) / 1000);
  const format = new Intl.RelativeTimeFormat(intlLocale(), { numeric: "auto", style: "short" });
  const steps: [Intl.RelativeTimeFormatUnit, number][] = [["second", 60], ["minute", 60], ["hour", 24], ["day", 7], ["week", 4.35], ["month", 12], ["year", Infinity]];
  let value = seconds;
  for (const [unit, size] of steps) {
    if (Math.abs(value) < size) return format.format(Math.round(value), unit);
    value /= size;
  }
  return format.format(Math.round(value), "year");
}

/** Items whose click opens a panel detail instead of launching something (3.4, 3.5). */
export function hasDetail(item: DockBarItem) {
  return item.kind === "widget" || item.entry === "system.downloads" || item.entry === "system.trash";
}

/**
 * The item's single spoken identity: the label plus the state a sighted user reads off the icon.
 * Used for aria-label and the native tooltip alike, so the mask applies to both (INV-06).
 */
export function dockItemName(item: DockBarItem, t: DockT, mask: boolean, now: number) {
  const states: string[] = [];
  if (item.running) states.push(t("systemDock.item.running"));
  if (item.status === "missing") states.push(t("systemDock.item.missing"));
  if (item.status === "unavailable") states.push(t("systemDock.item.unavailable"));
  if (item.status === "needs-repair") states.push(t("systemDock.item.needsRepair"));
  if (item.entry === "system.trash") states.push(t(item.trash === "empty" ? "systemDock.trash.stateEmpty" : item.trash === "full" ? "systemDock.trash.stateFull" : "systemDock.trash.stateUnknown"));
  const face = item.widget;
  if (face?.type === "builtin.ai-limits") {
    if (!face.configured) states.push(t("systemDock.limits.notConfigured"));
    else if (!face.sources.length) states.push(t("systemDock.limits.noSources"));
    else states.push(...face.sources.map((source) => limitsReading(source, t, mask, now).spoken),
      ...(face.more > 0 ? [t("systemDock.limits.more", { count: face.more })] : []));
  }
  if (face?.type === "builtin.ai-activity") states.push(activityReading(face, t, mask).spoken);
  if (mask && face) states.push(t("systemDock.item.masked"));
  return states.length ? t("systemDock.item.nameWithState", { name: item.label, state: states.join(t("systemDock.item.stateSeparator")) }) : item.label;
}
