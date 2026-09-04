/**
 * [INPUT]: Depends on the shared AppExtensionStatus/AppAgentVisibility DTOs, apps-client extension status, extensions-client invalidation, AppsProvider visibility, renderer i18n, and the Collapsible primitive
 * [OUTPUT]: Provides AppGrantNotice — the amber banner above an App surface plus its on-demand extension and delivery detail
 * [POS]: The Chat side-panel App tab's only failure disclosure; the tab badge says "something is wrong", this says what and offers the way out
 */

import { useEffect, useState } from "react";
import { ChevronRight, TriangleAlert } from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@ai-chat/ui/components/ui/collapsible";
import type {
  AppAgentOmission,
  AppExtensionStatus,
} from "../../../../../shared/apps-ipc";
import { readAppExtensionStatus } from "@/lib/apps-client";
import { onExtensionsChanged } from "@/lib/extensions-client";
import { useOptionalApps } from "@/components/providers/apps-provider";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import { intlLocale } from "@/lib/i18n-locale";
import { appVisibilityIssues } from "./app-grant-visibility";

const OMISSION_KEYS: Record<AppAgentOmission["reason"], string> = {
  "reference-limit": "chat.sidePanel.appGrant.omission.referenceLimit",
  "instruction-budget": "chat.sidePanel.appGrant.omission.instructionBudget",
  "backend-unsupported": "chat.sidePanel.appGrant.omission.backendUnsupported",
  "base-tools-disabled": "chat.sidePanel.appGrant.omission.baseToolsDisabled",
};

const DEGRADATION_KEYS = {
  "base-reads-disabled": "chat.sidePanel.appGrant.degradation.baseReadsDisabled",
  "base-row-mutations-disabled":
    "chat.sidePanel.appGrant.degradation.baseRowMutationsDisabled",
} as const;

/* ============================================================
 * 「授权了」不等于「Agent 看得见」
 *
 * 预算省略、后端无通道、扩展未交付都会让这两件事分叉，界面必须把分叉说出来，
 * 而不是让用户以为 App 已经在起作用。旧卡片把这段告知与档位控件、七态诊断
 * 混在同一张常驻卡里，于是「一切正常」和「出事了」长得几乎一样。
 *
 * 现在它只在真的出事时存在：常态零占位，异常时在 App 画面顶上长出一条横幅。
 * 七态那一堆（准入、代际、配置覆盖、可用性、交付健康度）退到横幅里的折叠区——
 * 出事时它是排查线索，不出事时它只是噪音，不该占地方。
 * ============================================================ */
