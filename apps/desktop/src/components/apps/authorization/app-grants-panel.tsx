"use client";

/**
 * [INPUT]: Depends on the main-owned AppRecordProjection (studioSurfaceReady) / AppGrantSource projections, declaresBaseGui, fenced scope-clear and global default commands, i18n, Select, ConfirmationDialog, and Settings primitives
 * [OUTPUT]: Provides AppGrantsPanel with global defaults, scope audit/clear, and an always-reachable Studio access row that reads main's studioSurfaceReady (allowed / granted-but-stale / not allowed) and whose revocation is confirmed like every other 30s-drain consequence; contextual Project creation is intentionally excluded
 * [POS]: The grants body of components/apps/authorization, mounted by settings/grants-tab; Project and Chat authorization starts only inside those contexts
 */

/* ============================================================
 * 为什么这里只保留「全局默认 + 作用域审计」
 *
 * resolver 采用就近覆盖：Chat 有记录就直接决定，否则看 Project，最后才看
 * defaultGrant。作用域正授权和 disabled 都是完整决定，不与上层做集合运算。
 *
 * 因而 App 设置页只拥有全局默认；Chat/Project 记录必须在对应上下文创建。
 * 这里把它们列出来，是为了审计与清除，不是再造一个脱离上下文的添加入口。
 * 清除恢复上层继承，disabled 明确保留“当前作用域关闭”的语义，两者不可混写。
 *
 * ── 排版为什么全部交给 settings-layout ──────────────────────
 * 这一面从前手写 `rounded-lg border p-3` 与四种 space-y，与侧栏、Project
 * settings 各写各的。同一个产品里「一块内容」长三种样子，而三种都没错，
 * 只是没有一个地方说了算。现在一律走 SettingsSection / SettingsList /
 * SettingsRow：控件靠右、不占满宽度，表面的环才有行可分隔——环与满宽控件
 * 的边框平行等距时，它就不再是容器，只是一圈没有职责的描边。
 * ============================================================ */

import { useState } from "react";
import { ShieldOff } from "lucide-react";
import { ConfirmationDialog } from "@ai-chat/ui/components/ui/app-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@ai-chat/ui/components/ui/select";
import {
  SettingsBadge,
  SettingsButton,
  SettingsEmpty,
  SettingsList,
  SettingsRow,
  SettingsSection,
  SettingsSwitch,
} from "@/components/settings/settings-layout";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import { setAppGrantState, setDefaultAppGrant } from "@/lib/apps-client";
import { defaultAppGrantRequest } from "../../../../shared/apps-ipc";
import type {
  AppGrantCommandTarget,
  AppGrantSource,
  AppRecord,
  AppRecordProjection,
} from "../../../../shared/apps-ipc";
import { declaresBaseGui } from "../app-state";
import {
  APP_DATA_LEVELS,
  APP_DATA_LEVEL_KEYS,
  type AppDataLevel,
} from "../data-levels";

type PendingConfirmation =
  | { kind: "project"; target: AppGrantCommandTarget; projectName: string }
  | { kind: "open-all" }
  | { kind: "revoke-studio" };

type ScopeRow = {
  key: string;
  name: string;
  kind: string;
  off: boolean;
  // 撤销要不要过确认由 target.kind 直接判定：Project 影响整组成员，Chat 只清本层。
  // 再存一份布尔就是给同一个事实开第二个真相源，迟早各说各话。
  target: AppGrantCommandTarget;
};

/* 载荷取自共享的 defaultAppGrantRequest：可见性侧（Design 那条「重新打开」
   的悬浮条）写的是同一个 defaultGrant，两边各拼一份就必然漂开。这里只还
   需要说出自己的数据级别——Base App 读自己的 Base，其余不读。 */
function grantRequest(record: AppRecord) {
  return defaultAppGrantRequest(
    record.domainIdentity?.kind === "base" ? "read" : "none"
  );
}

