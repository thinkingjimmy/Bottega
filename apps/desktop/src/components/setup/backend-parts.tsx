/**
 * [INPUT]: Depends on React, ui/button, ui/tooltip, shared availability facts and an explicit presentation clock.
 * [OUTPUT]: Projects backend facts into consistent badges, verification explanations, progress and installation/login/update actions.
 * [POS]: The setup module's atomic presentation layer; it turns runtime/auth facts into one honest status and action model shared by Settings and Onboarding
 */
import { projectAvailability } from "../../../shared/agent-availability/projection";
import type { AvailabilityState } from "../../../shared/agent-availability/types";
import type { ComponentProps, ReactNode } from "react";
import { Button } from "@ai-chat/ui/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@ai-chat/ui/components/ui/tooltip";
import type { BackendInfo } from "../../../shared/agent-ipc";

export type BackendStatusTone = "positive" | "attention" | "neutral";
export type BackendLoginAction = "login" | "manage";

export type BackendSetupPresentation = {
  status: AvailabilityState;
  tone: BackendStatusTone;
  refreshing: boolean;
  hint: "checking" | "unverified" | "expired" | "failed" | null;
  showGuide: boolean;
  canInstall: boolean;
  loginAction: BackendLoginAction | null;
  canUpdate: boolean;
};

const STATUS_TONES = {
  ready: "positive",
  unverified: "neutral",
  checking: "neutral",
  missing: "attention",
  unsupported: "attention",
  "sign-in": "attention",
  "cannot-check": "attention",
  "cannot-start": "attention",
  "usage-limit": "attention",
  "recent-sign-in": "attention",
  connection: "attention",
  service: "attention",
} as const satisfies Record<AvailabilityState, BackendStatusTone>;

const GUIDELESS_SETUP_STATUSES = new Set<AvailabilityState>([
  "ready",
  "unverified",
  "checking",
]);

export const backendSetupPresentation = (
  backend: BackendInfo,
  now = Date.now()
): BackendSetupPresentation => {
  const availability = projectAvailability(backend, now);
  const refreshing = availability.refreshing || backend.authStatus === "checking";
  // Preserve confirmed facts during refresh; explain incomplete checks separately.
  const status = availability.state === "unverified" && refreshing
    ? "checking" : availability.state;
  const confirmed = backend.availability?.lastConfirmedAuth;
  const expired = confirmed?.status === "authenticated" &&
    confirmed.environmentGeneration === backend.availability?.environmentGeneration &&
    confirmed.expiresAt !== undefined && confirmed.expiresAt <= now;
  const hint = backend.runtimeStatus !== "installed" ? null
    : refreshing ? "checking"
    : backend.authStatus === "error" ? "failed"
    : status === "unverified" ? expired ? "expired" : "unverified"
    : null;
  return {
    status,
    tone: STATUS_TONES[status],
    refreshing,
    hint,
    showGuide: !GUIDELESS_SETUP_STATUSES.has(status),
    canInstall: backend.runtimeStatus === "missing",
    loginAction: backend.runtimeStatus !== "installed" ? null
      : status === "sign-in" ? "login"
      : backend.capabilities.terminalAuth ? "manage" : null,
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
