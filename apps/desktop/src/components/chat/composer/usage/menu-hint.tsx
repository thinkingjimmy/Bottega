/**
 * [INPUT]: Depends on React portal/lifetimes, the shared quota detail model and the open menu's measured rectangle.
 * [OUTPUT]: Provides delayed, non-interactive quota hints — readings weighted over provenance — placed outside the entire option panel.
 * [POS]: Passive picker detail layer; screen-reader descriptions remain available when a visual hint cannot fit.
 */
import { useEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import type { QuotaDetail } from "@/lib/usage-limits/format";
type Hint = { element: HTMLElement; detail: QuotaDetail };
export function placeQuotaHint(menu: Pick<DOMRect, "left" | "right" | "top" | "bottom">, width: number, height: number, viewport: { width: number; height: number }) {
  const margin = 8, gap = 12;
  if (height > viewport.height - margin * 2) return null;
  const top = Math.max(margin, Math.min(menu.top, viewport.height - height - margin));
  if (menu.left - gap - width >= margin) return { left: menu.left - gap - width, top };
  if (menu.right + gap + width <= viewport.width - margin) return { left: menu.right + gap, top };
  const left = Math.max(margin, Math.min(menu.left, viewport.width - width - margin));
  if (width > viewport.width - margin * 2) return null;
  if (menu.top - gap - height >= margin) return { left, top: menu.top - gap - height };
  if (menu.bottom + gap + height <= viewport.height - margin) return { left, top: menu.bottom + gap };
  return null;
}
export function useQuotaMenuHint(open: boolean, menu: RefObject<HTMLDivElement | null>) {
  const [hint, setHint] = useState<Hint | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pointed = useRef<HTMLElement | null>(null);
  const clear = () => { clearTimeout(timer.current); setHint(null); };
  useEffect(() => {
    if (!open) return;
    window.addEventListener("resize", clear);
    window.addEventListener("scroll", clear, true);
    return () => { clearTimeout(timer.current); window.removeEventListener("resize", clear); window.removeEventListener("scroll", clear, true); };
  }, [open]);
  const schedule = (element: HTMLElement, detail: QuotaDetail, delay: number) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => { if (element.isConnected) setHint({ element, detail }); }, delay);
  };
  return {
    dismiss: clear,
    handlers: (detail: QuotaDetail) => ({
      onPointerEnter: (event: React.PointerEvent<HTMLElement>) => { pointed.current = event.currentTarget; schedule(event.currentTarget, detail, 500); },
      onPointerLeave: () => { pointed.current = null; clear(); },
      onFocus: (event: React.FocusEvent<HTMLElement>) => { if (pointed.current !== event.currentTarget) schedule(event.currentTarget, detail, 650); },
      onBlur: clear,
    }),
    content: open && hint ? <QuotaHint detail={hint.detail} menu={menu} /> : null,
  };
}
/* 六行同号同色的文字里没有重点。这里借用 Settings 里那条额度行的说法——
   标题在左、读数右对齐加重、恢复时刻退到标题下方——出处（查询时间、缓存、时区）
   压到一条细线之下：它们是脚注，不是这个人此刻在找的东西。 */
function QuotaHint({ detail, menu }: { detail: QuotaDetail; menu: RefObject<HTMLDivElement | null> }) {
  const element = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  useEffect(() => {
    if (!element.current || !menu.current) return;
    const bounds = element.current.getBoundingClientRect();
    setPosition(placeQuotaHint(menu.current.getBoundingClientRect(), bounds.width, bounds.height, { width: window.innerWidth, height: window.innerHeight }));
  }, [detail, menu]);
  return createPortal(<div ref={element} aria-hidden="true" data-testid="quota-menu-hint" className="pointer-events-none fixed z-[60] w-68 max-w-[calc(100vw-1rem)] rounded-lg bg-popover p-3 text-popover-foreground shadow-md ring-1 ring-border"
    style={{ ...position, visibility: position ? "visible" : "hidden" }}>
    <p className="font-medium text-xs">{detail.scope}</p>
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
  </div>, document.body);
}
