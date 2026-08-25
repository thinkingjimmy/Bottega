/**
 * [INPUT]: Depends on React, TanStack Virtual, Gallery visual-row model/store type, Thumbnail and Button
 * [OUTPUT]: Provides GalleryListbox; Virtual to real-world visuals, supporting roving focus, pin, scaling, comment control and independent retry
 * [POS]: The execution layer of the large list of bases/views/gallery; Interactive status and business commands held by BaseGalleryView
 */

import {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type RefObject,
} from "react";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import {
  defaultRangeExtractor,
  useVirtualizer,
  type Range,
} from "@tanstack/react-virtual";
import { SlimScroller } from "@ai-chat/ui/components/ui/slim-scroller";
import { cn } from "@ai-chat/ui/lib/utils";
import { Trash2Icon } from "lucide-react";
import { Button } from "@ai-chat/ui/components/ui/button";
import {
  buildGalleryVisualRows,
  galleryPinnedIds,
  resolvePinnedVisualRowIndexes,
  type GalleryGroup,
  type GalleryItem,
} from "@/lib/gallery/model";
import type { GalleryComment } from "@/lib/gallery/store";
import {
  GalleryThumbnail,
  type GalleryThumbnailStatus,
} from "./gallery-thumbnail";

export type GalleryMode = "browse" | "multi" | "comment";