export function AppGrantsPanel({
  record,
  sources,
  onRevokeStudio,
  onChanged,
  onError,
}: {
  record: AppRecordProjection;
  sources: readonly AppGrantSource[];
  /* App 内权限是「它能碰到什么」的第三行，而不是另起一段：三行问的是同一个
     问题——这款 App 拿得到什么。分成两段，读的人得自己把它们并起来。判据与
     状态都在 record 上，故不必由调用方拆成几个参数递进来；撤销要发 IPC，
     那一件事仍归 AppSettingsPanel。 */
  onRevokeStudio: () => void;
  onChanged: () => void;
  onError: (cause: unknown) => void;
}) {
  const { t } = useAppTranslation();
  const [busyKey, setBusyKey] = useState("");
  const [pending, setPending] = useState<PendingConfirmation | null>(null);
  const openToAll = Boolean(record.defaultGrant);
  const isBase = record.domainIdentity?.kind === "base";
  const dataLevel = record.defaultGrant?.data?.level ?? "none";
  const delegated = Boolean(
    record.defaultGrant?.agentDelegation.fileRead ||
    record.defaultGrant?.agentDelegation.useData
  );
  const busy = busyKey !== "";
  /* 声明与已授权是两件事，界面也照实分三态：manifest 里有 gui 才有这一行。
     「此刻算不算已授权」的判据在 main 手里——studioSurfaceReady 与 surface
     放行读同一组八项事实；照 studioGrant 自己重算，就是给同一个事实开第二个
     真相源，于是设置页说「已允许」而面 403。studioGrant 在这里只回答另一个
     问题：有没有一张可撤的凭据。有凭据却没就绪，就是那条从前无处安放的
     「授权已过期」——照实说出来，比装作已允许诚实。 */
  const studioDeclared = declaresBaseGui(record);
  const studioReady = record.studioSurfaceReady === true;
  const studioRevocable = Boolean(record.studioGrant);
  const studioStatusKey = studioReady
    ? "apps.settingsStudioAccessActive"
    : studioRevocable
      ? "apps.settingsStudioAccessStale"
      : "apps.settingsStudioAccessMissing";

  const scopes: ScopeRow[] = sources.flatMap((source) => {
    if (!source.target || !source.commandTarget) return [];
    return [{
      key: `${source.target.kind}:${source.target.kind === "chat" ? source.target.chatId : source.target.projectId}`,
      name: source.targetName,
      kind: t(source.target.kind === "chat" ? "apps.settingsScopeChat" : "apps.settingsScopeProject"),
      off: source.state !== "grant",
      target: source.commandTarget,
    }];
  });

  const run = async (key: string, operation: () => Promise<unknown>) => {
    setBusyKey(key);
    try {
      await operation();
      onChanged();
    } catch (cause) {
      onError(cause);
    } finally {
      setBusyKey("");
    }
  };

  const clearScope = (target: AppGrantCommandTarget) => run(
    `${target.kind}:${target.kind === "chat" ? target.chatId : target.projectId}`,
    () => setAppGrantState({
      appId: record.id,
      target,
      state: "clear",
    })
  );

  const updateDefault = (
    requestedDataLevel: AppDataLevel,
    requestedAgentDelegation = record.defaultGrant?.agentDelegation ?? {
      fileRead: false,
      useData: false,
    }
  ) => run("default", () => setDefaultAppGrant({
    appId: record.id,
    grant: { requestedDataLevel, requestedAgentDelegation },
  }));

  /* 放宽全局默认要确认，收紧不用。更近作用域是独立事实：改 defaultGrant
     绝不顺手清掉 Chat/Project 记录，否则“改默认”会偷偷变成批量改权限。 */
  const changeMode = (next: string) => {
    if (next === "all") return setPending({ kind: "open-all" });
    void run("default", () => setDefaultAppGrant({ appId: record.id, grant: null }));
  };

  /* 撤销 Studio 会拉起最长 30s 的 GUI drain 并踢掉正在用的界面——与清除
     Project 作用域同一量级的后果，故走同一道确认门。同类后果两种把关，
     用户学不会哪一颗按下去会疼。 */
  const confirm = () => {
    if (pending?.kind === "revoke-studio") {
      onRevokeStudio();
      setPending(null);
      return;
    }
    const operation = pending?.kind === "project"
      ? clearScope(pending.target)
      : run("default", () =>
          setDefaultAppGrant({ appId: record.id, grant: grantRequest(record) })
        );
    void operation.finally(() => setPending(null));
  };

  /* 三种确认共用一台对话框：标题、正文、确认按钮各是一条目录键，而不是
     三串就地拼出来的三元表达式——同一个问题在三处各写一次，迟早三处说法不同。
     字段名以 Key 收尾，静态门禁据此知道这些字符串是坐标而不是文案。 */
  const confirmCopy = {
    "open-all": {
      titleKey: "apps.settingsOpenAllTitle",
      descriptionKey: "apps.settingsOpenAllConfirm",
      confirmLabelKey: "apps.settingsScopeAll",
      tone: "default",
    },
    project: {
      titleKey: "apps.projectRevokeTitle",
      descriptionKey: "apps.projectRevokeConfirm",
      confirmLabelKey: "apps.revoke",
      tone: "destructive",
    },
    "revoke-studio": {
      titleKey: "apps.settingsRevokeStudioTitle",
      descriptionKey: "apps.settingsRevokeStudioConfirm",
      confirmLabelKey: "apps.settingsRevokeStudioAccess",
      tone: "destructive",
    },
  } as const;
  const confirmation = confirmCopy[pending?.kind ?? "open-all"];

  return (
    <div className="space-y-8">
      {/* ── 档位：这一页唯一需要先回答的问题 ───────────────── */}
      <SettingsSection title={t("apps.settingsScopeMode")}>
        <SettingsList>
          <SettingsRow
            htmlFor="app-grant-scope-mode"
            label={t("apps.settingsScopeRow")}
            description={t(openToAll ? "apps.settingsScopeAllHint" : "apps.settingsScopeSelectedHint")}
            control={
              <Select
                disabled={busy}
                onValueChange={changeMode}
                value={openToAll ? "all" : "selected"}
              >
                <SelectTrigger
                  aria-label={t("apps.settingsScopeRow")}
                  id="app-grant-scope-mode"
                  size="lg"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent align="end">
                  <SelectItem value="all">{t("apps.settingsScopeAll")}</SelectItem>
                  <SelectItem value="selected">{t("apps.settingsScopeSelected")}</SelectItem>
                </SelectContent>
              </Select>
            }
          />
          {/* 作用域清单只做审计/清除；无论默认开关如何都逐条展示。 */}
          {scopes.map((scope) => (
            <SettingsRow
              key={scope.key}
              label={scope.name}
              badge={
                <SettingsBadge tone={scope.off ? "muted" : "neutral"}>
                  {scope.off ? `${scope.kind} · ${t("apps.settingsScopeOff")}` : scope.kind}
                </SettingsBadge>
              }
              control={
                <SettingsButton
                  disabled={busyKey === scope.key}
                  onClick={() => {
                    if (scope.target.kind !== "project") {
                      void clearScope(scope.target);
                      return;
                    }
                    setPending({
                      kind: "project",
                      target: scope.target,
                      projectName: scope.name,
                    });
                  }}
                  variant="outline"
                >
                  {t("apps.settingsClear")}
                </SettingsButton>
              }
            />
          ))}
        </SettingsList>
        {scopes.length === 0 && (
          <SettingsEmpty
            hint={t("apps.settingsScopeEmptyHint")}
            icon={<ShieldOff />}
            title={t("apps.settingsScopeEmptyTitle")}
          />
        )}
      </SettingsSection>

      {/* ── 能力：全挂在 defaultGrant 上，只有全部档才有落点 ── */}
      {openToAll && (
        <SettingsSection
          description={t("apps.settingsCapabilitiesHint")}
          title={t("apps.settingsCapabilities")}
        >
          <SettingsList>
            {isBase && (
              <SettingsRow
                htmlFor="app-grant-data"
                label={t("apps.settingsDataAccess")}
                description={t("apps.settingsDataAccessHint")}
                control={
                  <Select
                    disabled={busy}
                    onValueChange={(next) => void updateDefault(next as AppDataLevel)}
                    value={dataLevel}
                  >
                    <SelectTrigger
                      aria-label={t("apps.settingsDataAccess")}
                      id="app-grant-data"
                      size="lg"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent align="end">
                      {APP_DATA_LEVELS.map((level) => (
                        <SelectItem key={level} value={level}>
                          {t(APP_DATA_LEVEL_KEYS[level])}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                }
              />
            )}
            <SettingsRow
              htmlFor="app-grant-delegation"
              label={t("apps.settingsDelegation")}
              description={t("apps.settingsDelegationHint")}
              control={
                <SettingsSwitch
                  checked={delegated}
                  disabled={busy}
                  id="app-grant-delegation"
                  label={t("apps.settingsDelegation")}
                  onToggle={() => void updateDefault(
                    dataLevel,
                    delegated
                      ? { fileRead: false, useData: false }
                      : { fileRead: true, useData: Boolean(record.defaultGrant?.data) }
                  )}
                />
              }
            />
          </SettingsList>
        </SettingsSection>
      )}

      {/* ── App 内权限：与全局档位正交，故不能挂在它的 if 里 ──────
          Studio grant 问的是「这款 App 自己的界面能碰到什么」，与
          Chat/Project 能不能用它是两个问题。从前这一行嵌在「全部档」
          之下，而新装的 Base App 的 defaultGrant 是 null——于是同意书
          里那句「权限可稍后撤销」指向一个用户永远走不到的地方。 */}
      {studioDeclared && (
        <SettingsSection
          description={t("apps.settingsStudioAccessHint")}
          title={t("apps.settingsStudioAccessSection")}
        >
          <SettingsList>
            <SettingsRow
              label={t("apps.settingsStudioAccessTitle")}
              description={t(studioStatusKey)}
              control={
                studioRevocable ? (
                  <SettingsButton
                    disabled={busy}
                    onClick={() => setPending({ kind: "revoke-studio" })}
                    variant="outline"
                  >
                    <ShieldOff />
                    {t("apps.settingsRevokeStudioAccess")}
                  </SettingsButton>
                ) : null
              }
            />
          </SettingsList>
        </SettingsSection>
      )}

      <ConfirmationDialog
        busy={busy}
        cancelLabel={t("common.cancel")}
        confirmLabel={t(confirmation.confirmLabelKey)}
        confirmTone={confirmation.tone}
        description={t(confirmation.descriptionKey, {
          app: record.displayName,
          target: pending?.kind === "project" ? pending.projectName : "",
        })}
        onConfirm={confirm}
        onOpenChange={(open) => { if (!open) setPending(null); }}
        open={pending !== null}
        title={t(confirmation.titleKey)}
      />
    </div>
  );
}
