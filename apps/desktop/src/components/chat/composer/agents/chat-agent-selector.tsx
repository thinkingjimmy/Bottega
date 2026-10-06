/**
 * [INPUT]: Pure lib/agent/picker policy over shared availability and quota facts, draft cancellation, bounded quota demand, localized copy and injected management/Usage navigation.
 * [OUTPUT]: Renders installed Providers in Settings order, prioritizing login and quota over update notices, with scoped quota demand, draft cancellation and row-anchored Usage access.
 * [POS]: apps/desktop/src/components/chat/composer/agents; Composer identity and availability control; the row is the only control and the menu has no footer, so nothing competes with the selected mark.
 */
import { useCallback, useId, useRef, useState, useSyncExternalStore } from "react";


import { DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator } from "@ai-chat/ui/components/ui/dropdown-menu";
import { AgentPicker, type AgentPickerRow } from "@ai-chat/chat-ui/agent-picker";
import type { AgentBackendId, BackendInfo } from "../../../../../shared/ipc/agent/agent-ipc";
import { projectAvailability } from "../../../../../shared/agent-availability/projection";
import type { AvailabilityState } from "../../../../../shared/agent-availability/types";
import { isAgentBackendId, orderedProviders, providerName, providerState } from "@/lib/agent/agent-backends";
import { useProviderCatalog, useProviderName } from "@/lib/provider-catalog/hooks";
import { installedPickerProvider, pickerQuotaEligible, projectPickerPresentation } from "@/lib/agent/picker/presentation";
import type { ChatAgentId } from "../../../../../shared/chat-agent/options";
import { AVAILABILITY_STATE_KEYS, PROVIDER_UNAVAILABLE_REASON_KEYS } from "../../../../../shared/agent-availability/copy";
import { settingsStore } from "@/lib/settings/store/settings-store";
import { useTurnedOffPlugins } from "@/components/settings/plugins/turned-off";
import { useAppTranslation } from "@/components/providers/preferences/i18n-provider";

import { useUsageLimits, useUsageLimitsDemand, useUsageLimitsPrefetch } from "@/lib/usage-limits/hooks";
import { refreshSetupIfNeeded } from "@/lib/settings/setup/setup-client";
import { quotaDescription, quotaDetail, quotaResetClock } from "@/lib/usage-limits/format";
import { emptyAgentLimits } from "../../../../../shared/usage-limits/projection";
import { useQuotaMenuHint } from "../usage/menu-hint";
import { QuotaSummaryText } from "../usage/summary";

/* ── 十二个状态，三种声量 ──────────────────────────────────────
 * quiet 在触发器上不出字：ready 与 unverified 说的是「没出问题」，
 * 而「没出问题」不改变任何人此刻能做的事。working 只转一圈。
 * 剩下九个才配一个词——它们各自对应一件能做的事。
 * ────────────────────────────────────────────────────────── */
