/**
 * [INPUT]: Depends on shared App/App-scoped Extension DTO, grant/disabled/clear trimesters for the apps client, single-mode agent for the AppsProvider, and the Visiblity and Button
 * [OUTPUT]: Provides AppGrantCard: Data/Commission Authorization, Chat deni clear recovery, open shutdown inheritance and main-owned Extension seven modes
 * [POS]: The authorization view of the chat/side-panel App tab; PanelSlot only navigates, Extension Truth is projected by main as frozen generation ref, renderer not pushed back from the global active package
 */

import { useEffect, useState } from "react";
import { Button } from "@ai-chat/ui/components/ui/button";
import type {
  AppAgentOmission,
  AppCapabilityGrant,
  AppExtensionStatus,
  AppGrantTarget,
  AppRecord,
} from "../../../../shared/apps-ipc";
import {
  grantApp,
  readAppExtensionStatus,
  revokeAppGrant,
  setAppGrantState,
} from "@/lib/apps-client";
import { useApps } from "@/components/providers/apps-provider";
import { onExtensionsChanged } from "@/lib/extensions-client";

export function AppGrantCard({
  record,
  target,
  grant,
  conversationId,
  onChanged,
}: {
  record: AppRecord;
  target: AppGrantTarget;
  grant: AppCapabilityGrant | null;
  conversationId: string;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [extensionStatus, setExtensionStatus] = useState<AppExtensionStatus | null>(
    null
  );
  useEffect(() => {
    let active = true;
    const load = () => {
      void readAppExtensionStatus(record.id)
        .then((value) => active && setExtensionStatus(value))
        .catch(() => undefined);
    };
    load();
    /* Extensions changed 只当失效信号；事件里的全局快照一个字不读。 */
    const unsubscribe = onExtensionsChanged(load);
    return () => {
      active = false;
      unsubscribe();
    };
  }, [record]);
  const update = async (
    requestedDataLevel: "none" | "read" | "row-write",
    agentDelegation: AppCapabilityGrant["agentDelegation"]
  ) => {
    setBusy(true);
    setError("");
    try {
      await grantApp({
        target,
        appId: record.id,
        requestedDataLevel,
        requestedAgentDelegation: agentDelegation,
      });
      onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "授权失败");
    } finally {
      setBusy(false);
    }
  };
  const revoke = async () => {
    setBusy(true);
    try {
      await revokeAppGrant(target, record.id);
      onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "撤销失败");
    } finally {
      setBusy(false);
    }
  };
  const disable = async () => {
    setBusy(true);
    try {
      await setAppGrantState({ appId: record.id, target, state: "disabled" });
      onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "显式关闭失败");
    } finally {
      setBusy(false);
    }
  };
  if (!grant) {
    return (
      <section className="m-3 rounded-lg border bg-card p-3 text-sm">
        <h3 className="font-medium">App 权限</h3>
        <p className="mt-1 text-muted-foreground text-xs">
          此 Chat 已显式关闭该 App；清除覆盖后会重新继承 Project 或默认全局授权。
        </p>
        {error && <p className="mt-2 text-destructive text-xs">{error}</p>}
        <Button
          className="mt-3"
          disabled={busy}
          onClick={() => void revoke()}
          size="sm"
          variant="outline"
        >
          清除 Chat 覆盖
        </Button>
      </section>
    );
  }
  return (
    <section className="m-3 rounded-lg border bg-card p-3 text-sm">
      <h3 className="font-medium">App 权限</h3>
      <p className="mt-1 text-muted-foreground text-xs">
        数据权限：{grant.data?.level ?? "无"}；Agent 文件读取：
        {grant.agentDelegation.fileRead ? "允许" : "不允许"}；Agent 使用数据：
        {grant.agentDelegation.useData ? "允许" : "不允许"}。
      </p>
      <p className="mt-1 text-muted-foreground text-xs">
        撤销对未提交数据立即生效；已经冻结能力的 turn 会在本轮 terminal 后释放。
      </p>
      <AgentVisibilityNotice appId={record.id} conversationId={conversationId} />
      <ExtensionRequirementStatus
        conversationId={conversationId}
        status={extensionStatus}
      />
      {error && <p className="mt-2 text-destructive text-xs">{error}</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        {record.domainIdentity?.kind === "base" && (
          <>
            <Button
              disabled={busy}
              onClick={() =>
                void update("read", grant.agentDelegation)
              }
              size="sm"
              variant="outline"
            >
              允许读取
            </Button>
            <Button
              disabled={busy}
              onClick={() => void update("row-write", grant.agentDelegation)}
              size="sm"
              variant="outline"
            >
              允许行写入
            </Button>
          </>
        )}
        <Button
          disabled={busy}
          onClick={() =>
            void update(grant.data?.level ?? "none", {
              fileRead: !grant.agentDelegation.fileRead,
              useData: grant.data ? !grant.agentDelegation.useData : false,
            })
          }
          size="sm"
          variant="outline"
        >
          {grant.agentDelegation.fileRead || grant.agentDelegation.useData
            ? "关闭 Agent 委托"
            : "开启 Agent 委托"}
        </Button>
        <Button disabled={busy} onClick={() => void disable()} size="sm" variant="destructive">
          显式关闭继承
        </Button>
        <Button disabled={busy} onClick={() => void revoke()} size="sm" variant="ghost">
          清除 Chat 覆盖
        </Button>
      </div>
    </section>
  );
}

