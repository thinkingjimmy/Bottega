/**
 * [INPUT]: Depends on React, PageShell, settings SettingsCanvas/Surface/List/Row/Switch, SourceRail/UsageToday/UsageRegion/StatRow/Heatmap, Module level usageStore/settingsStore, backendLabel, Button/Skeleton
 * [OUTPUT]: Provides UsageSettingsView: a page tag with three pages on the same surface ((Today's view → One year of activity → Full-time archives), skeleton loads, problem grading and automatic update switches for the price attributed to this page
 * [POS]: The Settings layer covers the Usage view; Conditions are uploaded so no snapshots are available, subscribe to usageStore and send intentions
 */

import { useEffect, useRef, useSyncExternalStore } from "react";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import { AlertTriangle, ChartNoAxesColumnIncreasing, RefreshCw } from "lucide-react";
import type { AgentUsageSummary, UsageQueryTarget } from "../../shared/usage-ipc";
import { PageShell } from "@/components/page-shell";
import {
  UsageHeatmap,
  UsageHeatmapLegend,
} from "@/components/settings/usage/usage-heatmap";
import { UsageRegion } from "@/components/settings/usage/usage-region";
import { UsageSourceRail } from "@/components/settings/usage/usage-source-rail";
import { UsageStatRow } from "@/components/settings/usage/usage-stat-row";
import { UsageToday } from "@/components/settings/usage/usage-today";
import {
  SettingsAlert,
  SettingsCanvas,
  SettingsList,
  SettingsRow,
  SettingsSection,
  SettingsSwitch,
} from "@/components/settings/settings-layout";
import { backendLabel } from "@/lib/agent-backends";
import { hasSettingsBridge } from "@/lib/settings-client";
import { settingsStore } from "@/lib/settings-store";
import { usageStore } from "@/lib/usage-store";
import {
  usageCacheNotes,
  usageStatus,
  type UsageStatus,
  type UsageSummaries,
} from "@/lib/usage-view-state";
import { Button } from "@ai-chat/ui/components/ui/button";
import { Skeleton } from "@ai-chat/ui/components/ui/skeleton";

/* ============================================================
 * 加载只说两件事：这里将出现什么形状（骨架）、它还在动（转圈）。
 * 一行「正在扫描日志 12,340 / 50,000」既不能加速扫描，也让版面
 * 在数字跳动中抖动，删掉它页面反而更安静。
 * ============================================================ */

function LoadingPanel() {
  const { t } = useAppTranslation();
  return (
    <div aria-label={t("settings.usage.loading")} aria-busy="true">
      <div className="p-4">
        <Skeleton className="h-8 w-24" />
        <div className="mt-3 flex flex-col gap-6 @2xl:flex-row">
          <div className="space-y-2 @2xl:w-64 @2xl:shrink-0">
            <Skeleton className="h-9 w-36" />
            <Skeleton className="h-3 w-40" />
          </div>
          <Skeleton className="h-36 min-w-0 flex-1" />
        </div>
      </div>
      <div className="space-y-4 border-t p-4">
        <Skeleton className="h-8 w-28" />
        {Array.from({ length: 7 }, (_, row) => (
          <Skeleton key={row} className="h-3 w-full" />
        ))}
      </div>
    </div>
  );
}

/* ============================================================
 * 正文只有三种形态：没数据（加载中/失败）、有数据但为空、有数据。
 * 早返回把它们摊平，调用处不再堆三元嵌套。
 *
 * 三种形态都长在页签面板里，因此都不自带表面——表面归 SourceRail，
 * 它才知道这块面板属于哪一个源。空态也就不必再围一圈虚线：卡片
 * 已经给了形状，虚线只会变成框中框。
 * ============================================================ */

export function UsageContent({
  summaries,
  target,
  status,
}: {
  summaries: UsageSummaries;
  target: UsageQueryTarget;
  status: UsageStatus;
}) {
  const { t } = useAppTranslation();
  const summary: AgentUsageSummary | null = summaries[target];

  if (!summary) {
    if (status === "loading") return <LoadingPanel />;
    return (
      <p className="px-6 py-12 text-center text-destructive text-sm">
        {t("settings.usage.readFailed")}
      </p>
    );
  }

  if (summary.status === "no-data") {
    return (
      <div className="px-6 py-14 text-center">
        <p className="font-medium text-sm">
          {t("settings.usage.noDataTitle")}
        </p>
        <p className="mt-1 text-muted-foreground text-xs">
          {t("settings.usage.noDataDetail")}
        </p>
      </div>
    );
  }

  /* 段序是一具时间望远镜：今天 → 近 30 天（同一段的右栏）→ 一年 →
     全时段。此前它是倒过来的，而中间那一节根本不在。 */
  return (
    <div className="divide-y divide-border">
      <UsageToday summary={summary} summaries={summaries} target={target} />
      <UsageRegion
        title={t("settings.usage.tokenActivity")}
        action={<UsageHeatmapLegend />}
      >
        <UsageHeatmap
          daily={summary.daily}
          dailyCostUsd={summary.dailyCostUsd}
          dailyUnpricedTokens={summary.dailyUnpricedTokens}
          todayKey={summary.todayKey}
          timeZone={summary.timeZone}
        />
      </UsageRegion>
      <UsageRegion title={t("settings.usage.allTime")}>
        <UsageStatRow summary={summary} />
      </UsageRegion>
    </div>
  );
}