export function AppGrantNotice({
  appId,
  chatId,
}: {
  appId: string;
  chatId: string;
}) {
  const { t } = useAppTranslation();
  const [status, setStatus] = useState<AppExtensionStatus | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  /* 没有 provider 就没有证据，没有证据就不宣称出事——与「未收到 visibility
     事件」同一条规矩，故此处不需要第二种降级路径。 */
  const visibility = useOptionalApps()?.agentVisibility[chatId];
  const issues = appVisibilityIssues(visibility, appId);
  const hasIssue = issues.hasIssue;

  useEffect(() => {
    if (!hasIssue) return;
    let active = true;
    const load = () => {
      void readAppExtensionStatus(appId)
        .then((value) => active && setStatus(value))
        .catch(() => undefined);
    };
    load();
    /* Extensions changed 只当失效信号；事件里的全局快照一个字不读。 */
    const unsubscribe = onExtensionsChanged(load);
    return () => {
      active = false;
      unsubscribe();
    };
  }, [appId, hasIssue]);

  if (!hasIssue) return null;

  const lines = [
    ...(issues.omission
      ? [
          t("chat.sidePanel.appGrant.omittedIntro", {
            reason: t(OMISSION_KEYS[issues.omission.reason]),
          }),
        ]
      : []),
    ...issues.degradations.map((item) => t(DEGRADATION_KEYS[item.reason])),
    ...(issues.excluded.length
      ? [
          t("chat.sidePanel.appGrant.excludedIntro", {
            items: new Intl.ListFormat(intlLocale(), {
              style: "short",
              type: "conjunction",
            }).format(
              issues.excluded.map((item) =>
                t(
                  item.required
                    ? "chat.sidePanel.appGrant.excludedRequiredItem"
                    : "chat.sidePanel.appGrant.excludedItem",
                  { name: item.declaredComponentIdentity, code: item.code }
                )
              )
            ),
          }),
        ]
      : []),
  ];

  return (
    <div className="flex shrink-0 items-start gap-2 border-amber-500/25 border-b bg-amber-500/[0.07] px-3 py-2.5 text-xs">
      <TriangleAlert className="mt-px size-3.5 shrink-0 text-amber-600 dark:text-amber-500" />
      <div className="min-w-0 flex-1 space-y-1.5 leading-relaxed">
        {lines.map((line) => (
          <p key={line}>{line}</p>
        ))}
        {status && status.requirements.length > 0 && (
          <Collapsible onOpenChange={setDetailOpen} open={detailOpen}>
            <CollapsibleTrigger className="flex cursor-pointer items-center gap-1 rounded-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40">
              <ChevronRight
                className={detailOpen ? "size-3 rotate-90" : "size-3"}
              />
              {t("chat.sidePanel.appGrant.extensionDetails")}
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-1.5 space-y-2 rounded-md border bg-background p-2">
              {status.requirements.map((requirement) => {
                const active = visibility?.activeComponents.some(
                  (item) =>
                    item.appId === status.appId &&
                    item.componentInstanceIdentity ===
                      requirement.componentInstanceIdentity
                );
                const excluded = visibility?.excludedComponents.find(
                  (item) =>
                    item.appId === status.appId &&
                    item.declaredComponentIdentity ===
                      requirement.declaredComponentIdentity
                );
                return (
                  <div
                    className="space-y-1 text-muted-foreground"
                    key={requirement.declaredComponentIdentity}
                  >
                    <p className="font-mono text-foreground">
                      {requirement.declaredComponentIdentity}
                    </p>
                    <p>
                      {t("chat.sidePanel.appGrant.requirementSummary", {
                        requirement: t(
                          requirement.required
                            ? "chat.sidePanel.appGrant.required"
                            : "chat.sidePanel.appGrant.optional"
                        ),
                        installed: t(
                          requirement.installed
                            ? "chat.sidePanel.appGrant.yes"
                            : "chat.sidePanel.appGrant.no"
                        ),
                        admission: requirement.admission,
                        generation: requirement.generationState,
                        enabled: requirement.enabled,
                        granted:
                          requirement.grant.state === "granted"
                            ? t("chat.sidePanel.appGrant.yes")
                            : requirement.grant.state,
                      })}
                    </p>
                    <p>
                      {t("chat.sidePanel.appGrant.configOverrideDiff", {
                        value: requirement.requestedConfig
                          ? `${JSON.stringify(requirement.requestedConfig)} → ${requirement.resolution.state === "resolved" ? requirement.resolution.resolvedConfigDigest : t("chat.sidePanel.appGrant.unresolved")}`
                          : t("chat.sidePanel.appGrant.none"),
                      })}
                    </p>
                    <p>
                      {t("chat.sidePanel.appGrant.eligible", {
                        value:
                          requirement.eligibility
                            .map(
                              (item) =>
                                `${item.backendId}=${item.eligible ? item.strength : item.exclusionCode}`
                            )
                            .join("｜") ||
                          t("chat.sidePanel.appGrant.unknown"),
                      })}
                    </p>
                    <p>
                      {t("chat.sidePanel.appGrant.turnActive", {
                        active: visibility
                          ? active
                            ? t("chat.sidePanel.appGrant.yes")
                            : (excluded?.code ??
                              t("chat.sidePanel.appGrant.no"))
                          : t("chat.sidePanel.appGrant.unknown"),
                      })}
                    </p>
                  </div>
                );
              })}
            </CollapsibleContent>
          </Collapsible>
        )}
      </div>
    </div>
  );
}
