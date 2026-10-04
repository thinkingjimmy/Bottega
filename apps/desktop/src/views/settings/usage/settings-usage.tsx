/**
 * [INPUT]: Depends on React, SettingsPage, the setup context (custom routes and the Terminal sign-in), Settings/Usage primitives, UsageLimitsSection, quota/history/settings stores, backendLabel and existing controls.
 * [OUTPUT]: Provides account quotas/reset details above independent history and a combined refresh action in UsageSettingsView, with warnings only for usage really missing from the numbers inside the persistent history panel (so source switches preserve the reading position), a loading skeleton in the content's own order, and a price-update switch that reports its own save failure.
 * [POS]: apps/desktop/src/views/settings/usage; Settings layer's Usage view; holds no snapshot of its own — subscribes to usageStore and dispatches intents
 */

import { UsageLimitsSection } from "@/components/settings/usage/limits/section";
import { useSetup } from "@/components/providers/setup-provider";
import type { AgentBackendId } from "../../../../shared/ipc/agent/agent-ipc";
import { usageLimitsStore } from "@/lib/usage-limits/store";
import { useUsageLimits } from "@/lib/usage-limits/hooks";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useAppTranslation } from "@/components/providers/preferences/i18n-provider";
import { AlertTriangle, RefreshCw } from "lucide-react";
import type { AgentUsageSummary, UsageQueryTarget } from "../../../../shared/ipc/settings/usage-ipc";
import { SettingsPage } from "@/components/page-shell";
import {
  UsageHeatmap,
  UsageHeatmapLegend,
} from "@/components/settings/usage/charts/usage-heatmap";
import { UsageRegion } from "@/components/settings/usage/usage-region";
import { UsageSourceRail } from "@/components/settings/usage/usage-source-rail";
import { UsageStatRow } from "@/components/settings/usage/usage-stat-row";
import { UsageToday } from "@/components/settings/usage/charts/usage-today";
import {
  SettingsButton,
  SettingsCanvas,
  SettingsList,
  SettingsRow,
  SettingsSection,
  SettingsSwitch,
} from "@/components/settings/settings-layout";
import { backendLabel } from "@/lib/agent/agent-backends";
import { intlLocale } from "@/lib/appearance/i18n-locale";
import { settingsStore } from "@/lib/settings/store/settings-store";
import { usageStore } from "@/lib/usage/usage-store";
import {
  usageIssueWarnings,
  usageStatus,
  type UsageStatus,
  type UsageSummaries,
} from "@/lib/usage/usage-view-state";
import { Button } from "@ai-chat/ui/components/ui/button";
import { Skeleton } from "@ai-chat/ui/components/ui/skeleton";

/* ============================================================
 * 加载只说两件事：这里将出现什么形状（骨架）、它还在动（转圈）。
 * 一行「正在扫描日志 12,340 / 50,000」既不能加速扫描，也让版面
 * 在数字跳动中抖动，删掉它页面反而更安静。
 * ============================================================ */