/* ============================================================
 * 价格开关自己订阅 settingsStore：Usage 的数据流与设置流互不相干，
 * 让它们在同一个组件里汇合只会让两边的加载态互相牵连。
 * ============================================================ */

function PricingRefreshRow() {
  const { t } = useAppTranslation();
  const { settings } = useSyncExternalStore(
    settingsStore.subscribe,
    settingsStore.getSnapshot
  );

  useEffect(() => {
    settingsStore.ensureLoaded();
  }, []);

  return (
    <SettingsSection title={t("settings.usage.pricingTitle")}>
      <SettingsList>
        <SettingsRow
          label={t("settings.usage.pricingRefresh")}
          htmlFor="usage-pricing-auto-refresh"
          description={t("settings.usage.pricingRefreshDescription")}
          control={
            settings ? (
              <SettingsSwitch
                id="usage-pricing-auto-refresh"
                label={t("settings.usage.pricingRefreshAria")}
                checked={settings.usagePricingAutoRefresh}
                disabled={!hasSettingsBridge()}
                onToggle={(usagePricingAutoRefresh) =>
                  void settingsStore.update(
                    { usagePricingAutoRefresh },
                    t("settings.usage.pricingRefreshSaveFailed")
                  )
                }
              />
            ) : (
              <Skeleton className="h-6 w-11 rounded-full" />
            )
          }
        />
      </SettingsList>
    </SettingsSection>
  );
}

export function UsageSettingsView() {
  const { t } = useAppTranslation();
  const activation = useRef<object>({});
  const { target, view, progress, error } = useSyncExternalStore(
    usageStore.subscribe,
    usageStore.getSnapshot
  );

  useEffect(() => {
    usageStore.activate(activation.current);
  }, []);

  const status = usageStatus(view);
  const summaryIssues =
    view.summaries[target]?.issues.filter((issue) => issue.affectsSummary) ??
    [];
  /* 请求在飞或后台还在扫盘，都归结为同一个字：忙 */
  const busy = status === "loading" || Object.keys(progress).length > 0;

  return (
    <PageShell
      title={t("common.usage")}
      icon={<ChartNoAxesColumnIncreasing />}
      actions={
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          aria-label={t("settings.usage.refresh")}
          data-testid="usage-refresh"
          data-busy={busy}
          onClick={usageStore.refresh}
        >
          <RefreshCw className={busy ? "animate-spin" : ""} />
        </Button>
      }
    >
      <SettingsCanvas>
        <div
          data-testid="usage-view"
          data-target={target}
          data-status={status}
          className="space-y-3"
        >
          {error && <SettingsAlert>{error}</SettingsAlert>}

          {summaryIssues.length > 0 && (
            <div
              role="alert"
              className="space-y-1 rounded-md bg-amber-500/10 px-3 py-2 text-amber-700 text-xs ring-1 ring-amber-500/20 dark:text-amber-400"
            >
              {summaryIssues.map((issue, index) => (
                <p key={`${issue.source}:${issue.kind}:${index}`}>
                  <AlertTriangle className="mr-1 inline size-3.5" />
                  {backendLabel(issue.source)} · {issue.message}
                </p>
              ))}
            </div>
          )}

          {/* 页签与面板同属一张表面：选中的那一页把分界线接管过去，
              于是「这块面板归哪个源」不再需要猜。 */}
          <UsageSourceRail
            value={target}
            summaries={view.summaries}
            notes={usageCacheNotes(view.summaries)}
            onChange={usageStore.setTarget}
          >
            <UsageContent
              summaries={view.summaries}
              target={target}
              status={status}
            />
          </UsageSourceRail>
        </div>

        {/* 价格开关归位：它只影响这一页的数字，也只在这一页能被看见
            生效。放在 General 里时，那个分组不得不管自己叫 "Usage"
            ——一个分组要借另一个页面的名字自证，就是站错了地方。

            它不戴段头：这一页的正文（那张卡）本身就没有段头，再给
            一个附属开关扣一个 14px 的标题带，层级就倒了过来。 */}
        <div className="mt-8">
          <PricingRefreshRow />
        </div>
      </SettingsCanvas>
    </PageShell>
  );
}
