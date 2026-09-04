"use client";

/**
 * [INPUT]: Depends on the shared manifest-derived Base GUI request helpers, the pending generation decision, apps-client authorize/decline commands, errors, i18n, and ui Button
 * [OUTPUT]: Provides studioConsentRequest, StudioConsentPermissions, and useStudioConsent — the one disclosure and the one allow/decline state machine shared by the Studio gate, the pending-generation card, and the install grant card
 * [POS]: The consent leaf of components/apps/authorization; every consent surface reads this instead of each writing their own half of the requested set
 */

import { useState } from "react";
import type {
  AppRecord,
  BaseGuiCapability,
  BaseGuiCapabilityScopes,
  BaseGuiHostActionCapability,
} from "../../../../shared/apps-ipc";
import {
  requestedBaseGuiCapabilities,
  requestedBaseGuiCapabilityScopes,
  requestedBaseGuiHostActions,
} from "../../../../shared/apps-surface-ipc";
import {
  authorizeAppStudioAccess,
  declineAppStudioAccess,
} from "@/lib/apps-client";
import { errorMessage } from "@/lib/errors";
import { useAppTranslation } from "@/components/providers/i18n-provider";

/* ============================================================
 * 同意书必须念完，否则它同意的不是用户读到的那些
 *
 * `authorizeStudioAccess` 一次批准三组：数据 capability、宿主动作
 * （往输入框插字、往磁盘写文件）、以及 workspace 读取范围。界面从前只念
 * 第一组，另外两组悄悄跟着一起被批准——用户按下的那颗按钮，与它真正做的
 * 事之间隔着两条没人说出口的权限。
 *
 * 请求集从哪来：有 pending decision 就照 decision 念（那是被冻结的那一份），
 * 否则照 manifest 推导——与 main 侧 grantStudioAccess 重新推导时用的是同
 * 三个 helper。两侧读同一组函数，才不会出现「界面念三条、账本写四条」。
 * ============================================================ */
export type StudioConsentRequest = Readonly<{
  capabilities: readonly BaseGuiCapability[];
  hostActions: readonly BaseGuiHostActionCapability[];
  scopes: BaseGuiCapabilityScopes;
}>;

export function studioConsentRequest(record: AppRecord): StudioConsentRequest {
  const pending = record.generationBinding.pending;
  const decision = pending?.baseGuiDecision;
  if (decision) {
    return {
      capabilities: decision.requestedCapabilities,
      hostActions: decision.requestedHostActions ?? [],
      scopes: decision.requestedCapabilityScopes ?? {},
    };
  }
  const manifest =
    record.generations.find(
      (item) => item.generationId === pending?.generationId
    )?.manifest ?? record.manifest;
  return {
    capabilities: requestedBaseGuiCapabilities(manifest),
    hostActions: requestedBaseGuiHostActions(manifest),
    scopes: requestedBaseGuiCapabilityScopes(manifest),
  };
}

/* 宿主动作的目录键不能用模板拼：`file.export` 里的点会被 i18next 读成一层
   嵌套。静态映射同时让 catalog 扫描认得这两条引用。 */
const HOST_ACTION_KEY = {
  "compose-text": "apps.baseGuiConsent.capability.compose-text",
  "file.export": "apps.baseGuiConsent.capability.fileExport",
} as const;

/* 容器由调用方说了算：装机卡已经自带一圈边与底色，同意书再套一层就是
   两个盒子讲同一件事。不给就用同意书自己的那身皮。 */
const CONSENT_LIST_CLASS = "mt-3 space-y-2 rounded-md border bg-muted/40 p-3 text-xs";

export function StudioConsentPermissions({
  className,
  labels,
  request,
}: {
  className?: string;
  /* 逐条覆写按条目自身的身份取值——清单本就拿这组身份当 key，
     再为覆写发明第二套名字，就是给同一件事起两个名。 */
  labels?: Readonly<Record<string, string>>;
  request: StudioConsentRequest;
}) {
  const { t } = useAppTranslation();
  const item = (text: string, key: string) => (
    <li className="flex items-start gap-2" key={key}>
      <span
        aria-hidden="true"
        className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary"
      />
      <span>{labels?.[key] ?? text}</span>
    </li>
  );
  return (
    <ul className={className ?? CONSENT_LIST_CLASS}>
      {item(t("apps.installPermissionReadOwnData"), "read-own-data")}
      {/* 动态 key 必须在 t() 里插值，不能先拼进数组再用变量喂进去：catalog 的
          静态扫描只认落在翻译点上的模板字面量。 */}
      {request.capabilities.map((capability) =>
        item(t(`apps.baseGuiConsent.capability.${capability}`), capability)
      )}
      {request.hostActions.map((action) =>
        item(t(HOST_ACTION_KEY[action]), action)
      )}
      {request.scopes.workspaceRead === "design/" &&
        item(t("apps.baseGuiConsent.scopeWorkspaceDesign"), "workspace-scope")}
    </ul>
  );
}

/* ============================================================
 * 同意与拒绝是同一台状态机的两个出口
 *
 * main 侧的拒绝机器一直都在（丢 pending 代、删产物、解锁重新构建），
 * 只是没有任何界面能按到它。两颗按钮共用一份 busy/error/declined，
 * 因为它们互斥：不可能一边在授权一边在拒绝。
 * ============================================================ */
export function useStudioConsent(appId: string) {
  const { t } = useAppTranslation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [declined, setDeclined] = useState(false);
  const run = async (operation: () => Promise<unknown>, decline: boolean) => {
    setBusy(true);
    setError("");
    try {
      await operation();
      setDeclined(decline);
    } catch (cause) {
      setError(errorMessage(cause, t("apps.baseGuiConsent.operationFailed")));
    } finally {
      setBusy(false);
    }
  };
  return {
    busy,
    error,
    declined,
    allow: () => void run(() => authorizeAppStudioAccess(appId), false),
    decline: () => void run(() => declineAppStudioAccess(appId), true),
    reset: () => {
      setDeclined(false);
      setError("");
    },
  };
}