export function GalleryListbox({
  groups,
  items,
  mode,
  zoom,
  activeId,
  focusPins,
  overlayId,
  selectedKeys,
  comments,
  optionRefs,
  contentRefs,
  onActive,
  onExitMode,
  onFocusPins,
  onActivate,
  onPlaceComment,
  onCenterComment,
  onEditComment,
  onDeleteComment,
  onSourceGone,
  onReturnToComposer,
}: {
  groups: GalleryGroup[];
  items: GalleryItem[];
  mode: GalleryMode;
  zoom: number;
  activeId: string;
  focusPins: ReadonlySet<string>;
  overlayId?: string;
  selectedKeys: ReadonlySet<string>;
  comments: ReadonlyMap<string, GalleryComment[]>;
  optionRefs: RefObject<Map<string, HTMLDivElement>>;
  contentRefs: RefObject<Map<string, HTMLImageElement>>;
  onActive(id: string): void;
  onExitMode(): void;
  onFocusPins(ids: ReadonlySet<string>): void;
  onActivate(item: GalleryItem): void;
  onPlaceComment(
    event: MouseEvent<HTMLDivElement>,
    item: Extract<GalleryItem, { phase: "ready" }>
  ): void;
  onCenterComment(item: Extract<GalleryItem, { phase: "ready" }>): void;
  onEditComment(
    item: Extract<GalleryItem, { phase: "ready" }>,
    comment: GalleryComment
  ): void;
  onDeleteComment(item: GalleryItem, id: string): void;
  onSourceGone(item: GalleryItem): void;
  onReturnToComposer?(): void;
}) {
  const { t } = useAppTranslation();
  const scrollRef = useRef<HTMLDivElement>(null);
  const positionedRef = useRef(false);
  const [width, setWidth] = useState(0);
  const tileWidth = Math.round(210 * zoom / 100);
  const columns = Math.max(
    1,
    Math.floor((Math.max(width, tileWidth) - 24 + 12) / (tileWidth + 12))
  );
  const rows = useMemo(
    () => buildGalleryVisualRows(groups, columns),
    [columns, groups]
  );
  const pinnedIds = useMemo(
    () => galleryPinnedIds({ focusIds: focusPins, overlayId }),
    [focusPins, overlayId]
  );
  const pinnedRows = useMemo(
    () => resolvePinnedVisualRowIndexes(rows, pinnedIds),
    [pinnedIds, rows]
  );
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) =>
      rows[index]?.kind === "header"
        ? 44
        : Math.max(220, 280 * (zoom / 100)) + 24,
    getItemKey: (index) => rows[index]?.id ?? index,
    overscan: 3,
    rangeExtractor: (range: Range) => [
      ...new Set([...defaultRangeExtractor(range), ...pinnedRows]),
    ].sort((left, right) => left - right),
  });

  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const update = () => setWidth(element.clientWidth);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    // 等首次真实量宽（width>0）后再定位，避免以 1 列估算的行高锚到错误位置
    if (positionedRef.current || !rows.length || !width) return;
    positionedRef.current = true;
    virtualizer.scrollToIndex(rows.length - 1, { align: "end" });
  }, [rows.length, virtualizer, width]);

  const indexById = useMemo(
    () => new Map(items.map((item, index) => [item.id, index])),
    [items]
  );
  const virtualItems = virtualizer.getVirtualItems();
  const renderedIds = useMemo(
    () =>
      new Set(
        virtualItems.flatMap((virtualRow) => {
          const row = rows[virtualRow.index];
          return row?.kind === "items"
            ? row.items.map((item) => item.id)
            : [];
        })
      ),
    [rows, virtualItems]
  );
  // roving tab stop 兜底：active tile 被虚拟化卸载后，把停靠点交给首个已渲染 tile，
  // 否则整个 listbox 失去 tabIndex=0，Tab 永远进不来
  const tabStopId = renderedIds.has(activeId)
    ? activeId
    : renderedIds.values().next().value ?? "";

  const focusBy = (delta: number) => {
    const index = Math.max(0, items.findIndex((item) => item.id === activeId));
    const next = items[Math.min(items.length - 1, Math.max(0, index + delta))];
    if (!next) return;
    onFocusPins(new Set([activeId, next.id].filter(Boolean)));
    onActive(next.id);
    const rowIndex = rows.findIndex(
      (row) =>
        row.kind === "items" &&
        row.items.some((item) => item.id === next.id)
    );
    if (rowIndex >= 0) virtualizer.scrollToIndex(rowIndex, { align: "auto" });
  };
  const onKeyDown = (
    event: KeyboardEvent<HTMLDivElement>,
    item: GalleryItem
  ) => {
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      event.preventDefault();
      focusBy(1);
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      event.preventDefault();
      focusBy(-1);
    } else if (event.key === " ") {
      event.preventDefault();
      onActivate(item);
    } else if (
      event.key === "Enter" &&
      mode === "comment" &&
      item.phase === "ready"
    ) {
      event.preventDefault();
      onCenterComment(item);
    } else if (
      event.key === "Enter" &&
      (event.metaKey || event.ctrlKey)
    ) {
      event.preventDefault();
      onReturnToComposer?.();
    } else if (event.key === "Escape") {
      // Esc 优先级：editor → placement →（此处）mode；mode 已退净时作显式跳转回输入框
      event.preventDefault();
      if (mode !== "browse") onExitMode();
      else onReturnToComposer?.();
    }
  };

  return (
    // 滚动容器不承担 listbox 语义：尾部哨兵按钮不是 option，必须留在 listbox 元素之外
    <SlimScroller className="min-h-0 flex-1 overflow-y-auto" ref={scrollRef}>
      <div
        aria-label={t("bases.gallery.images")}
        aria-multiselectable={mode === "multi"}
        className="relative w-full"
        role="listbox"
        style={{ height: virtualizer.getTotalSize() }}
      >
        {virtualItems.map((virtualRow) => {
          const row = rows[virtualRow.index]!;
          return (
            <div
              className="absolute top-0 left-0 w-full px-3"
              data-index={virtualRow.index}
              key={row.id}
              ref={virtualizer.measureElement}
              style={{ transform: `translateY(${virtualRow.start}px)` }}
            >
              {row.kind === "header" ? (
                <h3
                  className="pt-4 font-medium text-muted-foreground text-xs"
                  role="presentation"
                >
                  {row.label}
                </h3>
              ) : (
                <div
                  className="grid items-start gap-3 py-3"
                  style={{
                    gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
                  }}
                >
                  {row.items.map((item) => (
                    <GalleryTile
                      active={item.id === activeId}
                      comments={comments.get(item.logicalKey) ?? []}
                      item={item}
                      key={item.id}
                      maxEdge={Math.min(
                        1024,
                        Math.ceil(280 * zoom / 100 * window.devicePixelRatio)
                      )}
                      mode={mode}
                      onActivate={() => onActivate(item)}
                      onComment={(event) =>
                        item.phase === "ready" &&
                        onPlaceComment(event, item)
                      }
                      onContent={(element) => {
                        if (element) contentRefs.current.set(item.id, element);
                        else contentRefs.current.delete(item.id);
                      }}
                      onDeleteComment={(id) => onDeleteComment(item, id)}
                      onEditComment={(comment) =>
                        item.phase === "ready" &&
                        onEditComment(item, comment)
                      }
                      onFocusOption={() => {
                        if (item.id !== activeId) onActive(item.id);
                      }}
                      onKeyDown={(event) => onKeyDown(event, item)}
                      onRef={(element) => {
                        if (element) optionRefs.current.set(item.id, element);
                        else optionRefs.current.delete(item.id);
                      }}
                      onSourceGone={() => onSourceGone(item)}
                      posInSet={(indexById.get(item.id) ?? 0) + 1}
                      selected={selectedKeys.has(item.logicalKey)}
                      setSize={items.length}
                      tabStop={item.id === tabStopId}
                    />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {onReturnToComposer && <div className="flex justify-center p-4">
        <Button
          className="min-h-11"
          onClick={onReturnToComposer}
          type="button"
          variant="outline"
        >
          {t("bases.gallery.backToComposer")}
        </Button>
      </div>}
    </SlimScroller>
  );
}

function GalleryTile({
  item,
  active,
  tabStop,
  selected,
  comments,
  mode,
  maxEdge,
  setSize,
  posInSet,
  onActivate,
  onComment,
  onContent,
  onDeleteComment,
  onEditComment,
  onFocusOption,
  onKeyDown,
  onSourceGone,
  onRef,
}: {
  item: GalleryItem;
  active: boolean;
  tabStop: boolean;
  selected: boolean;
  comments: GalleryComment[];
  mode: GalleryMode;
  maxEdge: number;
  setSize: number;
  posInSet: number;
  onActivate(): void;
  onComment(event: MouseEvent<HTMLDivElement>): void;
  onContent(element: HTMLImageElement | null): void;
  onDeleteComment(id: string): void;
  onEditComment(comment: GalleryComment): void;
  onFocusOption(): void;
  onKeyDown(event: KeyboardEvent<HTMLDivElement>): void;
  onSourceGone(): void;
  onRef(element: HTMLDivElement | null): void;
}) {
  const { t } = useAppTranslation();
  const [retrySignal, setRetrySignal] = useState(0);
  const [status, setStatus] = useState<GalleryThumbnailStatus>("loading");
  const optionRef = useRef<HTMLDivElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const retryable = typeof status === "object" && status.retryable;
  // 焦点返回表：删除后回下一 badge（原序号位），没有则回 tile；等一帧让列表随 store 更新
  const deleteComment = (comment: GalleryComment, index: number) => {
    onDeleteComment(comment.id);
    requestAnimationFrame(() => {
      const badges =
        wrapperRef.current?.querySelectorAll<HTMLButtonElement>(
          "[data-badge-id]"
        ) ?? [];
      (badges[Math.min(index, badges.length - 1)] ?? optionRef.current)?.focus();
    });
  };
  return (
    <div className="relative min-w-0" ref={wrapperRef}>
      <div
        aria-disabled={item.phase === "running"}
        aria-posinset={posInSet}
        aria-selected={selected}
        aria-setsize={setSize}
        className="relative block w-full rounded-xl border bg-card p-1 text-left outline-none ring-primary focus-visible:ring-2 aria-selected:border-primary"
        onClick={(event) => {
          if (mode === "comment") onComment(event);
          else onActivate();
        }}
        onFocus={onFocusOption}
        onKeyDown={onKeyDown}
        ref={(element) => {
          optionRef.current = element;
          onRef(element);
        }}
        role="option"
        tabIndex={tabStop ? 0 : -1}
      >
        {item.phase === "running" ? (
          <div
            className={cn(
              "grid aspect-square place-items-center rounded-lg bg-muted text-muted-foreground text-xs",
              item.failed && "text-destructive"
            )}
          >
            {item.failed
              ? t("bases.gallery.actionFailed")
              : t("bases.gallery.generating")}
          </div>
        ) : (
          <GalleryThumbnail
            maxEdge={maxEdge}
            onContentElement={onContent}
            onSourceGone={onSourceGone}
            onStatus={setStatus}
            retrySignal={retrySignal}
            sourceRef={item.sourceRef}
          />
        )}
        {item.title && (
          <p className="truncate px-2 py-2 text-xs" title={item.title}>
            {item.title}
          </p>
        )}
      </div>
      {retryable && (
        <button
          className="absolute inset-x-4 bottom-4 z-10 min-h-11 rounded-md border bg-background px-3 text-xs"
          onClick={() => {
            setStatus("loading");
            setRetrySignal((value) => value + 1);
            queueMicrotask(() => optionRef.current?.focus());
          }}
          tabIndex={active ? 0 : -1}
          type="button"
        >
          {t("bases.gallery.retry")}
        </button>
      )}
      {/* badge 锚定 image content 框：inset-[5px] 恰好扣除 option 的 border(1px)+p-1(4px)，
          否则百分比坐标随 zoom 产生固定像素漂移 */}
      {comments.length > 0 && (
        <div className="pointer-events-none absolute inset-[5px] z-20">
          {comments.map((comment, index) => (
            <span
              className="absolute -translate-x-1/2 -translate-y-1/2"
              key={comment.id}
              style={{ left: `${comment.x * 100}%`, top: `${comment.y * 100}%` }}
            >
              <button
                aria-label={t("bases.gallery.comment", {
                  index: index + 1,
                  text: comment.text,
                })}
                className="pointer-events-auto grid size-11 place-items-center rounded-full bg-primary font-semibold text-primary-foreground text-xs shadow"
                data-badge-id={comment.id}
                onClick={() => onEditComment(comment)}
                tabIndex={active ? 0 : -1}
                type="button"
              >
                {index + 1}
              </button>
              <button
                aria-label={t("bases.gallery.deleteComment", { index: index + 1 })}
                className="pointer-events-auto absolute -top-5 -right-5 grid size-11 place-items-center rounded-full border bg-background text-destructive"
                onClick={() => deleteComment(comment, index)}
                tabIndex={active ? 0 : -1}
                type="button"
              >
                <Trash2Icon className="size-3.5" />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
