/**
 * [INPUT]: Depends on React, ui/button and ui/tooltip, agent-backends
 * [OUTPUT]: Provides BackendStatusBadge, BackendIconAction with the pure function backendActionFlags
 * [POS]: The setup module's atomic layer, consumed by backend-row; the Backends settings page and Onboarding share these criteria and parts
 */

import type { ComponentProps, ReactNode } from "react";
import { Button } from "@ai-chat/ui/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@ai-chat/ui/components/ui/tooltip";
import { needsBackendLogin } from "@/lib/agent-backends";
import type { BackendInfo } from "../../../shared/agent-ipc";

/* ============================================================
 * 一份判据，两种排布。
 *
 * 「该装、该登、还是该更新」是 runtimeStatus/authStatus 的函数，与它被
 * 画成卡片还是画成一行毫无关系。卡与行各自再算一遍，就等于同一个问题
 * 有两个答案——迟早有一个先改对，另一个还在说旧话。
 * ============================================================ */
export type BackendActionFlags = {
  ready: boolean;
  canInstall: boolean;
  canLogin: boolean;
  canUpdate: boolean;
};

export const backendActionFlags = (
  backend: BackendInfo
): BackendActionFlags => ({
  ready: backend.status === "ready",
  canInstall: backend.runtimeStatus === "missing",
  /* terminal-auth is an action capability, not evidence of auth state. OpenCode
     deliberately stays `unknown` while still offering its terminal guide. */
  canLogin:
    needsBackendLogin(backend) || backend.capabilities.terminalAuth === true,
  canUpdate:
    backend.runtimeStatus === "unsupported" || Boolean(backend.updateAvailable),
});

export function BackendStatusBadge({
  ready,
  children,
}: {
  ready: boolean;
  children: ReactNode;
}) {
  return (
    <span
      className={
        ready
          ? "flex shrink-0 items-center gap-1.5 rounded-full bg-emerald-500/10 py-0.5 pr-2 pl-1.5 font-medium text-[11px] text-emerald-700 dark:text-emerald-400"
          : "flex shrink-0 items-center gap-1.5 rounded-full bg-amber-500/10 py-0.5 pr-2 pl-1.5 font-medium text-[11px] text-amber-700 dark:text-amber-400"
      }
    >
      <span
        aria-hidden="true"
        className={
          ready
            ? "size-1.5 rounded-full bg-emerald-500"
            : "size-1.5 rounded-full bg-amber-500"
        }
      />
      {children}
    </span>
  );
}

/* 卡上的图标按钮曾是无字天书：右下角一个 `>_` 谁也猜不出是「重新检测」。
   aria-label 只对读屏器说话，看得见的人反而无从知晓——同一句话同时喂给
   两种感官，才叫标签。`detail` 是可选槽：ⓘ 要展开的不是自己的名字，
   而是指令与诊断，缺省仍退回 label，不多一个组件。 */
export function BackendIconAction({
  label,
  detail,
  ...props
}: ComponentProps<typeof Button> & { label: string; detail?: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button size="icon-sm" variant="ghost" aria-label={label} {...props} />
      </TooltipTrigger>
      <TooltipContent>{detail ?? label}</TooltipContent>
    </Tooltip>
  );
}
