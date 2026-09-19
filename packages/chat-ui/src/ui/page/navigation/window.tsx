/**
 * [INPUT]: Depends on React, TanStack Virtual and host-rendered metadata rows with stable IDs.
 * [OUTPUT]: Provides NavigationWindow: a bounded virtual metadata window, or an unbounded flowing list on phones, with keyboard row navigation.
 * [POS]: The Chat page's bounded metadata window under navigation/; hosts own links, paging and all business capabilities.
 */
import { useRef, useState, type CSSProperties, type Key, type ReactNode } from "react";
import { defaultRangeExtractor, useVirtualizer } from "@tanstack/react-virtual";
export function NavigationWindow<T>({ items, identity, render, label, compact = false, rowHeight = 76, maxHeight, unbounded = false }: {
  items: readonly T[]; identity(item: T): string; render(item: T): ReactNode; label: string; compact?: boolean; rowHeight?: number; maxHeight?: number; unbounded?: boolean;
}) {
  const viewport = useRef<HTMLDivElement>(null), [focused, setFocused] = useState<number | null>(null);
  const height = rowHeight;
  // Virtual measurements remain mutable and must not be frozen by compiler memoization.
  // eslint-disable-next-line react-hooks/incompatible-library
  const list = useVirtualizer({ count: items.length, getScrollElement: () => viewport.current, getItemKey: index => identity(items[index]!),
    estimateSize: () => height, overscan: 3, enabled: !unbounded, rangeExtractor: range => {
      const indices = defaultRangeExtractor(range);
      if (focused !== null && focused < items.length && !indices.includes(focused)) indices.push(focused);
      return indices.sort((left, right) => left - right);
    } });
  const row = (index: number, key: Key, style?: CSSProperties) =>
    <div key={key} role="listitem" data-catalog-index={index} aria-posinset={index + 1} aria-setsize={items.length} onFocus={() => setFocused(index)} style={style}>
      {render(items[index]!)}
    </div>;
  return <div ref={viewport} role="list" aria-label={label} tabIndex={0} className="chat-navigation-window" data-unbounded={unbounded || undefined}
    style={unbounded ? undefined : { height: Math.min(items.length * height, maxHeight ?? (compact ? 380 : 532)), overflowY: "auto", position: "relative", overscrollBehavior: "contain" }}
    onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(null); }}
    onKeyDown={event => {
      if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key) || !items.length) return;
      const current = Number((event.target as HTMLElement).closest<HTMLElement>("[data-catalog-index]")?.dataset.catalogIndex ?? -1);
      const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : Math.max(0, Math.min(items.length - 1, current + (event.key === "ArrowDown" ? 1 : -1)));
      event.preventDefault(); setFocused(next);
      if (unbounded) viewport.current?.querySelector<HTMLElement>(`[data-catalog-index="${next}"]`)?.scrollIntoView?.({ block: "nearest" });
      else list.scrollToIndex(next, { align: "auto" });
      requestAnimationFrame(() => viewport.current?.querySelector<HTMLElement>(`[data-catalog-index="${next}"] a, [data-catalog-index="${next}"] button`)?.focus());
    }}>
    {unbounded ? items.map((item, index) => row(index, identity(item), { height })) :
      <div style={{ height: list.getTotalSize(), position: "relative" }}>{list.getVirtualItems().map(virtual =>
        row(virtual.index, virtual.key, { position: "absolute", top: 0, left: 0, width: "100%", height: virtual.size, transform: `translateY(${virtual.start}px)` }))}
      </div>}
  </div>;
}
