/**
 * [INPUT]: Depends on React useMemo/useState, i18n, shared usage-calendar addDays with USAGE_SOURCE_ORDER, usage-client tri-mode fees with formatting, agent-backends brand icons, with the same directory UsageRegion/UsageDailyChart/UsageInfoTip/color projection, ui Tabs
 * [OUTPUT]: Provides UsageToday: Today's cost/use ratio per source with a line of close to 30 days, Cost/Tokens is a switching tube
 * [POS]: The following is a list of the settings/usage sub-modules: The left side is the opening of the last point of the right side, and both are the same source
 */

import { useMemo, useState } from "react";
import { addDays } from "../../../../shared/usage-calendar";
import {
  USAGE_SOURCE_ORDER,
  type AgentUsageSummary,
  type UsageQueryTarget,
  type UsageSourceId,
} from "../../../../shared/usage-ipc";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import { UsageDailyChart } from "@/components/settings/usage/usage-daily-chart";
import { UsageInfoTip } from "@/components/settings/usage/usage-info-tip";
import {
  USAGE_MARK_LEVELS,
  USAGE_RAMP_BG,
} from "@/components/settings/usage/usage-ramp";
import { UsageRegion } from "@/components/settings/usage/usage-region";
import { AgentBackendIcon, backendLabel } from "@/lib/agent-backends";
import { intlLocale } from "@/lib/i18n-locale";
import {
  costText,
  formatCompactTokens,
  formatCompactUsd,
  formatDayKey,
  formatUsd,
} from "@/lib/usage-client";
import type { UsageSummaries } from "@/lib/usage-view-state";
import { Tabs, TabsList, TabsTrigger } from "@ai-chat/ui/components/ui/tabs";
import { cn } from "@ai-chat/ui/lib/utils";

/* ============================================================
 * 这一段填的是一个真实的信息空洞。
 *
 * 页面此前只有两个尺度：终身汇总（一组标量）与一年热力图（一整片
 * 形状），中间「最近这一个月」没有任何东西——而那恰恰是唯一能回答
 * 「我今天烧了多少、比平常多还是少」的尺度。
 *
 * 左栏是右栏最后一个点的展开：同一个事实的两种画法，故它们必须同源，
 * 不能一个读 stats 一个读 daily。两栏共用一个 metric 开关，也就没有
 * 「这个开关管半段」的疑问。
 * ============================================================ */

const WINDOW_DAYS = 30;
type Metric = "cost" | "tokens";

function recentDays(todayKey: string, count: number) {
  return Array.from({ length: count }, (_, index) =>
    addDays(todayKey, index - (count - 1))
  );
}

function dayValue(
  summary: AgentUsageSummary,
  dayKey: string,
  metric: Metric
) {
  return metric === "cost"
    ? (summary.dailyCostUsd[dayKey] ?? 0)
    : (summary.daily[dayKey] ?? 0);
}

/** 该源当日读法：费用走三态，token 走压缩 */
function dayText(
  summary: AgentUsageSummary,
  dayKey: string,
  metric: Metric
) {
  const tokens = summary.daily[dayKey] ?? 0;
  if (metric === "tokens") return formatCompactTokens(tokens);
  return costText(
    summary.dailyCostUsd[dayKey] ?? 0,
    tokens,
    summary.dailyUnpricedTokens[dayKey] ?? 0,
    formatUsd
  );
}

