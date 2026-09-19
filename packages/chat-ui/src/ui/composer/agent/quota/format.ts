/**
 * [INPUT]: Shared quota facts, a locale getter and an injected translator.
 * [OUTPUT]: One quota formatting policy for native and remote selectors and Settings.
 * [POS]: The Agent quota's pure formatting layer beside copy.ts; missing values and expired windows never become zero use.
 */
import { currentRemaining, generalQuotaWindows, generalRemaining, quotaStale, quotaWindowExpired, remainingPercent } from "@ai-chat/cloud-protocol/remote/quota";
import type { AgentQuotaWindow, AgentUsageLimits } from "@ai-chat/cloud-protocol/remote/quota";
type Translate = (key: string, values?: Record<string, unknown>) => string;
export function createQuotaFormat(intlLocale: () => string) {
function quotaPercent(value: number | null, locale = intlLocale()) {
  if (value === null || !Number.isFinite(value) || value < 0) return "—";
  if (value > 0 && value < 1) return "<" + new Intl.NumberFormat(locale, { style: "percent" }).format(0.01);
  return new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 0 }).format(Math.floor(Math.min(100, value)) / 100);
}
function quotaDate(value: number, locale = intlLocale(), timeZone?: string) {
  return new Intl.DateTimeFormat(locale, { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", ...(timeZone ? { timeZone } : {}) }).format(value);
}
function quotaPeriod(window: AgentQuotaWindow, t: Translate, compact = false) {
  if (window.calendarPeriod === "month") return t(compact ? "settings.usage.limits.month" : "settings.usage.limits.monthly");
  const minutes = window.windowDurationMins;
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
function quotaResetClock(resetsAt: number, now: number, locale = intlLocale()) {
  const sameDay = new Date(resetsAt).toDateString() === new Date(now).toDateString();
  return new Intl.DateTimeFormat(locale, sameDay
    ? { hour: "numeric", minute: "2-digit" }
    : { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(resetsAt);
}
function quotaReset(window: AgentQuotaWindow, agent: AgentUsageLimits, now: number, t: Translate) {
  if (quotaWindowExpired(window, now)) return t(agent.fetchState === "refreshing" ? "settings.usage.limits.resetPending" : "settings.usage.limits.resetEnded");
  return window.resetsAt === null ? t("settings.usage.limits.resetUnknown") : t("settings.usage.limits.resets", { date: quotaDate(window.resetsAt) });
}
function quotaStatus(agent: AgentUsageLimits, now: number, t: Translate) {
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
function quotaHeadline(agent: AgentUsageLimits, now: number) {
  const value = agent.availability === "available" && !quotaStale(agent, now) ? generalRemaining(agent, now) : null;
  return { text: quotaPercent(value), low: value !== null && value < 20 };
}
function quotaSummaryParts(agent: AgentUsageLimits, now: number, t: Translate, customProvider = false) {
  if (customProvider) return t("settings.usage.limits.summaryCustomProvider");
  if (quotaStale(agent, now)) return t("settings.usage.limits.summaryStale");
  const windows = generalQuotaWindows(agent);
  if (!windows.length || agent.availability !== "available") {
    if (agent.fetchState === "refreshing") return t("settings.usage.limits.loading");
    if (agent.fetchState === "deferred") return t("settings.usage.limits.summaryDeferred");
    return t(agent.availability === "unsupported" ? "settings.usage.limits.summaryUnsupported" : "settings.usage.limits.summaryUnavailable");
  }
  return windows.slice(0, 2).map((window) => {
    const value = currentRemaining(window, now);
    return { id: window.id, period: quotaPeriod(window, t, true),
      text: value === null ? "—" : t("settings.usage.limits.left", { percent: quotaPercent(value) }), low: value !== null && value < 20 };
  });
}
function quotaSummary(agent: AgentUsageLimits, now: number, t: Translate, customProvider = false) {
  const parts = quotaSummaryParts(agent, now, t, customProvider);
  return typeof parts === "string" ? parts : parts.map((part) => `${part.period} ${part.text}`).join(" · ");
}
/* 同一批事实，两种读法：屏幕阅读器要一个无歧义的完整日期，悬浮面板只有 272px
   且要让人一眼看到还剩多少——所以模型只有一份，日期的长短由 compact 决定。 */
type QuotaDetail = {
  scope: string;
  status?: string;
  windows: { title: string; reading: string; caution: boolean; reset: string; previousReset?: string }[];
  notes: string[];
};
function compactReset(window: AgentQuotaWindow, agent: AgentUsageLimits, now: number, t: Translate) {
  if (quotaWindowExpired(window, now)) return t(agent.fetchState === "refreshing" ? "settings.usage.limits.resetPending" : "settings.usage.limits.resetEnded");
  return window.resetsAt === null ? t("settings.usage.limits.resetUnknown") : t("settings.usage.limits.resets", { date: quotaResetClock(window.resetsAt, now) });
}
function quotaDetail(agent: AgentUsageLimits, now: number, t: Translate, customProvider = false, compact = false): QuotaDetail {
  const scope = customProvider ? t("settings.usage.limits.customProvider")
    : agent.source === "opencode-go-api" ? "OpenCode Go" : compact ? "" : t("settings.usage.limits.scope");
  const detail: QuotaDetail = { scope, windows: [], notes: [] };
  if (!customProvider) {
    const status = quotaStatus(agent, now, t);
    if (status) detail.status = status;
    for (const window of generalQuotaWindows(agent)) {
      const value = remainingPercent(window.usedPercent);
      const expired = quotaWindowExpired(window, now);
      detail.windows.push({
        title: quotaPeriod(window, t),
        reading: value === null ? "—" : t(expired || quotaStale(agent, now) ? "settings.usage.limits.previousValue" : "settings.usage.limits.left", { percent: quotaPercent(value) }),
        caution: value !== null && value < 20,
        reset: compact ? compactReset(window, agent, now, t) : quotaReset(window, agent, now, t),
        ...(expired && window.resetsAt !== null
          ? { previousReset: t("settings.usage.limits.previousReset", { date: compact ? quotaResetClock(window.resetsAt, now) : quotaDate(window.resetsAt) }) }
          : {}),
      });
    }
    if (agent.receivedAt !== null) {
      const checked = t("settings.usage.limits.checked", { date: compact ? quotaResetClock(agent.receivedAt, now) : quotaDate(agent.receivedAt) });
      detail.notes.push(compact ? `${checked} · ${Intl.DateTimeFormat().resolvedOptions().timeZone}` : checked);
    }
    if (agent.source === "claude-sdk-query") detail.notes.push(t("settings.usage.limits.cachedSource"));
  }
  if ((!compact || agent.receivedAt === null) && (detail.windows.length || detail.notes.length)) {
    detail.notes.push(t("settings.usage.limits.timeZone", { timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }));
  }
  return detail;
}
function quotaDescription(agent: AgentUsageLimits, now: number, t: Translate, customProvider = false) {
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

return { quotaPercent, quotaDate, quotaPeriod, quotaResetClock, quotaReset, quotaStatus, quotaHeadline, quotaSummaryParts, quotaSummary, quotaDetail, quotaDescription };
}
export type QuotaDetail = ReturnType<ReturnType<typeof createQuotaFormat>["quotaDetail"]>;
