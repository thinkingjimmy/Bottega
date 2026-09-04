/**
 * [INPUT]: Depends on React, ui/button and ui/tooltip, agent-backends authentication predicates, and the shared backend DTO
 * [OUTPUT]: Provides BackendStatusBadge, BackendIconAction, and the pure backendSetupPresentation projection
 * [POS]: The setup module's atomic presentation layer; it turns runtime/auth facts into one honest status and action model shared by Settings and Onboarding
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
 * 两条事实，一份呈现。
 *
 * `status` 是兼容投影，会把 installed + unknown 折成 ready；它适合旧消费方，
 * 却不足以回答 Setup 的两个问题：「现在确知什么」「下一步能做什么」。这里
 * 直接从 runtimeStatus/authStatus 生成徽标、引导与动作，避免绿色 Ready 与
 * Sign in 同时出现这种双重真相。
 * ============================================================ */
export type BackendSetupStatus =
  | BackendInfo["status"]
  | "installed"
  | "checking";
export type BackendStatusTone = "positive" | "attention" | "neutral";
export type BackendLoginAction = "login" | "manage";

export type BackendSetupPresentation = {
  status: BackendSetupStatus;
  tone: BackendStatusTone;
  showGuide: boolean;
  canInstall: boolean;
  loginAction: BackendLoginAction | null;
  canUpdate: boolean;
};

const AUTH_SETUP_STATUS = {
  unknown: "installed",
  checking: "checking",
  authenticated: "ready",
  unauthenticated: "auth-required",
  error: "error",
} as const satisfies Record<BackendInfo["authStatus"], BackendSetupStatus>;

const STATUS_TONES = {
  ready: "positive",
  installed: "neutral",
  checking: "neutral",
  missing: "attention",
  unsupported: "attention",
  "auth-required": "attention",
  error: "attention",
} as const satisfies Record<BackendSetupStatus, BackendStatusTone>;

const GUIDELESS_SETUP_STATUSES = new Set<BackendSetupStatus>([
  "ready",
  "installed",
  "checking",
]);

const setupStatus = (backend: BackendInfo): BackendSetupStatus =>
  backend.runtimeStatus === "installed"
    ? AUTH_SETUP_STATUS[backend.authStatus]
    : backend.runtimeStatus;

const loginAction = (backend: BackendInfo): BackendLoginAction | null => {
  if (
    backend.runtimeStatus !== "installed" ||
    backend.authStatus === "checking"
  ) {
    return null;
  }
  if (needsBackendLogin(backend)) return "login";
  return backend.capabilities.terminalAuth === true ? "manage" : null;
};

export const backendSetupPresentation = (
  backend: BackendInfo
): BackendSetupPresentation => {
  const status = setupStatus(backend);
  return {
    status,
    tone: STATUS_TONES[status],
    showGuide: !GUIDELESS_SETUP_STATUSES.has(status),
    canInstall: backend.runtimeStatus === "missing",
    loginAction: loginAction(backend),
    canUpdate:
      backend.runtimeStatus === "unsupported" || Boolean(backend.updateAvailable),
  };
};

const BADGE_TONE_CLASSES = {
  positive: {
    badge: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
    dot: "bg-emerald-500",
  },
  attention: {
    badge: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
    dot: "bg-amber-500",
  },
  neutral: {
    badge: "bg-muted text-muted-foreground",
    dot: "bg-muted-foreground/60",
  },
} as const satisfies Record<
  BackendStatusTone,
  Readonly<{ badge: string; dot: string }>
>;

export function BackendStatusBadge({
  tone,
  children,
}: {
  tone: BackendStatusTone;
  children: ReactNode;
}) {
  const classes = BADGE_TONE_CLASSES[tone];
  return (
    <span
      className={`flex shrink-0 items-center gap-1.5 rounded-full py-0.5 pr-2 pl-1.5 font-medium text-[11px] ${classes.badge}`}
    >
      <span
        aria-hidden="true"
        className={`size-1.5 rounded-full ${classes.dot}`}
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
