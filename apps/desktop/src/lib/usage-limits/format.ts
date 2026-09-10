/**
 * [INPUT]: Depends on shared quota projections, localized copy and the effective Intl locale.
 * [OUTPUT]: Formats absolute reset times, conservative remaining values and compact general-pool summaries.
 * [POS]: The sole presentation policy shared by Settings rows and passive picker details.
 */
import type { TFunction } from "i18next";
import { currentRemaining, generalQuotaWindows, generalRemaining, quotaStale, quotaWindowExpired, remainingPercent } from "../../../shared/usage-limits/projection";
import type { AgentQuotaWindow, AgentUsageLimits } from "../../../shared/usage-limits/types";
import { intlLocale } from "../i18n-locale";
export function quotaPercent(value: number | null, locale = intlLocale()) {
  if (value === null || !Number.isFinite(value) || value < 0) return "—";
  if (value > 0 && value < 1) return "<" + new Intl.NumberFormat(locale, { style: "percent" }).format(0.01);
  return new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 0 }).format(Math.floor(Math.min(100, value)) / 100);
}
export function quotaDate(value: number, locale = intlLocale(), timeZone?: string) {
  return new Intl.DateTimeFormat(locale, { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", ...(timeZone ? { timeZone } : {}) }).format(value);
}
export function quotaPeriod(minutes: number | null, t: TFunction, compact = false) {
  if (minutes === 300 && !compact) return t("settings.usage.limits.fiveHour");
  if (minutes === 10080) return t(compact ? "settings.usage.limits.week" : "settings.usage.limits.weekly");
  if (minutes === null) return t(compact ? "settings.usage.limits.period" : "settings.usage.limits.title");
  const unit = minutes % 1440 === 0 ? "day" : minutes % 60 === 0 ? "hour" : "minute";
  const count = minutes / (unit === "day" ? 1440 : unit === "hour" ? 60 : 1);
  const duration = new Intl.NumberFormat(intlLocale(), { style: "unit", unit, unitDisplay: compact ? "narrow" : "long", maximumFractionDigits: 1 }).format(count);
  return compact ? duration : t("settings.usage.limits.window", { duration });
}
/* 菜单那一行只有一行的宽度，装不下完整日期。同一天只给钟点，跨天才补月日——
   读者要的是「还要等多久」，不是一个可以复制的时间戳。 */
export function quotaResetClock(resetsAt: number, now: number, locale = intlLocale()) {
  const sameDay = new Date(resetsAt).toDateString() === new Date(now).toDateString();
  return new Intl.DateTimeFormat(locale, sameDay
    ? { hour: "numeric", minute: "2-digit" }
    : { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(resetsAt);
}
export function quotaReset(window: AgentQuotaWindow, agent: AgentUsageLimits, now: number, t: TFunction) {
  if (quotaWindowExpired(window, now)) return t(agent.fetchState === "refreshing" ? "settings.usage.limits.resetPending" : "settings.usage.limits.resetEnded");
  return window.resetsAt === null ? t("settings.usage.limits.resetUnknown") : t("settings.usage.limits.resets", { date: quotaDate(window.resetsAt) });
}
export function quotaStatus(agent: AgentUsageLimits, now: number, t: TFunction) {
  if (agent.fetchState === "deferred") return t("settings.usage.limits.busy");
  if (agent.fetchState === "refreshing") return t("settings.usage.limits.loading");
  if (agent.availability === "not-installed") return t("settings.usage.limits.notInstalled");
  if (agent.availability === "needs-auth") return t("settings.usage.limits.signIn");
  if (agent.availability === "unsupported") return t("settings.usage.limits.unsupported");
  if (agent.fetchState === "error" || agent.availability === "unavailable") return t("settings.usage.limits.unavailable");
  if (quotaStale(agent, now)) return t("settings.usage.limits.stale");
  return null;
}
/* The value a rail tab carries: a bare percentage, sized like the history rail's lifetime token.
   An agent that cannot answer reads "—" rather than borrowing a number from a stale window. */
export function quotaHeadline(agent: AgentUsageLimits, now: number) {
  const value = agent.availability === "available" && !quotaStale(agent, now) ? generalRemaining(agent, now) : null;
  return { text: quotaPercent(value), low: value !== null && value < 20 };
}
export function quotaSummaryParts(agent: AgentUsageLimits, now: number, t: TFunction, customProvider = false) {
  if (customProvider || quotaStale(agent, now)) return "—";
  const windows = generalQuotaWindows(agent);
  if (!windows.length || agent.availability !== "available") return agent.fetchState === "refreshing" ? "…" : "—";
  return windows.map((window) => {
    const value = currentRemaining(window, now);
    return { id: window.id, period: quotaPeriod(window.windowDurationMins, t, true),
      text: value === null ? "—" : t("settings.usage.limits.left", { percent: quotaPercent(value) }), low: value !== null && value < 20 };
  });
}
export function quotaSummary(agent: AgentUsageLimits, now: number, t: TFunction, customProvider = false) {
  const parts = quotaSummaryParts(agent, now, t, customProvider);
  return typeof parts === "string" ? parts : parts.map((part) => `${part.period} ${part.text}`).join(" · ");
}
/* 同一批事实，两种读法：屏幕阅读器要一个无歧义的完整日期，悬浮面板只有 272px
   且要让人一眼看到还剩多少——所以模型只有一份，日期的长短由 compact 决定。 */
export type QuotaDetail = {
  scope: string;
  status?: string;
  windows: { title: string; reading: string; caution: boolean; reset: string; previousReset?: string }[];
  notes: string[];
};
function compactReset(window: AgentQuotaWindow, agent: AgentUsageLimits, now: number, t: TFunction) {
  if (quotaWindowExpired(window, now)) return t(agent.fetchState === "refreshing" ? "settings.usage.limits.resetPending" : "settings.usage.limits.resetEnded");
  return window.resetsAt === null ? t("settings.usage.limits.resetUnknown") : t("settings.usage.limits.resets", { date: quotaResetClock(window.resetsAt, now) });
}
export function quotaDetail(agent: AgentUsageLimits, now: number, t: TFunction, customProvider = false, compact = false): QuotaDetail {
  const detail: QuotaDetail = { scope: t(customProvider ? "settings.usage.limits.customProvider" : "settings.usage.limits.scope"), windows: [], notes: [] };
  if (!customProvider) {
    const status = quotaStatus(agent, now, t);
    if (status) detail.status = status;
    for (const window of generalQuotaWindows(agent)) {
      const value = remainingPercent(window.usedPercent);
      const expired = quotaWindowExpired(window, now);
      detail.windows.push({
        title: quotaPeriod(window.windowDurationMins, t),
        reading: value === null ? "—" : t(expired || quotaStale(agent, now) ? "settings.usage.limits.previousValue" : "settings.usage.limits.left", { percent: quotaPercent(value) }),
        caution: value !== null && value < 20,
        reset: compact ? compactReset(window, agent, now, t) : quotaReset(window, agent, now, t),
        ...(expired && window.resetsAt !== null
          ? { previousReset: t("settings.usage.limits.previousReset", { date: compact ? quotaResetClock(window.resetsAt, now) : quotaDate(window.resetsAt) }) }
          : {}),
      });
    }
    if (agent.receivedAt !== null) detail.notes.push(t("settings.usage.limits.checked", { date: compact ? quotaResetClock(agent.receivedAt, now) : quotaDate(agent.receivedAt) }));
    if (agent.source === "claude-sdk-query") detail.notes.push(t("settings.usage.limits.cachedSource"));
  }
  detail.notes.push(t("settings.usage.limits.timeZone", { timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }));
  return detail;
}
export function quotaDescription(agent: AgentUsageLimits, now: number, t: TFunction, customProvider = false) {
  const detail = quotaDetail(agent, now, t, customProvider);
  const text: string[] = [detail.scope];
  if (detail.status) text.push(detail.status);
  for (const window of detail.windows) {
    text.push(`${window.title} · ${window.reading} · ${window.reset}`);
    if (window.previousReset) text.push(window.previousReset);
  }
  text.push(...detail.notes);
  return text.join("\n");
}
