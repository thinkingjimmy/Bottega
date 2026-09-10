/**
 * [INPUT]: Depends on shared availability facts, quota projections, localized copy, injected Agent management and existing menu/tooltip primitives.
 * [OUTPUT]: Renders an availability-aware Agent chip over a quota picker whose rows carry one line of truth and one slot of action; refresh never changes the selected Agent.
 * [POS]: Composer identity and availability control; the row is the only control, so nothing competes with the selected mark.
 */
import { useCallback, useId, useRef, useState } from "react";
import { ArrowRight, Check, LoaderCircle, TriangleAlert } from "lucide-react";
import { Button } from "@ai-chat/ui/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuItem, DropdownMenuRadioGroup, DropdownMenuSeparator, DropdownMenuTrigger } from "@ai-chat/ui/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@ai-chat/ui/components/ui/tooltip";
import { AGENT_BACKEND_ORDER, type AgentBackendId, type BackendInfo } from "../../../../shared/agent-ipc";
import { projectAvailability } from "../../../../shared/agent-availability/projection";
import type { AvailabilityState } from "../../../../shared/agent-availability/types";
import { AgentBackendIcon, backendLabel } from "@/lib/agent-backends";
import { useAppTranslation } from "@/components/providers/i18n-provider";

import { useUsageLimits, useUsageLimitsDemand } from "@/lib/usage-limits/hooks";
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

