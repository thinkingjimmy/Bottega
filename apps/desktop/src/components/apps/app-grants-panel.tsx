"use client";

/**
 * [INPUT]: Depends on AppRecord/AppGrantSource/Project Projection, apps-client tri-mode and default authorization commands, i18n, Select/SettingsSwitch and ConfirmationDialog
 * [OUTPUT]: Provides AppGrantsPanel; Pre-defined "available range" rank, then exposed capacity rank or specified range list by rank
 * [POS]: The license base for components/apps is replicated by the AppSettingsPanel; Chat is only clear at this level, Project/Whole is managed on the App side
 */

/* ============================================================
 * 为什么是「一个档位 + 一份清单」，而不是把三源并排摊开
 *
 * resolver 的法只有两句：负向记录压制同层与下层，其余各层正授权取宽并集。
 * 于是「默认给不给」是唯一的真维度，作用域记录只是对它的偏离。
 *
 * 而本页能签发的载荷只有一种（grantRequest 给作用域的与给默认档的逐字
 * 相同），四种组合里立刻有两种是纯冗余：默认开时再给作用域正授权，默认关时
 * 再给作用域负向记录——都在压制或加宽一个已经如此的世界。旧版把这四种一视
 * 同仁地摆成两列按钮，读的人得先在脑子里跑一遍 resolver 才知道哪颗有用。
 *
 * 所以档位只有两个真值，直接映射 defaultGrant 的有无；「不授权」不是第三档，
 * 它是「仅指定」的空态——同一份持久值不该有两个名字，否则刷新后无从复原。
 * 负向记录随之退出产品：本页不再签发它，存量仍如实登记在清单里并可移除——
 * 账本里的事实可以被清除，但不可以被藏起来。
 * ============================================================ */

import { useState } from "react";
import { Button } from "@ai-chat/ui/components/ui/button";
import { ConfirmationDialog } from "@ai-chat/ui/components/ui/app-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@ai-chat/ui/components/ui/select";
import { SettingsSwitch } from "@/components/settings/settings-layout";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import { setAppGrantState, setDefaultAppGrant } from "@/lib/apps-client";
import type {
  AppGrantSource,
  AppGrantTarget,
  AppRecord,
} from "../../../shared/apps-ipc";
import type { Project } from "../../../shared/projects-ipc";

type PendingConfirmation =
  | { kind: "project"; projectId: string; projectName: string }
  | { kind: "open-all" }
  | { kind: "purge" };

type ScopeRow = {
  key: string;
  name: string;
  caption: string;
  // 撤销要不要过确认由 target.kind 直接判定：Project 影响整组成员，Chat 只清本层。
  // 再存一份布尔就是给同一个事实开第二个真相源，迟早各说各话。
  target: AppGrantTarget;
};

function grantRequest(record: AppRecord) {
  return {
    requestedDataLevel:
      record.domainIdentity?.kind === "base" ? "read" as const : "none" as const,
    requestedAgentDelegation: { fileRead: false, useData: false },
  };
}

