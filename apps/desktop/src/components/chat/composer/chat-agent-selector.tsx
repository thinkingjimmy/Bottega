/**
 * [INPUT]: Depends on shared availability facts, localized copy and existing menu/tooltip primitives.
 * [OUTPUT]: Renders a wordless Agent chip, a one-line tooltip and a repair-capable picker whose rows stay uniform; refresh never changes the selected Agent.
 * [POS]: Composer identity and availability control; status is spent only where it changes what the reader can do.
 */
import { useCallback } from "react";
import { LoaderCircle, TriangleAlert } from "lucide-react";
import { Button } from "@ai-chat/ui/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from "@ai-chat/ui/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@ai-chat/ui/components/ui/tooltip";
import { AGENT_BACKEND_ORDER, type AgentBackendId, type BackendInfo } from "../../../../shared/agent-ipc";
import { projectAvailability } from "../../../../shared/agent-availability/projection";
import type { AvailabilityState } from "../../../../shared/agent-availability/types";
import { AgentBackendIcon, backendLabel } from "@/lib/agent-backends";
import { useAppTranslation } from "@/components/providers/i18n-provider";

/* ── 十二个状态，三种声量 ──────────────────────────────────────
 * quiet 三处界面都不出字：ready 与 unverified 说的是「没出问题」，
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

/* 动词已经说明了病因的状态只给按钮：`Sign in required` 挨着一枚 Sign in
   是同一个事实穿两件衣服。Retry 什么病因都没说，故那四个保留标签；
   usage-limit 是等而不是重试，因此有标签、没按钮。 */
const REPAIR: Partial<Record<AvailabilityState, "install" | "login" | "update">> = {
  missing: "install", "sign-in": "login", "recent-sign-in": "login", unsupported: "update",
};
const RETRYABLE = new Set<AvailabilityState>(["connection", "service", "cannot-check", "cannot-start"]);

export function ChatAgentSelector({ value, backends, locked, disabled, saving, onChange, onRecheck, onRepair, appBound = false, now, currentState, reason }: {
  reason?: string;
  value: AgentBackendId;
  backends: BackendInfo[];
  locked: boolean;
  disabled?: boolean;
  saving?: boolean;
  onChange: (backend: AgentBackendId) => Promise<void>;
  onRecheck?: (backend: AgentBackendId) => void;
  onRepair?: (backend: AgentBackendId, action: "install" | "login" | "update") => void;
  appBound?: boolean;
  now: number;
  currentState?: AvailabilityState;
}) {
  const { t } = useAppTranslation();
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
    const repair = REPAIR[rowState];
    return {
      id, backend, rowState, repair,
      tone: TONE[rowState],
      retry: !repair && RETRYABLE.has(rowState),
      canSelect: !locked && !disabled && !saving && base.policy.decision === "allow",
    };
  });

  /* 面板宽度是内容的函数——这里每个字符串都是已知的枚举标签，没有后端自由
     文本，`w-max` 的上下限于是真的兜得住（model 面板禁用它正是因为反面）。
     打开那一刻把当时的宽度焊成下限：探测中途落地可以把面板撑宽，却绝不会
     让它在指针底下缩回去。面板一关就卸载，下次打开重新量。 */
  const pinWidth = useCallback((element: HTMLDivElement | null) => {
    if (element) element.style.minWidth = `${element.offsetWidth}px`;
  }, []);

  return <>
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="ghost" aria-label={label} aria-busy={projection.refreshing || saving} className="h-8 shrink-0 gap-1.5 rounded-full px-2">
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
      <DropdownMenuContent ref={pinWidth} side="top" align="end" className="w-max min-w-46 max-w-72">
        <DropdownMenuRadioGroup value={value}>
          {rows.map((row) => {
            const action = row.repair && onRepair && !appBound
              ? { label: t(`agentAvailability.${row.repair}`), run: () => onRepair(row.id, row.repair!) }
              : row.retry && onRecheck ? { label: t("agentAvailability.retry"), run: () => onRecheck(row.id) } : undefined;
            return <DropdownMenuRadioItem key={row.id} value={row.id} aria-disabled={!row.canSelect}
              title={row.backend?.reason || undefined}
              /* 行只做这一行能做的那件事：选得动就切换，选不动就修。键盘因此
                 无需够到那枚按钮——按钮是给指针看的落点，不是唯一的入口。 */
              onSelect={(event) => {
                if (row.canSelect && row.id !== value) { void onChange(row.id); return; }
                event.preventDefault();
                if (!row.canSelect) action?.run();
              }}
              className="min-h-8 gap-2">
              <AgentBackendIcon backend={row.id} className="size-4" />
              <span className="flex-1">{backendLabel(row.id)}</span>
              {row.tone === "working" && <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin text-muted-foreground motion-reduce:animate-none" />}
              {row.tone === "attention" && !row.repair && <span className="text-amber-600 dark:text-amber-400">{t(`agentAvailability.state.${row.rowState}`)}</span>}
              {action && <Button type="button" variant="outline" size="xs" tabIndex={-1}
                onClick={(event) => { event.preventDefault(); event.stopPropagation(); action.run(); }}>{action.label}</Button>}
            </DropdownMenuRadioItem>;
          })}
        </DropdownMenuRadioGroup>
        {locked && <DropdownMenuLabel className="whitespace-normal font-normal">{reason ?? t("agentAvailability.locked")}</DropdownMenuLabel>}
      </DropdownMenuContent>
    </DropdownMenu>
    <span className="sr-only" aria-live="polite" aria-atomic="true">{backendLabel(value)} · {text}</span>
  </>;
}
