/**
 * [INPUT]: Depends on React, lucide ArrowRight, current quota details, Agent branding, localized copy and measured menu/row rectangles.
 * [OUTPUT]: Provides useQuotaMenuHint, which anchors a delayed quota card, supports keyboard focus and dismisses pending hints before opening Usage, plus placeQuotaHint.
 * [POS]: The picker's detail layer and its only door to Settings › Usage; rows without side room or quota windows keep their description and reach Usage through Settings.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { ArrowRight } from "lucide-react";
import type { AgentBackendId } from "../../../../../shared/agent-ipc";
import { AgentBackendIcon, backendLabel } from "@/lib/agent-backends";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import type { QuotaDetail } from "@/lib/usage-limits/format";
type Hint = { element: HTMLElement; backend: AgentBackendId; focus: boolean };
/* 指针要走 8px 才到卡片；离开行到进卡之间给 300ms，比一次犹豫长、比一次误触短。 */
const POINTER_DELAY = 500, FOCUS_DELAY = 650, GRACE = 300;
export function placeQuotaHint(menu: Pick<DOMRect, "left" | "right">, row: Pick<DOMRect, "top">, width: number, height: number, viewport: { width: number; height: number }) {
  const margin = 8, gap = 8;
  if (width > viewport.width - margin * 2 || height > viewport.height - margin * 2) return null;
  const top = Math.max(margin, Math.min(row.top, viewport.height - height - margin));
  if (menu.left - gap - width >= margin) return { left: menu.left - gap - width, top };
  if (menu.right + gap + width <= viewport.width - margin) return { left: menu.right + gap, top };
  return null;
}
export function useQuotaMenuHint(open: boolean, menu: RefObject<HTMLDivElement | null>, detailFor: (backend: AgentBackendId) => QuotaDetail, onActivate: (backend: AgentBackendId) => void) {
  const [hint, setHint] = useState<Hint | null>(null);
  const card = useRef<HTMLDivElement>(null);
  const showTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pointed = useRef<HTMLElement | null>(null);
  /* Radix blurs a row the instant the pointer leaves it. We hold that blur back while the
     pointer travels to the card, and remember that we did, so the row is released the way
     Radix would have released it — and only then; a keyboard-focused row brushed by the
     mouse keeps its focus. */
  const held = useRef(false);
  const cancel = () => { clearTimeout(showTimer.current); clearTimeout(hideTimer.current); };
  const clear = useCallback(() => { clearTimeout(showTimer.current); clearTimeout(hideTimer.current); setHint(null); }, []);
  const release = useCallback(() => {
    clear();
    if (held.current) { held.current = false; menu.current?.focus(); }
  }, [clear, menu]);
  useEffect(() => {
    if (!open) return;
    window.addEventListener("resize", clear);
    window.addEventListener("scroll", clear, true);
    return () => { clearTimeout(showTimer.current); clearTimeout(hideTimer.current); window.removeEventListener("resize", clear); window.removeEventListener("scroll", clear, true); };
  }, [open, clear]);
  const hideLater = () => { clearTimeout(hideTimer.current); hideTimer.current = setTimeout(release, GRACE); };
  const show = (element: HTMLElement, backend: AgentBackendId, delay: number) => {
    /* Coming back to the row whose card is already up only cancels its departure. */
    if (hint?.element === element) { clearTimeout(hideTimer.current); return; }
    clear();
    showTimer.current = setTimeout(() => { if (element.isConnected) setHint({ element, backend, focus: false }); }, delay);
  };
  const detail = hint ? detailFor(hint.backend) : null;
  const shown = open && hint && detail?.windows.length ? { hint, detail } : null;
  return {
    dismiss: clear,
    /* The row whose card is up stays lit whichever input holds the focus, so the pair reads as one. */
    peek: shown?.hint.backend ?? null,
    handlers: (backend: AgentBackendId) => ({
      onPointerEnter: (event: React.PointerEvent<HTMLElement>) => {
        if (event.pointerType === "touch") return;
        pointed.current = event.currentTarget; held.current = false; show(event.currentTarget, backend, POINTER_DELAY);
      },
      onPointerLeave: (event: React.PointerEvent<HTMLElement>) => {
        pointed.current = null;
        if (hint?.element !== event.currentTarget) { clear(); return; }
        event.preventDefault(); held.current = true; hideLater();
      },
      onFocus: (event: React.FocusEvent<HTMLElement>) => { if (pointed.current !== event.currentTarget) show(event.currentTarget, backend, FOCUS_DELAY); },
      onBlur: (event: React.FocusEvent<HTMLElement>) => { if (!card.current?.contains(event.relatedTarget)) clear(); },
      onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => {
        if (event.key !== "ArrowRight") return;
        event.preventDefault();
        if (hint?.element === event.currentTarget) card.current?.focus();
        else { cancel(); setHint({ element: event.currentTarget, backend, focus: true }); }
      },
    }),
    /* Escape inside the card walks back to its row; the menu only closes from a row. */
    onEscape: (event: KeyboardEvent) => {
      if (!hint || !card.current?.contains(document.activeElement)) return;
      event.preventDefault(); hint.element.focus();
    },
    card: shown
      ? <QuotaHint key={shown.hint.backend} ref={card} backend={shown.hint.backend} anchor={shown.hint.element} detail={shown.detail} menu={menu} autoFocus={shown.hint.focus}
          onHold={() => clearTimeout(hideTimer.current)} onLeave={hideLater} onActivate={() => { clear(); onActivate(shown.hint.backend); }} /> : null,
  };
}
/* 六行同号同色的文字里没有重点。这里借用 Settings 里那条额度行的说法——
   标题在左、读数右对齐加重、恢复时刻退到标题下方——出处（查询时间、缓存、时区）
   压到一条细线之下：它们是脚注，不是这个人此刻在找的东西。

   整张卡是一个按压目标，静息时不说；指针进来才填充，标题行右端才浮出去处的名字——
   与 approval-card 的选项行同一套话。它住在菜单内容里而不是 body 上，Radix 的焦点圈
   与外点判定才会把它当自己人；定位仍按视口算，再换算到 Popper 包装层的坐标。 */