export function UsageToday({
  summary,
  summaries,
  target,
}: {
  summary: AgentUsageSummary;
  summaries: UsageSummaries;
  target: UsageQueryTarget;
}) {
  const { t } = useAppTranslation();
  const [metric, setMetric] = useState<Metric>("cost");
  const { todayKey } = summary;
  const days = useMemo(
    () => recentDays(todayKey, WINDOW_DAYS),
    [todayKey]
  );

  /* 分源既是图例也是堆叠次序，故只取一次；缺席的源不进表，
     而不是塞一条全零的带子进去装样子。 */
  const sources = useMemo(
    () => (
      target === "all"
        ? USAGE_SOURCE_ORDER.filter((source) => summaries[source])
        : []
    ) as UsageSourceId[],
    [summaries, target]
  );

  const bands = useMemo(
    () =>
      sources.length > 0
        ? sources.map((source) => ({
            key: source,
            values: days.map((day) =>
              dayValue(summaries[source] as AgentUsageSummary, day, metric)
            ),
          }))
        : [
            {
              key: target,
              values: days.map((day) => dayValue(summary, day, metric)),
            },
          ],
    [days, metric, sources, summaries, summary, target]
  );

  const todayTokens = summary.daily[todayKey] ?? 0;
  const headline =
    metric === "cost"
      ? dayText(summary, todayKey, "cost")
      : formatCompactTokens(todayTokens);
  const secondary =
    metric === "cost"
      ? t("settings.usage.tokens", {
          count: Math.max(0, Math.round(todayTokens)),
          formatted: Math.max(0, Math.round(todayTokens)).toLocaleString(
            intlLocale()
          ),
        })
      : dayText(summary, todayKey, "cost");
  const costNote = <UsageInfoTip text={t("settings.usage.rawTokenCostNote")} />;

  const rowTotal = sources.reduce(
    (sum, source) =>
      sum + dayValue(summaries[source] as AgentUsageSummary, todayKey, metric),
    0
  );
  const percent = (value: number, whole: number) =>
    new Intl.NumberFormat(intlLocale(), {
      style: "percent",
      maximumFractionDigits: 1,
    }).format(whole > 0 ? value / whole : 0);

  /* 单源视图下左栏没有清单可列，于是它退成这一个源占今天的比重。
     列表长度为 1 时不画列表——让特殊情况消失，而不是给它写分支。 */
  const wholeDay = summaries.all
    ? dayValue(summaries.all, todayKey, metric)
    : 0;
  const share =
    target === "all" || !summaries.all
      ? null
      : t("settings.usage.shareOfToday", {
          percent: percent(dayValue(summary, todayKey, metric), wholeDay),
          total: dayText(summaries.all, todayKey, metric),
        });

  return (
    <UsageRegion
      title={t("settings.usage.today")}
      meta={formatDayKey(todayKey)}
      action={
        <Tabs value={metric} onValueChange={(next) => setMetric(next as Metric)}>
          <TabsList aria-label={t("settings.usage.metric")}>
            <TabsTrigger
              value="cost"
              data-testid="usage-metric-cost"
              className="cursor-pointer px-2.5"
            >
              {t("settings.usage.metricCost")}
            </TabsTrigger>
            <TabsTrigger
              value="tokens"
              data-testid="usage-metric-tokens"
              className="cursor-pointer px-2.5"
            >
              {t("settings.usage.metricTokens")}
            </TabsTrigger>
          </TabsList>
        </Tabs>
      }
    >
      <div className="flex flex-col gap-6 @2xl:flex-row">
        <div className="flex flex-col @2xl:w-64 @2xl:shrink-0">
          <strong
            data-testid="usage-today-headline"
            className="block font-heading font-semibold text-3xl tracking-tight tabular-nums"
          >
            {headline}
          </strong>
          {/* 注解点跟着费用走：费用当头时它贴在「Raw token cost」旁边，
              token 当头时它贴在退到第二行的那笔费用旁边。 */}
          <span className="mt-0.5 flex min-w-0 flex-wrap items-center gap-1 text-muted-foreground text-xs">
            <span>
              {metric === "cost"
                ? t("settings.usage.rawTokenCost")
                : t("settings.usage.metricTokens")}
            </span>
            {metric === "cost" ? costNote : null}
            <span className="tabular-nums">· {secondary}</span>
            {metric === "tokens" ? costNote : null}
          </span>

          {/* 占比清单要与右栏 x 轴齐平，故 mt-auto 压到底；而单源那一句
              是在解释上面那个数字，把它一起推到底就离得太远了——解释
              贴在被解释的东西旁边，一条只有一行的说明也不必配分隔线。 */}
          {share ? (
            <p
              data-testid="usage-today-share"
              className="mt-3 text-muted-foreground text-xs"
            >
              {share}
            </p>
          ) : (
            <div className="mt-auto pt-4">
              <ul className="space-y-1 border-t pt-2">
                {sources.map((source, index) => {
                  const each = summaries[source] as AgentUsageSummary;
                  const value = dayValue(each, todayKey, metric);
                  return (
                    <li
                      key={source}
                      data-testid={`usage-today-source-${source}`}
                      className="flex items-center gap-2.5 py-1"
                    >
                      <AgentBackendIcon backend={source} className="size-3.5" />
                      <span className="w-14 shrink-0 truncate font-medium text-xs">
                        {backendLabel(source)}
                      </span>
                      <span
                        aria-hidden="true"
                        className={cn(
                          "h-1 min-w-0 flex-1 overflow-hidden rounded-full",
                          USAGE_RAMP_BG[0]
                        )}
                      >
                        <span
                          className={cn(
                            "block h-1 rounded-full",
                            USAGE_RAMP_BG[USAGE_MARK_LEVELS[index] ?? 2]
                          )}
                          style={{
                            width: percent(value, rowTotal),
                          }}
                        />
                      </span>
                      <span className="shrink-0 font-medium text-xs tabular-nums">
                        {dayText(each, todayKey, metric)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <UsageDailyChart
            bands={bands}
            days={days}
            gridAriaLabel={t("settings.usage.dailyChart", { days: WINDOW_DAYS })}
            formatAxis={
              metric === "cost" ? formatCompactUsd : formatCompactTokens
            }
            axisLabels={[
              formatDayKey(days[0]),
              formatDayKey(days[Math.floor((days.length - 1) / 2)]),
              formatDayKey(days[days.length - 1]),
            ]}
            label={(index) => {
              const day = days[index];
              const tokens = summary.daily[day] ?? 0;
              return t("settings.usage.cellLabel", {
                date: formatDayKey(day),
                tokens: formatCompactTokens(tokens),
                cost: costText(
                  summary.dailyCostUsd[day] ?? 0,
                  tokens,
                  summary.dailyUnpricedTokens[day] ?? 0,
                  formatUsd
                ),
              });
            }}
          />
        </div>
      </div>
    </UsageRegion>
  );
}