export function ChatAgentSelector({ value, backends, locked, disabled, saving, onChange, onRecheck, onRepair, onManage, appBound = false, now, currentState, reason, onOpenUsage, customProvider = false, usageResetsAt }: {
  reason?: string;
  onOpenUsage?: (trigger: HTMLElement | null) => void;
  customProvider?: boolean;
  value: AgentBackendId;
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
  useUsageLimitsDemand(open && Boolean(onOpenUsage), "selector", appBound ? [value] : AGENT_BACKEND_ORDER);
  const hint = useQuotaMenuHint(open, menu);

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
    const recovery = recoveryFor(rowState, appBound);
    const current = id === value;
    const canSelect = !locked && !disabled && !saving && base.policy.decision === "allow";
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

  return <>
    <DropdownMenu open={open} onOpenChange={(next) => { hint.dismiss(); setOpen(next); }}>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button ref={trigger} type="button" variant="ghost" aria-label={label} aria-busy={projection.refreshing || saving} className="h-8 shrink-0 gap-1.5 rounded-full px-2">
              {tone === "working"
                ? <span className="relative flex size-5 shrink-0 items-center justify-center">
                    <AgentBackendIcon backend={value} className="size-3.5" />
                    <span aria-hidden="true" className="absolute inset-0 animate-spin rounded-full border-[1.5px] border-border border-t-muted-foreground motion-reduce:animate-none" />
                  </span>
                : <AgentBackendIcon backend={value} className="size-4" />}
              {tone === "attention" && <TriangleAlert aria-hidden="true" className="size-3.5 shrink-0 text-amber-600 dark:text-amber-400" />}
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        {/* TooltipContent 是 inline-flex + items-center：多个子节点会各自成为一列，
            三段文案于是排成三栏。给它一个块级父容器，这条才回到「一行一句」。 */}
        <TooltipContent className="max-w-64">
          <div className="flex flex-col gap-1 text-left">
            <p>{tone === "quiet" ? backendLabel(value) : `${backendLabel(value)} · ${text}`}</p>
            {locked && reason && <p className="text-background/70">{reason}</p>}
          </div>
        </TooltipContent>
      </Tooltip>
      <DropdownMenuContent ref={menu} side="top" align="end" className="w-76 min-w-0 max-w-[calc(100vw-1rem)]" data-testid="agent-usage-menu"
        onCloseAutoFocus={(event) => { if (openingSettings.current) { event.preventDefault(); openingSettings.current = false; } }}>
        {/* 锁的理由管着它下面的每一行，所以它必须在第一行之上；印在最后一行下面读起来是脚注。 */}
        {locked && <>
          <DropdownMenuLabel className="whitespace-normal font-normal">{reason ?? t("agentAvailability.locked")}</DropdownMenuLabel>
          <DropdownMenuSeparator />
        </>}
        <DropdownMenuRadioGroup value={value}>
          {rows.map((row) => {
            const agent = quota.snapshot.agents.find((agent) => agent.backend === row.id) ?? emptyAgentLimits(row.id);
            const isCustom = row.id === value && customProvider;
            const description = quotaDescription(agent, quota.now, t, isCustom);
            const stateText = t(`agentAvailability.state.${row.rowState}`);
            /* 等待是唯一的动作，所以「等多久」是这一行唯一有用的补充。 */
            const line = row.tone === "quiet"
              ? <QuotaSummaryText agent={agent} now={quota.now} customProvider={isCustom} />
              : row.rowState === "usage-limit" && row.current && usageResetsAt !== undefined
                ? `${stateText} · ${t("settings.usage.limits.resets", { date: quotaResetClock(usageResetsAt, quota.now) })}`
                : stateText;
            /* 能选的行与当前行是单选项；只能修的行不是选项，别让它穿单选的衣服。 */
            const choosable = row.canSelect || row.current;
            /* 真正什么也做不了的行才交给 Radix 的 disabled——只有它会同时挡住指针与键盘。
               但它自带的 opacity-50 会把动词一起压暗，而这里灰掉的只该是身份。 */
            const inert = !row.current && !row.canSelect && !row.recovery;
            return <DropdownMenuItem key={row.id} role={choosable ? "menuitemradio" : "menuitem"}
              aria-checked={choosable ? row.current : undefined} disabled={inert}
              aria-label={[backendLabel(row.id), row.tone === "quiet" ? null : stateText, row.verb].filter(Boolean).join(" · ")}
              aria-describedby={`${descriptionId}-${row.id}`} data-agent={row.id}
              {...hint.handlers(quotaDetail(agent, quota.now, t, isCustom, true))}
              onSelect={(event) => {
                if (row.canSelect && !row.current) { void onChange(row.id); return; }
                event.preventDefault();
                if (row.recovery) handleRecovery(row.id, row.recovery);
              }}
              className="min-h-[50px] items-center gap-2.5 px-2.5 py-1.5 data-disabled:opacity-100">
              <AgentBackendIcon backend={row.id} className={`size-4 shrink-0 [&>svg]:size-full! ${row.dim ? "[&>svg]:opacity-60" : ""}`} />
              <div className="min-w-0 flex-1">
                <div className={`flex min-h-4 items-center leading-4 font-medium ${row.dim ? "text-muted-foreground" : ""}`}>{backendLabel(row.id)}</div>
                <div className={`mt-0.5 text-[11px] leading-4 tabular-nums ${row.tone === "attention" ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground"}`}
                  data-testid={`agent-line-${row.id}`}>{line}</div>
              </div>
              {/* 一个槽，一个记号，自身与名字那一行对齐——按整行居中会比名字低十个像素。 */}
              <span className="flex h-4 shrink-0 items-center justify-end self-start">
                {row.tone === "working"
                  ? <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin text-muted-foreground motion-reduce:animate-none" />
                  : row.verb ? <span className="text-[11px] font-medium whitespace-nowrap">{row.verb}</span>
                  : row.current ? <Check aria-hidden="true" className="size-3.5" /> : null}
              </span>
              <span id={`${descriptionId}-${row.id}`} hidden>{description}</span>
            </DropdownMenuItem>;
          })}
        </DropdownMenuRadioGroup>
        {onOpenUsage && <>
          {/* 分隔线要留出上下各 4px：紧贴它的行一 hover 就是一块圆角填充，
              零间距时那条线看起来像是从填充里穿过去。 */}
          <DropdownMenuSeparator />
          <DropdownMenuItem className="min-h-[34px] justify-between gap-3 px-2.5 text-[11px]" onSelect={() => { openingSettings.current = true; onOpenUsage(trigger.current); }} data-testid="agent-usage-details">
            <span className="text-muted-foreground">{t("settings.usage.limits.scope")}</span>
            <span className="flex items-center gap-1">{t("settings.usage.limits.details")}<ArrowRight aria-hidden="true" className="size-3" /></span>
          </DropdownMenuItem>
        </>}
      </DropdownMenuContent>
    </DropdownMenu>
    {hint.content}
    <span className="sr-only" aria-live="polite" aria-atomic="true">{backendLabel(value)} · {text}</span>
  </>;
}
