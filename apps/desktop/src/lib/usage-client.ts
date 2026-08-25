/**
 * [INPUT]: Depends on shared Usage IPC/calendar agreement, renderer current Intl locale and preload exposed window.usage
 * [OUTPUT]: Provides Summary Queries, progress/price subscriptions, USD/compact/time/date formatting and heat chart classification of pure functions
 * [POS]: The use of IPC access boundaries of the renderer; View does not directly read windows or self-invent statistical qualities
 */

import { dayKey } from "../../shared/usage-calendar";
import { intlLocale } from "./i18n-locale";
import type {
  AgentUsageSummary,
  DailyTokens,
  UsageBridgeApi,
  UsageQueryTarget,
  UsagePricingUpdate,
  UsageScanProgress,
} from "../../shared/usage-ipc";

declare global {
  interface Window {
    usage?: UsageBridgeApi;
  }
}

/* ============================================================
 * 指标格子的宽度必须有上界，否则任何足够大的数字都会被 truncate
 * 吞掉尾巴。压缩单位把「多长都可能」变成「最多四五个字符」，
 * 于是「装不下」这个特例根本不会发生，精确值退到 title 里。
 * ============================================================ */

const COMPACT_UNITS = [
  { threshold: 1_000_000_000, suffix: "B" },
  { threshold: 1_000_000, suffix: "M" },
  { threshold: 1_000, suffix: "K" },
] as const;

function compact(value: number) {
  const unit = COMPACT_UNITS.find(({ threshold }) => value >= threshold);
  if (!unit) return null;
  const rounded = Math.round((value / unit.threshold) * 10) / 10;
  return `${rounded.toFixed(1).replace(/\.0$/, "")}${unit.suffix}`;
}

function positive(value: number) {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

export function formatCompactTokens(value: number) {
  const safe = positive(value);
  return compact(safe) ?? Math.round(safe).toLocaleString(intlLocale());
}

export function formatUsd(value: number) {
  return new Intl.NumberFormat(intlLocale(), {
    style: "currency",
    currency: "USD",
    currencyDisplay: "narrowSymbol",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number.isFinite(value) && value >= 0 ? value : 0);
}

/** 指标格子用；四位数以上压成 `$14.7K`，小额仍走两位小数的精确写法 */
export function formatCompactUsd(value: number) {
  const safe = positive(value);
  const short = compact(safe);
  return short ? `$${short}` : formatUsd(safe);
}

/* ============================================================
 * 三态费用只有一个判据：这批 token 里有没有一枚被计价。
 * 全未计价 → `—`，部分计价 → `$x+`，全部计价 → `$x`。
 * 终身、峰值日、热力图逐日共用它，规则就不会各写各的。
 * ============================================================ */

export function costText(
  costUsd: number,
  tokens: number,
  unpricedTokens: number,
  format: (value: number) => string
) {
  if (tokens <= unpricedTokens) return "—";
  return `${format(costUsd)}${unpricedTokens > 0 ? "+" : ""}`;
}

/* ============================================================
 * dayKey 已是「某时区的那一天」，再套时区只会漂移一天，
 * 因此格式化固定按 UTC 读回同一组年月日。
 * ============================================================ */

export function formatDayKey(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Intl.DateTimeFormat(intlLocale(), {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

export function formatUsageDuration(value: number) {
  const totalMinutes = Math.max(0, Math.floor(value / 60_000));
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = totalMinutes % 60;
  const format = (amount: number, unit: "day" | "hour" | "minute") =>
    new Intl.NumberFormat(intlLocale(), {
      style: "unit",
      unit,
      unitDisplay: "narrow",
    }).format(amount);
  if (days > 0) return `${format(days, "day")}${hours > 0 ? ` ${format(hours, "hour")}` : ""}`;
  if (hours > 0) return `${format(hours, "hour")}${minutes > 0 ? ` ${format(minutes, "minute")}` : ""}`;
  return format(minutes, "minute");
}

function quantile(sorted: number[], fraction: number) {
  if (sorted.length === 0) return 0;
  const position = (sorted.length - 1) * fraction;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  const weight = position - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

/* ============================================================
 * 「活跃日」只定义一次：当天有过正数 token。分位阈值与活跃天数
 * 都从这里长出来，不会哪天一个算 0 值一个不算。
 *
 * 活跃天数刻意由 renderer 从 daily 归约，而不是进 UsageStats：
 * 四源合并时它是日期集合的并集而非求和，交给已经合并好的
 * daily 表推导，正确性是结构保证的，不靠 merge 再写一条规则。
 * ============================================================ */

function activeValues(daily: DailyTokens) {
  return Object.values(daily).filter(
    (value) => Number.isFinite(value) && value > 0
  );
}

export function activeDayCount(daily: DailyTokens) {
  return activeValues(daily).length;
}

export function usageThresholds(daily: DailyTokens) {
  const values = activeValues(daily).sort((left, right) => left - right);
  return [
    quantile(values, 0.25),
    quantile(values, 0.5),
    quantile(values, 0.75),
  ] as const;
}

export function usageLevel(
  tokens: number,
  thresholds: readonly [number, number, number]
) {
  if (!Number.isFinite(tokens) || tokens <= 0) return 0;
  if (tokens <= thresholds[0]) return 1;
  if (tokens <= thresholds[1]) return 2;
  if (tokens <= thresholds[2]) return 3;
  return 4;
}

function fallbackSummary(target: UsageQueryTarget): AgentUsageSummary {
  const timeZone =
    Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  return {
    target,
    status: "no-data",
    stats: {
      lifetimeTokens: 0,
      lifetimeCostUsd: 0,
      peakDayTokens: 0,
      peakDay: null,
      longestChatMs: 0,
      currentStreakDays: 0,
      longestStreakDays: 0,
    },
    daily: {},
    dailyCostUsd: {},
    dailyUnpricedTokens: {},
    pricingRevision: 0,
    timeZone,
    todayKey: dayKey(Date.now(), timeZone),
    scannedFiles: 0,
    issues: [],
  };
}

export function getUsageSummary(
  target: UsageQueryTarget,
  options?: { forceRefresh?: boolean }
) {
  return (
    window.usage?.getSummary(target, options) ??
    Promise.resolve(fallbackSummary(target))
  );
}

export function subscribeScanProgress(
  callback: (progress: UsageScanProgress) => void
) {
  return window.usage?.onScanProgress(callback) ?? (() => undefined);
}

export function subscribePricingUpdated(
  callback: (update: UsagePricingUpdate) => void
) {
  return window.usage?.onPricingUpdated(callback) ?? (() => undefined);
}