function ExtensionRequirementStatus({
  conversationId,
  status,
}: {
  conversationId: string;
  status: AppExtensionStatus | null;
}) {
  const { agentVisibility } = useApps();
  const visibility = agentVisibility[conversationId];
  if (!status?.requirements.length) return null;
  return (
    <div className="mt-3 space-y-2 rounded-md border p-2 text-xs">
      <p className="font-medium">Extension 七态</p>
      {status.requirements.map((requirement) => {
        const active = visibility?.activeComponents.some(
          (item) =>
            item.appId === status.appId &&
            item.componentIdentity === requirement.componentIdentity
        );
        const excluded = visibility?.excludedComponents.find(
          (item) =>
            item.appId === status.appId &&
            item.componentIdentity === requirement.componentIdentity
        );
        return (
          <div className="space-y-1" key={requirement.componentIdentity}>
            <p className="font-mono">{requirement.componentIdentity}</p>
            <p>
              requirement：{requirement.required ? "required" : "optional"}；
              installed：{requirement.installed ? "yes" : "no"}；admission：
              {requirement.admission}；generation：{requirement.generationState}；
              enabled：{requirement.enabled}；
              granted-to-app：
              {requirement.grant.state === "granted"
                ? "yes"
                : requirement.grant.state}
            </p>
            <p>
              config override diff：
              {requirement.requestedConfig
                ? `${JSON.stringify(requirement.requestedConfig)} → ${requirement.resolution.state === "resolved" ? requirement.resolution.resolvedConfigDigest : "unresolved"}`
                : "none"}
            </p>
            <p>
              eligible：
              {requirement.eligibility
                .map(
                  (item) =>
                    `${item.backendId}=${item.eligible ? item.strength : item.exclusionCode}`
                )
                .join("｜") || "unknown"}
            </p>
            <p>
              delivery-health：
              {requirement.deliveryHealth
                .map((item) => `${item.backendId}=${item.status}`)
                .join("｜") || "unknown"}；active-this-turn：
              {visibility ? (active ? "yes" : excluded?.code ?? "no") : "unknown"}
            </p>
          </div>
        );
      })}
    </div>
  );
}

const OMISSION_TEXT: Record<AppAgentOmission["reason"], string> = {
  "reference-limit": "本聊天/Project 附加的 App 数超过逐轮上限，请先减少后重试。",
  "instruction-budget": "instructions 超出 2KB 预算，请先减少附加的 App。",
  "backend-unsupported": "当前后端没有内置工具通道，Agent 委托在该后端不可用（文件只读根仍然生效）。",
  "base-tools-disabled": "Base 读写工具均已关闭；需要在 Settings › Tools 重新开启后再试。",
};

const DEGRADATION_TEXT = {
  "base-reads-disabled": "Base 读取已关闭，本轮只提供行修改能力。",
  "base-row-mutations-disabled": "Base 行修改已关闭，本轮只提供读取能力。",
} as const;

/* 「授权了」不等于「Agent 看得见」：预算省略、后端无通道与扩展未交付都会让这两件事
   分叉，D20 要求把分叉说出来，而不是让用户以为 App 已经在起作用。 */
function AgentVisibilityNotice({
  appId,
  conversationId,
}: {
  appId: string;
  conversationId: string;
}) {
  const { agentVisibility } = useApps();
  const visibility = agentVisibility[conversationId];
  if (!visibility) return null;
  const omission = visibility.omittedApps.find((item) => item.appId === appId);
  if (omission) {
    return (
      <p className="mt-2 text-destructive text-xs">
        上一轮此 App 未注入，Agent 不知道它存在：{OMISSION_TEXT[omission.reason]}
      </p>
    );
  }
  const excluded = visibility.excludedComponents.filter(
    (item) => item.appId === appId
  );
  const degraded = visibility.degradedApps.filter((item) => item.appId === appId);
  if (!excluded.length && !degraded.length) return null;
  return (
    <div className="mt-2 space-y-1 text-amber-600 text-xs dark:text-amber-500">
      {degraded.map((item) => (
        <p key={item.reason}>{DEGRADATION_TEXT[item.reason]}</p>
      ))}
      {excluded.length > 0 && (
        <p>
          上一轮未交付的扩展：
          {excluded
            .map(
              (item) =>
                `${item.componentIdentity}（${item.code}${item.required ? "，required" : ""}）`
            )
            .join("、")}
        </p>
      )}
    </div>
  );
}