function QuotaHint({ ref, backend, anchor, detail, menu, autoFocus, onHold, onLeave, onActivate }: {
  ref: RefObject<HTMLDivElement | null>; backend: AgentBackendId; anchor: HTMLElement; detail: QuotaDetail; menu: RefObject<HTMLDivElement | null>;
  autoFocus: boolean; onHold: () => void; onLeave: () => void; onActivate: () => void;
}) {
  const { t } = useAppTranslation();
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || !menu.current || !anchor.isConnected) return;
    const bounds = element.getBoundingClientRect();
    const placed = placeQuotaHint(menu.current.getBoundingClientRect(), anchor.getBoundingClientRect(), bounds.width, bounds.height, { width: window.innerWidth, height: window.innerHeight });
    const origin = (element.offsetParent ?? menu.current).getBoundingClientRect();
    setPosition(placed && { left: placed.left - origin.left, top: placed.top - origin.top });
  }, [ref, anchor, detail, menu]);
  useEffect(() => { if (autoFocus && position) ref.current?.focus(); }, [ref, autoFocus, position]);
  return <div ref={ref} role="menuitem" tabIndex={-1} aria-label={`${backendLabel(backend)} · ${t("settings.usage.limits.details")}`} data-testid="quota-menu-hint" data-agent={backend}
    className="group/quota-hint absolute z-10 w-68 max-w-[calc(100vw-1rem)] cursor-pointer rounded-lg bg-popover p-3 text-popover-foreground shadow-md ring-1 ring-border outline-none hover:bg-accent focus:bg-accent"
    style={{ ...position, visibility: position ? "visible" : "hidden" }}
    onPointerEnter={onHold} onPointerLeave={onLeave} onClick={onActivate}
    onKeyDown={(event) => {
      if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onActivate(); }
      else if (event.key === "ArrowLeft") { event.preventDefault(); anchor.focus(); }
    }}>
    <div className="flex items-center gap-1.5">
      <AgentBackendIcon backend={backend} className="size-3.5 shrink-0 [&>svg]:size-full!" />
      <p className="font-medium text-xs">{backendLabel(backend)}</p>
      {detail.scope && <span className="text-[10px] text-muted-foreground">{detail.scope}</span>}
      <span aria-hidden="true" className="ml-auto flex shrink-0 items-center gap-1 text-[11px] leading-4 text-muted-foreground opacity-0 transition-opacity motion-reduce:transition-none group-hover/quota-hint:opacity-100 group-focus/quota-hint:opacity-100">
        {t("settings.usage.limits.details")}
        <ArrowRight className="size-3 transition-transform motion-reduce:transition-none group-hover/quota-hint:translate-x-0.5 group-focus/quota-hint:translate-x-0.5" />
      </span>
    </div>
    {detail.status && <p className="mt-1 text-[11px] leading-4 text-muted-foreground">{detail.status}</p>}
    {detail.windows.map((window) => <div key={window.title} className="mt-2 flex items-baseline gap-3">
      <div className="min-w-0 flex-1">
        <p className="text-xs leading-4">{window.title}</p>
        <p className="mt-0.5 break-words text-[11px] leading-4 text-muted-foreground">{window.reset}</p>
        {window.previousReset && <p className="break-words text-[11px] leading-4 text-muted-foreground">{window.previousReset}</p>}
      </div>
      <span className={`shrink-0 text-right font-medium text-sm tabular-nums ${window.caution ? "text-amber-700 dark:text-amber-400" : ""}`}>{window.reading}</span>
    </div>)}
    {detail.notes.length > 0 && <div className="mt-2.5 space-y-0.5 border-t border-border/60 pt-2 text-[11px] leading-4 text-muted-foreground">
      {detail.notes.map((note) => <p key={note}>{note}</p>)}
    </div>}
  </div>;
}
