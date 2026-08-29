/**
 * [INPUT]: Depends on i18n ⋅shared USAGE_SOURCE_ORDER/UsageQueryTarget ⋅lib agent-backends ⋅branded icons and compact tokens ⋅ formatting ⋅ directory UsageInfoTip ⋅ settings-layout ⋅ SettingsSurface ⋅ui Tabs/Skeleton
 * [OUTPUT]: Provides UsageSourceRail A surface with a side of the sidebar and the name of the adjacent lifetime token, in horizontal contrast to the side of the sidebar,
 * [POS]: The navigation of the settings/usage sub-module is in parallel with the horizontal contrast; The selector itself is data, and the panel is inserted by children
 */

import type { ReactNode } from "react";
import { Layers } from "lucide-react";
import {
  USAGE_SOURCE_ORDER,
  type UsageQueryTarget,
} from "../../../../shared/usage-ipc";
import { UsageInfoTip } from "@/components/settings/usage/usage-info-tip";
import { SettingsSurface } from "@/components/settings/settings-layout";
import { AgentBackendIcon, backendLabel } from "@/lib/agent-backends";
import { formatCompactTokens } from "@/lib/usage-client";
import type { UsageSourceNotes, UsageSummaries } from "@/lib/usage-view-state";
import { Skeleton } from "@ai-chat/ui/components/ui/skeleton";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@ai-chat/ui/components/ui/tabs";
import { useAppTranslation } from "@/components/providers/i18n-provider";

/* ============================================================
 * 源清单由 USAGE_SOURCE_ORDER 派生。它与后端注册域正交：新增
 * Agent 后端不会自动出现在这里，只有真正有本地用量账本的源才进表。
 * ============================================================ */

const SOURCES = [
  { target: "all" as UsageQueryTarget, label: "", icon: null },
  ...USAGE_SOURCE_ORDER.map((source) => ({
    target: source as UsageQueryTarget,
    label: backendLabel(source),
    icon: source,
  })),
];

/* ============================================================
 * 表面归这里，不再由调用方另起一张卡——与 memory-backend-tabs 同一条
 * 法则。页签条曾是一条灰底药丸，面板是它下面另一张卡，中间一道缝：
 * 于是「这块面板归哪个页签」要靠猜。现在两者是同一块表面的上下两段，
 * 归属只用一条 2px 下划线来说，压在页签与面板的分界线上。
 *
 * 每个页签都挂着自己的 lifetime token：藏起来的是面板，不是事实——
 * 四个源的横向对比必须常驻，否则选择本身无从下手。图标、名称与数字
 * 是一个内容组；等宽只属于页签本身，不能用 auto margin 把数字推到列尾。
 * ============================================================ */

export function UsageSourceRail({
  value,
  summaries,
  notes,
  onChange,
  children,
}: {
  value: UsageQueryTarget;
  summaries: UsageSummaries;
  notes: UsageSourceNotes;
  onChange: (target: UsageQueryTarget) => void;
  children: ReactNode;
}) {
  const { t } = useAppTranslation();
  return (
    <Tabs
      value={value}
      onValueChange={(next) => onChange(next as UsageQueryTarget)}
      className="gap-0"
    >
      <SettingsSurface>
        <TabsList
          variant="line"
          aria-label={t("settings.usage.source")}
          className="w-full items-stretch justify-start gap-0 rounded-none border-b border-border bg-transparent p-0 group-data-horizontal/tabs:h-auto"
        >
          {SOURCES.map((source) => {
            const summary = summaries[source.target];
            const note = notes[source.target];
            return (
              <TabsTrigger
                key={source.target}
                value={source.target}
                data-testid={`usage-tab-${source.target}`}
                className="h-auto flex-none cursor-pointer justify-start gap-2 rounded-none px-4 py-3 text-sm"
              >
                {source.icon ? (
                  <AgentBackendIcon backend={source.icon} className="size-4" />
                ) : (
                  <Layers className="size-4" />
                )}
                <span
                  data-testid={`usage-tab-label-${source.target}`}
                  className="min-w-0 truncate"
                >
                  {source.target === "all"
                    ? t("settings.usage.all")
                    : source.label}
                </span>
                {/* 数字用与 memory 页签同形的药丸：同一个位置只能有一种
                    形状，含义交给内容。它紧跟名称；等宽由外层 tab 承担。 */}
                {summary ? (
                  <span className="shrink-0 rounded-full bg-foreground/[0.06] px-2 py-0.5 font-medium text-[11px] tabular-nums">
                    {formatCompactTokens(summary.stats.lifetimeTokens)}
                  </span>
                ) : (
                  <Skeleton className="h-4 w-10 shrink-0 rounded-full" />
                )}
                {note ? <UsageInfoTip text={note} /> : null}
              </TabsTrigger>
            );
          })}
        </TabsList>
        {/* 面板只画一次：没被选中的页签在 Radix 里根本不挂载，调用方也就
            不必为四个源各备一份 props。 */}
        {SOURCES.map((source) => (
          <TabsContent key={source.target} value={source.target}>
            {source.target === value ? children : null}
          </TabsContent>
        ))}
      </SettingsSurface>
    </Tabs>
  );
}
