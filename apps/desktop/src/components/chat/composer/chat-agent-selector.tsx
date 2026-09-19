/**
 * [INPUT]: Depends on shared availability facts, an optional previous Agent for draft cancellation, quota projections and bounded prefetch, localized copy, injected management and Usage navigation, and menu/tooltip primitives.
 * [OUTPUT]: Renders an availability-aware Agent picker with in-menu draft cancellation and row-anchored Usage access; refresh never changes the selected Agent.
 * [POS]: Composer identity and availability control; the row is the only control and the menu has no footer, so nothing competes with the selected mark.
 */
import { useCallback, useId, useRef, useState } from "react";


import { DropdownMenuLabel, DropdownMenuSeparator } from "@ai-chat/ui/components/ui/dropdown-menu";
import { AgentPicker, type AgentPickerRow } from "@ai-chat/chat-ui/agent-picker";
import { AGENT_BACKEND_ORDER, type AgentBackendId, type BackendInfo } from "../../../../shared/agent-ipc";
import { projectAvailability } from "../../../../shared/agent-availability/projection";
import type { AvailabilityState } from "../../../../shared/agent-availability/types";
import { backendLabel } from "@/lib/agent-backends";
import { useAppTranslation } from "@/components/providers/i18n-provider";

import { useUsageLimits, useUsageLimitsDemand, useUsageLimitsPrefetch } from "@/lib/usage-limits/hooks";
import { quotaDescription, quotaDetail, quotaResetClock } from "@/lib/usage-limits/format";
import { emptyAgentLimits } from "../../../../shared/usage-limits/projection";
import { useQuotaMenuHint } from "./usage/menu-hint";
import { QuotaSummaryText } from "./usage/summary";

/* ── 十二个状态，三种声量 ──────────────────────────────────────
 * quiet 在触发器上不出字：ready 与 unverified 说的是「没出问题」，
 * 而「没出问题」不改变任何人此刻能做的事。working 只转一圈。
 * 剩下九个才配一个词——它们各自对应一件能做的事。
 * ────────────────────────────────────────────────────────── */
type Tone = "quiet" | "working" | "attention";
const TONE: Record<AvailabilityState, Tone> = {
  ready: "quiet", unverified: "quiet", checking: "working",
  "sign-in": "attention", "recent-sign-in": "attention", missing: "attention", unsupported: "attention",
  "cannot-check": "attention", "cannot-start": "attention",
  connection: "attention", service: "attention", "usage-limit": "attention",
};

/* 槽里永远只有一个记号——✓、转圈、或一个动词——因为一行永远不会同时是两者。
   动词只留给「此刻就能做完」的事；安装与更新要去 Settings 办，于是把病因交给
   第二行，跳转交给行本身：`Manage Agents` 从来没解释过任何东西。
   App 窗里所有修复都由 Settings 承接，动词在那里说不出真话，一并让位。 */
const SLOT_VERB: Partial<Record<AvailabilityState, "login" | "retry">> = {
  "sign-in": "login", "recent-sign-in": "login",
  connection: "retry", service: "retry", "cannot-check": "retry", "cannot-start": "retry",
};
type Recovery = "login" | "retry" | "manage";
const recoveryFor = (state: AvailabilityState, appBound: boolean): Recovery | undefined => {
  if (state === "missing" || state === "unsupported") return "manage";
  const verb = SLOT_VERB[state];
  return verb ? (appBound ? "manage" : verb) : undefined;
};