/* 骨架按正文的顺序：全时段的六格数字、今天、一年热力图——否则首次加载时整页先按旧顺序画一遍再跳。 */
function LoadingPanel() {
  const { t } = useAppTranslation();
  return (
    <div role="status" aria-label={t("settings.usage.loading")} aria-busy="true">
      <div className="p-4">
        <Skeleton className="h-8 w-24" />
        <div className="mt-3 grid grid-cols-3 gap-x-6 gap-y-7 @3xl:grid-cols-6">
          {Array.from({ length: 6 }, (_, cell) => (
            <div key={cell} className="space-y-2">
              <Skeleton className="h-8 w-16" />
              <Skeleton className="h-3 w-20" />
            </div>
          ))}
        </div>
      </div>
      <div className="border-t p-4">
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

  /* 先给全貌再给细节：全时段的几个总数是读者进来最想确认的，
     然后是今天（右栏近 30 天），最后才是一年的热力图。 */
  return (
    <div className="divide-y divide-border">
      <UsageRegion title={t("settings.usage.allTime")}>
        <UsageStatRow summary={summary} />
      </UsageRegion>
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
  /* The failure is said here, beside the switch: the store's global error surfaced on another page, under another setting. */
  const [retryValue, setRetryValue] = useState<boolean | null>(null);
  const save = async (usagePricingAutoRefresh: boolean) => {
    setRetryValue(null);
    const saved = await settingsStore.update(
      { usagePricingAutoRefresh },
      t("settings.usage.pricingRefreshSaveFailed"),
      { errorScope: "local" }
    );
    if (!saved) setRetryValue(usagePricingAutoRefresh);
  };

  useEffect(() => {
    settingsStore.ensureLoaded();
  }, []);

  return (
    <SettingsSection title={t("settings.usage.pricingTitle")}>
      <SettingsList>
        <SettingsRow
          label={t("settings.usage.pricingRefresh")}
          htmlFor="usage-pricing-auto-refresh"
          description={<>
            {t("settings.usage.pricingRefreshDescription")}
            {retryValue !== null && <span role="alert" className="mt-1 block text-destructive">
              {t("settings.usage.pricingRefreshSaveFailed")}{" "}
              <SettingsButton variant="link" onClick={() => void save(retryValue)}>{t("common.retry")}</SettingsButton>
            </span>}
          </>}
          control={
            settings ? (
              <SettingsSwitch
                id="usage-pricing-auto-refresh"
                label={t("settings.usage.pricingRefreshAria")}
                checked={settings.usagePricingAutoRefresh}
                onToggle={(usagePricingAutoRefresh) => void save(usagePricingAutoRefresh)}
              />
            ) : (
              <Skeleton className="h-[18px] w-8 rounded-full" />
            )
          }
        />
      </SettingsList>
    </SettingsSection>
  );
}

export function UsageSettingsView({ focusAgent = null }: { focusAgent?: AgentBackendId | null }) {
  const { t } = useAppTranslation();
  const activation = useRef<object>({});
  const { target, view, progress } = useSyncExternalStore(
    usageStore.subscribe,
    usageStore.getSnapshot
  );

  useEffect(() => {
    usageStore.activate(activation.current);
  }, []);

  /* An Agent routed to a custom endpoint has no subscription limits; the section says so and how to change it. */
  const setup = useSetup();
  const customRoutes = new Set<string>(setup.status?.backends.filter((backend) => backend.availability?.route === "custom").map((backend) => backend.id));
  const signIn = { run: (backend: AgentBackendId) => void setup.terminalAction(backend, "login"), busy: (backend: AgentBackendId) => setup.busy[backend] === "login" };
  const status = usageStatus(view);
  const summaryIssues = usageIssueWarnings(view.summaries[target]?.issues ?? []);
  /* 请求在飞或后台还在扫盘，都归结为同一个字：忙 */
  const quota = useUsageLimits();
  const busy = status === "loading" || Object.keys(progress).length > 0 || quota.snapshot.agents.some((agent) => agent.fetchState === "refreshing");

  return (
    <SettingsPage
      title={t("common.usage")}
      actions={
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          aria-label={t("settings.usage.refresh")}
          data-testid="usage-refresh"
          data-busy={busy}
          onClick={() => { void usageStore.refresh(); void usageLimitsStore.refresh(); }}
        >
          <RefreshCw className={busy ? "animate-spin" : ""} />
        </Button>
      }
    >
      <SettingsCanvas>
        <UsageLimitsSection focusAgent={focusAgent} customRoutes={customRoutes} signIn={signIn} />
        <h2 className="mb-3 font-heading text-sm font-semibold">{t("settings.usage.limits.history")}</h2>
        <div
          data-testid="usage-view"
          data-target={target}
          data-status={status}
          className="space-y-3"
        >
          {/* 页签与面板同属一张表面：选中的那一页把分界线接管过去，
              于是「这块面板归哪个源」不再需要猜。 */}
          <UsageSourceRail
            value={target}
            summaries={view.summaries}
            loading={status === "loading"}
            onChange={usageStore.setTarget}
          >
            {/* Only usage really missing from the numbers is said, in amber; everything that asks nothing of the reader stays quiet. */}
            {summaryIssues.length > 0 && (
              <div
                role="alert"
                className="m-4 space-y-1 rounded-md bg-amber-500/10 px-3 py-2 text-amber-700 text-xs ring-1 ring-amber-500/20 dark:text-amber-400"
              >
                {summaryIssues.map((issue) => (
                  <p key={`${issue.source}:${issue.key}`}>
                    <AlertTriangle className="mr-1 inline size-3.5" />
                    {backendLabel(issue.source)} · {t(issue.key, { count: issue.count, formatted: issue.count.toLocaleString(intlLocale()) })}
                  </p>
                ))}
              </div>
            )}
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
    </SettingsPage>
  );
}