type Tone = "quiet" | "working" | "attention";
const TONE: Record<AvailabilityState, Tone> = {
  /* A custom route is quiet on the trigger like "Not verified" (nothing is wrong); its row names it instead of a quota line. */
  ready: "quiet", "custom-route": "quiet", unverified: "quiet", checking: "working",
  "sign-in": "attention", "recent-sign-in": "attention", missing: "attention", unsupported: "attention",
  "cannot-check": "attention", "cannot-start": "attention",
  connection: "attention", service: "attention", "usage-limit": "attention", unavailable: "attention",
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

export function ChatAgentSelector({ value, draft = false, revertTo, backends, locked, disabled, saving, onChange, onRecheck, onRepair, onManage, appBound = false, now, currentState, reason, onOpenUsage, customProvider = false, usageResetsAt }: {
  reason?: string;
  /** The card beside a row opens Usage on that Agent's tab; the menu itself offers no other way there. */
  onOpenUsage?: (trigger: HTMLElement | null, agent: AgentBackendId) => void;
  customProvider?: boolean;
  /** The Chat's Agent: a built-in, or a package Provider's once the Chat runs on one (TASK-11 S3-b). */
  value: ChatAgentId;
  /** No Chat record yet: only a draft may start on a package Provider; an existing Chat never moves to or from one. */
  draft?: boolean;
  /** Cancelling an unsent switch does not require the previous Agent to be available. */
  revertTo?: AgentBackendId;
  backends: BackendInfo[];
  locked: boolean;
  disabled?: boolean;
  saving?: boolean;
  onChange: (backend: ChatAgentId) => Promise<void>;
  onRecheck?: (backend: AgentBackendId) => void;
  onRepair?: (backend: AgentBackendId, action: "login") => void;
  /** Receives the row's state so missing/signed-out Agents open setup and outdated ones open Updates. */
  onManage?: (backend: AgentBackendId, state: AvailabilityState) => void;
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
  const handleRecovery = useCallback((backend: AgentBackendId, recovery: Recovery, state: AvailabilityState) => {
    if (recovery === "manage") {
      openingSettings.current = true;
      setOpen(false);
      onManage?.(backend, state);
    } else if (recovery === "login") onRepair?.(backend, "login");
    else onRecheck?.(backend);
  }, [onManage, onRecheck, onRepair]);
  const quota = useUsageLimits();
  const { settings } = useSyncExternalStore(settingsStore.subscribe, settingsStore.getSnapshot);
  const catalog = useProviderCatalog();
  const agentName = useProviderName();
  const turnedOff = useTurnedOffPlugins();
  const candidates = (appBound ? catalog.entries.filter((entry) => entry.id === value) : orderedProviders(settings, catalog))
    .filter(entry => !isAgentBackendId(entry.id) || !turnedOff.has(entry.id));
  const entries = candidates.filter(entry => installedPickerProvider(entry, backends.find(backend => backend.id === entry.id)));
  const discovering = candidates.some(entry => entry.source === "builtin" &&
    [undefined, "unknown"].includes(backends.find(backend => backend.id === entry.id)?.runtimeStatus));
  const quotaOrder = entries.map(entry => entry.id).filter(isAgentBackendId)
    .filter(id => pickerQuotaEligible(backends.find(backend => backend.id === id)) && !(id === value && customProvider));
  const prefetchQuota = useUsageLimitsPrefetch(quotaOrder.length > 0, quotaOrder);
  useUsageLimitsDemand(open && quotaOrder.length > 0, "selector", quotaOrder);
  const hint = useQuotaMenuHint(open, menu, (backend) => {
    const agent = quota.snapshot.agents.find((entry) => entry.backend === backend) ?? emptyAgentLimits(backend);
    const info = backends.find(entry => entry.id === backend);
    const state = backend === value && currentState ? currentState : projectAvailability(info, now).state;
    if (!entries.some(entry => entry.id === backend) || !projectPickerPresentation(info, state, agent).showQuota) {
      return { scope: "", windows: [], notes: [] };
    }
    return quotaDetail(agent, quota.now, t, backend === value && customProvider, true);
  }, (backend) => {
    if (!onOpenUsage) return;
    openingSettings.current = true;
    setOpen(false);
    onOpenUsage(trigger.current, backend);
  });

  const selected = backends.find((entry) => entry.id === value);
  const projection = projectAvailability(selected, now);
  const selectedLimits = quota.snapshot.agents.find(entry => entry.backend === value);
  const state = projectPickerPresentation(selected, currentState ?? projection.state, selectedLimits).state;
  const tone = TONE[state];
  const text = t(AVAILABILITY_STATE_KEYS[state]);
  const valueName = agentName(value);
  const label = `${valueName} · ${text} · ${t("agentAvailability.openMenu")}`;
  /* A package Provider's Chat is pinned to it: main refuses a switch either way, so no other row offers one. */
  const pinned = !draft && !isAgentBackendId(value);

  const rows = entries.map((entry) => {
    const id = entry.id, agent = isAgentBackendId(id) ? id : undefined;
    const backend = backends.find((info) => info.id === id);
    const base = projectAvailability(backend, now);
    const derived = providerState(entry, backend, now, Boolean(agent) || draft || id === value);
    const limits = quota.snapshot.agents.find(entry => entry.backend === id);
    const presentation = projectPickerPresentation(backend, derived === "unavailable" ? derived : id === value && currentState ? currentState : base.state, limits);
    const rowState = presentation.state;
    const reverting = id === revertTo && !appBound;
    const recovery = reverting || !agent ? undefined : recoveryFor(rowState, appBound);
    const current = id === value;
    const canSelect = derived !== "unavailable" && !pinned && !locked && !disabled && !saving &&
      (reverting || base.policy.decision === "allow" && !["sign-in", "recent-sign-in"].includes(rowState));
    const handled = recovery === "manage" ? Boolean(onManage) : recovery === "login" ? Boolean(onRepair) : recovery === "retry" ? Boolean(onRecheck) : false;
    return {
      id, agent, entry, rowState, current, canSelect, limits, presentation,
      tone: TONE[rowState],
      recovery: handled ? recovery : undefined,
      /* 灰掉只意味着一件事：切不过去。当前 Agent 无论坏成什么样都不灰——它是「你在哪」。 */
      dim: !current && !canSelect,
      verb: handled && recovery !== "manage" ? t(recovery === "login" ? "agentAvailability.login" : "agentAvailability.retry") : undefined,
    };
  });

  const displayRows: AgentPickerRow[] = rows.map(row => {
    const name = providerName(row.entry), stateText = t(row.presentation.update === "required" ? "agentAvailability.updateForUsage" : AVAILABILITY_STATE_KEYS[row.rowState]);
    const updateText = row.presentation.update === "available" ? t("agentAvailability.updateAvailable") : undefined;
    const label = [name, row.tone === "quiet" && row.rowState !== "custom-route" ? null : stateText, updateText, row.verb].filter(Boolean).join(" · ");
    const inert = !row.current && !row.canSelect && !row.recovery;
    if (!row.agent) {
      /* A package Provider has no quota and no recovery verbs this period; an unavailable one says why. */
      const reason = row.entry.unavailableReason ? t(PROVIDER_UNAVAILABLE_REASON_KEYS[row.entry.unavailableReason]) : null;
      return { id: row.id, name, current: row.current, choosable: row.canSelect || row.current, inert, dim: row.dim, tone: row.tone, label, description: "",
        line: reason ? `${stateText} · ${reason}` : stateText,
        select: event => { if (row.canSelect && !row.current) { void onChange(row.id); return; } event.preventDefault(); } };
    }
    const agent = row.agent;
    const limits = row.limits ?? emptyAgentLimits(agent);
    const isCustom = row.id === value && customProvider;
    const line = row.rowState === "custom-route" ? stateText : row.presentation.showQuota ? <div className="flex flex-wrap items-center gap-x-1"><div className="text-muted-foreground"><QuotaSummaryText agent={limits} now={quota.now} customProvider={isCustom} /></div>{updateText && <span className="text-amber-700 dark:text-amber-400">{`· ${updateText}`}</span>}</div>
      : row.rowState === "usage-limit" && row.current && usageResetsAt !== undefined
        ? `${stateText} · ${t("settings.usage.limits.resets", { date: quotaResetClock(usageResetsAt, quota.now) })}` : stateText;
    return { id: row.id, name, current: row.current, choosable: row.canSelect || row.current, inert, dim: row.dim, tone: row.tone, verb: row.verb, label,
      description: [row.presentation.showQuota ? quotaDescription(limits, quota.now, t, isCustom) : stateText, updateText].filter(Boolean).join("\n"), line,
      peek: hint.peek === row.id, handlers: row.presentation.showQuota ? hint.handlers(agent) : undefined,
      select: event => { if (row.canSelect && !row.current) { void onChange(agent); return; } event.preventDefault(); if (row.recovery) handleRecovery(agent, row.recovery, row.rowState); },
    };
  });
  /* The other Agents are checked when the person opens the menu, not at launch (OPT-20); rows show their existing
     checking state until the result arrives through the Setup events. */
  return <AgentPicker value={value} open={open} onOpenChange={next => { hint.dismiss(); setOpen(next); if (next) void refreshSetupIfNeeded("full").catch(() => undefined); }} triggerRef={trigger} menuRef={menu} label={label}
    busy={projection.refreshing || saving} tone={tone} prefetch={prefetchQuota} rows={displayRows} descriptionId={descriptionId}
    heading={<>{locked && <><DropdownMenuLabel className="whitespace-normal font-normal">{reason ?? t("agentAvailability.locked")}</DropdownMenuLabel><DropdownMenuSeparator /></>}
      {displayRows.length === 0 && discovering && <DropdownMenuLabel>{t("agentAvailability.state.checking")}</DropdownMenuLabel>}
      {displayRows.length === 0 && !discovering && <DropdownMenuItem disabled={!isAgentBackendId(value) || !onManage} onSelect={() => { if (isAgentBackendId(value)) handleRecovery(value, "manage", "missing"); }} className="flex-col items-start gap-1">
        <span>{t("agentAvailability.noInstalledProviders")}</span>{onManage && <span className="text-xs text-muted-foreground">{t("agentAvailability.manage")}</span>}
      </DropdownMenuItem>}</>}
    footer={onOpenUsage && hint.card} announcement={`${valueName} · ${text}`} onEscapeKeyDown={hint.onEscape}
    onCloseAutoFocus={event => { if (openingSettings.current) { event.preventDefault(); openingSettings.current = false; } }} />;
}