export function ChatAgentSelector({ value, revertTo, backends, locked, disabled, saving, onChange, onRecheck, onRepair, onManage, appBound = false, now, currentState, reason, onOpenUsage, customProvider = false, usageResetsAt }: {
  reason?: string;
  /** The card beside a row opens Usage on that Agent's tab; the menu itself offers no other way there. */
  onOpenUsage?: (trigger: HTMLElement | null, agent: AgentBackendId) => void;
  customProvider?: boolean;
  value: AgentBackendId;
  /** Cancelling an unsent switch does not require the previous Agent to be available. */
  revertTo?: AgentBackendId;
  backends: BackendInfo[];
  locked: boolean;
  disabled?: boolean;
  saving?: boolean;
  onChange: (backend: AgentBackendId) => Promise<void>;
  onRecheck?: (backend: AgentBackendId) => void;
  onRepair?: (backend: AgentBackendId, action: "login") => void;
  onManage?: () => void;
  appBound?: boolean;
  now: number;
  currentState?: AvailabilityState;
  /** 只有 usage-limit 用得上：拦下这一回合的那个窗口何时恢复。等待是唯一的动作，等多久就是唯一有用的事实。 */
  usageResetsAt?: number;
}) {
  const { t } = useAppTranslation();
  const [open, setOpen] = useState(false);
  const menu = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const openingSettings = useRef(false);
  const descriptionId = useId();
  const handleRecovery = useCallback((backend: AgentBackendId, recovery: Recovery) => {
    if (recovery === "manage") {
      openingSettings.current = true;
      setOpen(false);
      onManage?.();
    } else if (recovery === "login") onRepair?.(backend, "login");
    else onRecheck?.(backend);
  }, [onManage, onRecheck, onRepair]);
  const quota = useUsageLimits();
  const prefetchQuota = useUsageLimitsPrefetch(Boolean(onOpenUsage), appBound ? [value] : AGENT_BACKEND_ORDER);
  useUsageLimitsDemand(open && Boolean(onOpenUsage), "selector", appBound ? [value] : AGENT_BACKEND_ORDER);
  const hint = useQuotaMenuHint(open, menu, (backend) => {
    const agent = quota.snapshot.agents.find((entry) => entry.backend === backend) ?? emptyAgentLimits(backend);
    return quotaDetail(agent, quota.now, t, backend === value && customProvider, true);
  }, (backend) => {
    if (!onOpenUsage) return;
    openingSettings.current = true;
    setOpen(false);
    onOpenUsage(trigger.current, backend);
  });

  const selected = backends.find((entry) => entry.id === value);
  const projection = projectAvailability(selected, now);
  const state = currentState ?? projection.state;
  const tone = TONE[state];
  const text = t(`agentAvailability.state.${state}`);
  const label = `${backendLabel(value)} · ${text} · ${t("agentAvailability.openMenu")}`;

  const rows = (appBound ? [value] : AGENT_BACKEND_ORDER).map((id) => {
    const backend = backends.find((entry) => entry.id === id);
    const base = projectAvailability(backend, now);
    const rowState = id === value && currentState ? currentState : base.state;
    const reverting = id === revertTo && !appBound;
    const recovery = reverting ? undefined : recoveryFor(rowState, appBound);
    const current = id === value;
    const canSelect = !locked && !disabled && !saving && (reverting || base.policy.decision === "allow");
    const handled = recovery === "manage" ? Boolean(onManage) : recovery === "login" ? Boolean(onRepair) : recovery === "retry" ? Boolean(onRecheck) : false;
    return {
      id, backend, rowState, current, canSelect,
      tone: TONE[rowState],
      recovery: handled ? recovery : undefined,
      /* 灰掉只意味着一件事：切不过去。当前 Agent 无论坏成什么样都不灰——它是「你在哪」。 */
      dim: !current && !canSelect,
      verb: handled && recovery !== "manage" ? t(recovery === "login" ? "agentAvailability.login" : "agentAvailability.retry") : undefined,
    };
  });

  const displayRows: AgentPickerRow[] = rows.map(row => {
    const agent = quota.snapshot.agents.find(agent => agent.backend === row.id) ?? emptyAgentLimits(row.id);
    const isCustom = row.id === value && customProvider, stateText = t(`agentAvailability.state.${row.rowState}`);
    const line = row.tone === "quiet" ? <QuotaSummaryText agent={agent} now={quota.now} customProvider={isCustom} />
      : row.rowState === "usage-limit" && row.current && usageResetsAt !== undefined
        ? `${stateText} · ${t("settings.usage.limits.resets", { date: quotaResetClock(usageResetsAt, quota.now) })}` : stateText;
    return { ...row, name: backendLabel(row.id), choosable: row.canSelect || row.current, inert: !row.current && !row.canSelect && !row.recovery,
      label: [backendLabel(row.id), row.tone === "quiet" ? null : stateText, row.verb].filter(Boolean).join(" · "),
      description: quotaDescription(agent, quota.now, t, isCustom), line, peek: hint.peek === row.id, handlers: hint.handlers(row.id),
      select: event => { if (row.canSelect && !row.current) { void onChange(row.id); return; } event.preventDefault(); if (row.recovery) handleRecovery(row.id, row.recovery); },
    };
  });
  return <AgentPicker value={value} open={open} onOpenChange={next => { hint.dismiss(); setOpen(next); }} triggerRef={trigger} menuRef={menu} label={label}
    busy={projection.refreshing || saving} tone={tone} prefetch={prefetchQuota} rows={displayRows} descriptionId={descriptionId}
    tooltip={<div className="flex flex-col gap-1 text-left"><p>{tone === "quiet" ? backendLabel(value) : `${backendLabel(value)} · ${text}`}</p>{locked && reason && <p className="text-background/70">{reason}</p>}</div>}
    heading={locked && <><DropdownMenuLabel className="whitespace-normal font-normal">{reason ?? t("agentAvailability.locked")}</DropdownMenuLabel><DropdownMenuSeparator /></>}
    footer={onOpenUsage && hint.card} announcement={`${backendLabel(value)} · ${text}`} onEscapeKeyDown={hint.onEscape}
    onCloseAutoFocus={event => { if (openingSettings.current) { event.preventDefault(); openingSettings.current = false; } }} />;
}