export function AppGrantsPanel({
  record,
  sources,
  projects,
  onChanged,
  onError,
}: {
  record: AppRecord;
  sources: readonly AppGrantSource[];
  projects: readonly Project[];
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

  const ordinaryProjects = projects.filter(
    (project) => project.workspaceBinding.kind !== "app" && !project.archivedAt
  );
  const scopes: ScopeRow[] = sources.flatMap((source) => {
    if (!source.target) return [];
    const kind = t(source.target.kind === "chat" ? "apps.settingsScopeChat" : "apps.settingsScopeProject");
    return [{
      key: `${source.target.kind}:${source.target.kind === "chat" ? source.target.chatId : source.target.projectId}`,
      name: source.targetName,
      caption: source.state === "grant" ? kind : `${kind} · ${t("apps.settingsScopeOff")}`,
      target: source.target,
    }];
  });
  const addableProjects = ordinaryProjects.filter(
    (project) => !scopes.some((scope) => scope.key === `project:${project.id}`)
  );

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

  const setScope = (target: AppGrantTarget, state: "grant" | "clear") => run(
    `${target.kind}:${target.kind === "chat" ? target.chatId : target.projectId}`,
    () => setAppGrantState({
      appId: record.id,
      target,
      state,
      ...(state === "grant" ? grantRequest(record) : {}),
    })
  );

  const clearAllScopes = () => Promise.all(
    scopes.map((scope) => setAppGrantState({
      appId: record.id,
      target: scope.target,
      state: "clear",
    }))
  );

  const updateDefault = (
    requestedDataLevel: "none" | "read" | "row-write",
    requestedAgentDelegation = record.defaultGrant?.agentDelegation ?? {
      fileRead: false,
      useData: false,
    }
  ) => run("default", () => setDefaultAppGrant({
    appId: record.id,
    grant: { requestedDataLevel, requestedAgentDelegation },
  }));

  /* 放宽要确认，收紧不用：开到「全部作用域」是一次扩权，且会连带清掉清单里
     每一条更具体的记录——不清就等于让档位对残留记录说谎。 */
  const changeMode = (next: string) => {
    if (next === "all") return setPending({ kind: "open-all" });
    void run("default", () => setDefaultAppGrant({ appId: record.id, grant: null }));
  };

  const confirm = () => {
    const operation = pending?.kind === "project"
      ? setScope({ kind: "project", projectId: pending.projectId }, "clear")
      : pending?.kind === "purge"
        ? run("default", clearAllScopes)
        : run("default", async () => {
            await setDefaultAppGrant({ appId: record.id, grant: grantRequest(record) });
            await clearAllScopes();
          });
    void operation.finally(() => setPending(null));
  };

  return (
    <div className="space-y-6">
      {/* ── 档位：这一页唯一需要先回答的问题 ───────────────── */}
      <section className="space-y-2">
        <label className="font-medium text-sm" htmlFor="app-grant-scope-mode">
          {t("apps.settingsScopeMode")}
        </label>
        <Select
          disabled={busyKey !== ""}
          onValueChange={changeMode}
          value={openToAll ? "all" : "selected"}
        >
          <SelectTrigger className="w-full" id="app-grant-scope-mode">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("apps.settingsScopeAll")}</SelectItem>
            <SelectItem value="selected">{t("apps.settingsScopeSelected")}</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-muted-foreground text-xs">
          {t(openToAll ? "apps.settingsScopeAllHint" : "apps.settingsScopeSelectedHint")}
        </p>
      </section>

      {/* ── 全部档：能力档挂在 defaultGrant 上，只有这一档才有落点 ── */}
      {openToAll && (
        <section className="space-y-3 rounded-lg border p-3">
          {isBase && (
            <div className="flex items-center justify-between gap-3">
              <label className="font-medium text-sm" htmlFor="app-grant-data">
                {t("apps.settingsDataAccess")}
              </label>
              <Select
                disabled={busyKey !== ""}
                onValueChange={(next) => void updateDefault(next as "none" | "read" | "row-write")}
                value={dataLevel}
              >
                <SelectTrigger className="w-40" id="app-grant-data">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t("apps.settingsDataNone")}</SelectItem>
                  <SelectItem value="read">{t("apps.settingsDataRead")}</SelectItem>
                  <SelectItem value="row-write">{t("apps.settingsDataWrite")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="font-medium text-sm">{t("apps.settingsDelegation")}</p>
              <p className="text-muted-foreground text-xs">{t("apps.settingsDelegationHint")}</p>
            </div>
            <SettingsSwitch
              checked={delegated}
              disabled={busyKey !== ""}
              id="app-grant-delegation"
              label={t("apps.settingsDelegation")}
              onToggle={() => void updateDefault(
                dataLevel,
                delegated
                  ? { fileRead: false, useData: false }
                  : { fileRead: true, useData: Boolean(record.defaultGrant?.data) }
              )}
            />
          </div>
          {/* 全部档下清单本该是空的；存量残留只给一句如实交代与一颗清除键——
              藏起来才是撒谎，摊成可逐条编辑的例外清单则是把维度又加回来。 */}
          {scopes.length > 0 && (
            <div className="flex items-center justify-between gap-3 border-t pt-3">
              <p className="text-muted-foreground text-xs">
                {t("apps.settingsResidualScopes", { scopes: scopes.length })}
              </p>
              <Button
                disabled={busyKey !== ""}
                onClick={() => setPending({ kind: "purge" })}
                size="sm"
                variant="ghost"
              >
                {t("apps.settingsClear")}
              </Button>
            </div>
          )}
        </section>
      )}

      {/* ── 仅指定档：清单只登记事实，空态自己说清「处处不可用」 ── */}
      {!openToAll && (
        <section className="space-y-2">
          <p className="font-medium text-sm">{t("apps.settingsScopeList")}</p>
          {scopes.map((scope) => (
            <div className="flex items-center justify-between gap-3 rounded-lg border p-3" key={scope.key}>
              <div className="min-w-0">
                <p className="truncate font-medium text-sm">{scope.name}</p>
                <p className="text-muted-foreground text-xs">{scope.caption}</p>
              </div>
              <Button
                disabled={busyKey === scope.key}
                onClick={() => {
                  if (scope.target.kind !== "project") {
                    void setScope(scope.target, "clear");
                    return;
                  }
                  setPending({
                    kind: "project",
                    projectId: scope.target.projectId,
                    projectName: scope.name,
                  });
                }}
                size="sm"
                variant="ghost"
              >
                {t("apps.settingsClear")}
              </Button>
            </div>
          ))}
          {scopes.length === 0 && (
            <p className="text-muted-foreground text-sm">{t("apps.settingsScopeEmpty")}</p>
          )}
          {addableProjects.length > 0 && (
            /* 受控在空串：选完即执行，下拉自己回到 placeholder，不冒充当前值。 */
            <Select
              disabled={busyKey !== ""}
              onValueChange={(projectId) => void setScope({ kind: "project", projectId }, "grant")}
              value=""
            >
              <SelectTrigger className="w-full" aria-label={t("apps.settingsScopeAdd")}>
                <SelectValue placeholder={t("apps.settingsScopeAdd")} />
              </SelectTrigger>
              <SelectContent>
                {addableProjects.map((project) => (
                  <SelectItem key={project.id} value={project.id}>{project.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </section>
      )}

      <ConfirmationDialog
        busy={busyKey !== ""}
        cancelLabel={t("common.cancel")}
        confirmLabel={pending?.kind === "open-all"
          ? t("apps.settingsScopeAll")
          : t("apps.revoke")}
        confirmTone={pending?.kind === "open-all" ? "default" : "destructive"}
        description={pending?.kind === "project"
          ? t("apps.projectRevokeConfirm", { app: record.displayName, target: pending.projectName })
          : t(pending?.kind === "purge" ? "apps.settingsPurgeConfirm" : "apps.settingsOpenAllConfirm", { scopes: scopes.length })}
        onConfirm={confirm}
        onOpenChange={(open) => { if (!open) setPending(null); }}
        open={pending !== null}
        title={pending?.kind === "project"
          ? t("apps.projectRevokeTitle")
          : t(pending?.kind === "purge" ? "apps.settingsPurgeTitle" : "apps.settingsOpenAllTitle")}
      />
    </div>
  );
}
