/**
 * [INPUT]: Depends on i18n, shared AgentUsageSummary, renderer, current Intl locale, use-client, formatting/three-dimensional fees with the same directory UsageInfoTip
 * [OUTPUT]: Provides six indicators UsageStatRow: Lifetime tokens + cost with four lengths/days, width in a row of 6 grams
 * [POS]: The file band of the settings/usage sub-module, located at the end of the card; The price of the product is not recalculated
 */

import type { AgentUsageSummary } from "../../../../shared/usage-ipc";
import { UsageInfoTip } from "@/components/settings/usage/usage-info-tip";
import {
  activeDayCount,
  costText,
  formatCompactTokens,
  formatCompactUsd,
  formatUsd,
  formatUsageDuration,
} from "@/lib/usage-client";
import { intlLocale } from "@/lib/i18n-locale";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import type { TFunction } from "i18next";

type StatItem = {
  key: string;
  label: string;
  value: string;
  title?: string;
  note?: string;
};

function dayCount(value: number, t: TFunction) {
  return t("settings.usage.day", {
    count: value,
    formatted: value.toLocaleString(intlLocale()),
  });
}

function tokens(value: number, t: TFunction) {
  const count = Math.max(0, Math.round(value));
  return {
    value: formatCompactTokens(value),
    title: t("settings.usage.tokens", {
      count,
      formatted: count.toLocaleString(intlLocale()),
    }),
  };
}

/* 压缩值与精确值同形时不必再挂 title，tooltip 不重复念一遍已经看见的字 */
function cost(
  costUsd: number,
  total: number,
  unpriced: number,
  note: string
) {
  const value = costText(costUsd, total, unpriced, formatCompactUsd);
  const title = costText(costUsd, total, unpriced, formatUsd);
  return { value, title: title === value ? undefined : title, note };
}

export function UsageStatRow({ summary }: { summary: AgentUsageSummary }) {
  const { t } = useAppTranslation();
  const { stats, daily, dailyUnpricedTokens } = summary;
  const unpricedTotal = Object.values(dailyUnpricedTokens).reduce(
    (sum, value) => sum + value,
    0
  );
  const costNote = t("settings.usage.costNote");

  /* ==========================================================
   * 六格全是同一类东西：数量或时长。
   *
   * 峰值日那两格已经删了，理由不是「重复」而是它们站错了地方——
   * 热力图就是峰值日的所在地，最深那一格的 tooltip 已经把日期、
   * token、费用三样一起给了。更能说明问题的是它们曾需要一个 detail()
   * 把日期拼进 title：一个必须靠 tooltip 补语境才站得住的指标，
   * 本就不该占一个格子。删掉它们，detail()、peakOn 一并消失。
   * ========================================================== */

  const items: StatItem[] = [
    { key: "lifetime-tokens", label: t("settings.usage.lifetimeTokens"), ...tokens(stats.lifetimeTokens, t) },
    {
      key: "lifetime-cost",
      label: t("settings.usage.lifetimeCost"),
      ...cost(
        stats.lifetimeCostUsd,
        stats.lifetimeTokens,
        unpricedTotal,
        costNote
      ),
    },
    {
      key: "active-days",
      label: t("settings.usage.activeDays"),
      value: dayCount(activeDayCount(daily), t),
    },
    {
      key: "longest-chat",
      label: t("settings.usage.longestChat"),
      value: formatUsageDuration(stats.longestChatMs),
    },
    {
      key: "current-streak",
      label: t("settings.usage.currentStreak"),
      value: dayCount(stats.currentStreakDays, t),
    },
    {
      key: "longest-streak",
      label: t("settings.usage.longestStreak"),
      value: dayCount(stats.longestStreakDays, t),
    },
  ];

  return (
    <section
      aria-label={t("settings.usage.statistics")}
      data-testid="usage-stats"
      className="grid grid-cols-3 gap-x-6 gap-y-7 @3xl:grid-cols-6"
    >
      {items.map((item) => (
        <div key={item.key} className="min-w-0">
          <strong
            data-testid={`usage-stat-${item.key}`}
            title={item.title}
            className="block truncate font-heading font-semibold text-2xl tracking-tight tabular-nums"
          >
            {item.value}
          </strong>
          <span className="mt-1 flex min-w-0 items-center gap-1 text-muted-foreground text-xs">
            <span className="truncate">{item.label}</span>
            {item.note ? <UsageInfoTip text={item.note} /> : null}
          </span>
        </div>
      ))}
    </section>
  );
}
