/**
 * [INPUT]: Depends on conversation scrolling context, the paged canonical Chat outline client, localized outline copy, pure outline projection, and loaded timeline messages
 * [OUTPUT]: Provides a stale-retrying, tail-first self-paging canonical outline window bounded to the newest OUTLINE_WINDOW_LIMIT entries and a localized roving minimap whose entries stay in transcript order and jump through transcript anchors
 * [POS]: The session navigation layer of chat/transcript
 */

import {
  createContext,
  memo,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
} from "react";
import { FileTextIcon } from "lucide-react";
import { useStickToBottomContext } from "@ai-chat/ui/components/ai-elements/conversation";
import { cn } from "@ai-chat/ui/lib/utils";
import type {
  ChatMessage,
  ChatOutlineCursor,
  ChatOutlineItem,
} from "../../../../shared/chats-ipc";
import {
  activeOutlineIndex,
  outlineMinimapEntries,
} from "@/lib/chat-outline";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import { getChatOutlinePage } from "@/lib/chats-client";

const anchorSelector = (id: string) => `[data-message-id="${CSS.escape(id)}"]`;

const LENS_WIDTHS = ["w-5", "w-4", "w-3", "w-2.5"];
const BASE_WIDTH = "w-2";
const OUTLINE_WINDOW_LIMIT = 400;
const OUTLINE_PAGE_LIMIT = 200;

type DotRuntime = {
  onHover(id: string, top: number): void;
  onLeave(id: string): void;
  onJump(id: string): void;
  onRove(id: string): void;
};

const DotContext = createContext<DotRuntime | null>(null);

export const OutlineDot = memo(function OutlineDot({
  id,
  label,
  widthBucket,
  isActive,
  isRoving,
}: {
  id: string;
  label: string;
  widthBucket: number;
  isActive: boolean;
  isRoving: boolean;
}) {
  const runtime = useContext(DotContext)!;
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const buttons = [
      ...(event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>(
        "[data-outline-id]"
      ) ?? []),
    ];
    const current = Math.max(0, buttons.indexOf(event.currentTarget));
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? buttons.length - 1
          : event.key === "ArrowUp"
            ? Math.max(0, current - 1)
            : event.key === "ArrowDown"
              ? Math.min(buttons.length - 1, current + 1)
              : -1;
    if (next < 0 || next === current) return;
    event.preventDefault();
    const target = buttons[next];
    const nextId = target?.dataset.outlineId;
    if (!target || !nextId) return;
    runtime.onRove(nextId);
    event.currentTarget.tabIndex = -1;
    target.tabIndex = 0;
    target.focus();
  };
  return (
    <button
      aria-current={isActive ? "location" : undefined}
      aria-label={label}
      className="flex h-3 w-5 min-h-0 shrink cursor-pointer items-center"
      data-outline-id={id}
      onBlur={() => runtime.onLeave(id)}
      onClick={() => runtime.onJump(id)}
      onFocus={(event) => {
        runtime.onRove(id);
        runtime.onHover(id, event.currentTarget.offsetTop + 6);
      }}
      onKeyDown={onKeyDown}
      onMouseEnter={(event: MouseEvent<HTMLButtonElement>) =>
        runtime.onHover(id, event.currentTarget.offsetTop + 6)
      }
      onMouseLeave={() => runtime.onLeave(id)}
      tabIndex={isRoving ? 0 : -1}
      type="button"
    >
      <span
        className={cn(
          "h-0.5 rounded-full bg-border transition-[width,background-color]",
          LENS_WIDTHS[widthBucket] ?? BASE_WIDTH,
          isActive && "h-1 bg-foreground"
        )}
        data-outline-distance={widthBucket}
      />
    </button>
  );
});

type Measurements = {
  tops: number[];
  indexes: number[];
  clientHeight: number;
  scrollHeight: number;
};

const EMPTY_MEASUREMENTS: Measurements = {
  tops: [],
  indexes: [],
  clientHeight: 0,
  scrollHeight: 0,
};

export function useCanonicalChatOutline(
  chatId: string,
  incarnationId: string | null,
  enabled: boolean
) {
  const [items, setItems] = useState<ChatOutlineItem[]>([]);
  const [loading, setLoading] = useState(false);
  const generation = useRef(0);
  /* 大纲不该向用户要一次点击才肯继续，也不该为了拿到尾巴先把整条 Chat 读
     穿：服务端从最新一条往回翻，这里凑满 OUTLINE_WINDOW_LIMIT 就收手——
     最多 ceil(WINDOW / PAGE) 次往返，与 Chat 有多长无关。 */
  const load = useCallback(async (retryStale: boolean) => {
    const requestGeneration = generation.current;
    setLoading(true);
    try {
      let requestedCursor: ChatOutlineCursor | undefined;
      let canRetryStale = retryStale;
      let collected: ChatOutlineItem[] = [];
      for (;;) {
        try {
          const page = await getChatOutlinePage({
            chatId,
            ...(requestedCursor ? { cursor: requestedCursor } : {}),
            limit: OUTLINE_PAGE_LIMIT,
          });
          if (requestGeneration !== generation.current) return;
          if (!page) return;
          collected = [...page.items, ...collected].slice(-OUTLINE_WINDOW_LIMIT);
          setItems(collected);
          if (!page.nextCursor || collected.length >= OUTLINE_WINDOW_LIMIT) return;
          requestedCursor = page.nextCursor;
        } catch (cause) {
          const stale =
            cause instanceof Error &&
            /CHAT_(?:OUTLINE|TIMELINE)_STALE/.test(cause.message);
          if (!canRetryStale || !stale) return;
          canRetryStale = false;
          requestedCursor = undefined;
          collected = [];
          if (requestGeneration !== generation.current) return;
          setItems([]);
        }
      }
    } finally {
      if (requestGeneration === generation.current) setLoading(false);
    }
  }, [chatId]);
  useEffect(() => {
    generation.current += 1;
    if (!enabled) {
      let cancelled = false;
      queueMicrotask(() => {
        if (!cancelled) setItems([]);
      });
      return () => {
        cancelled = true;
        generation.current += 1;
      };
    }
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setItems([]);
      void load(true);
    });
    return () => {
      cancelled = true;
      generation.current += 1;
    };
  }, [chatId, incarnationId, enabled, load]);
  return { items, loading };
}

export const ChatOutline = memo(function ChatOutline({
  messages,
  canonicalItems,
  onJump,
}: {
  messages: ChatMessage[];
  canonicalItems?: readonly ChatOutlineItem[];
  onJump?: (id: string) => void;
}) {
  const { t } = useAppTranslation();
  const entries = useMemo(
    () => outlineMinimapEntries(messages, canonicalItems ?? []),
    [canonicalItems, messages]
  );
  const { scrollRef } = useStickToBottomContext();
  const [active, setActive] = useState(-1);
  const [preview, setPreview] = useState<{ id: string; top: number } | null>(
    null
  );
  const measurements = useRef(EMPTY_MEASUREMENTS);
  const located = useRef(false);
  const [rovingId, setRovingId] = useState("");
  const entryById = useMemo(
    () => new Map(entries.map((entry) => [entry.id, entry])),
    [entries]
  );
  const effectiveRovingId = entryById.has(rovingId)
    ? rovingId
    : (entries[0]?.id ?? "");

  const updateActive = useCallback((scrollTop: number) => {
    const current = measurements.current;
    const measured = activeOutlineIndex(
      current.tops,
      scrollTop,
      current.clientHeight,
      current.scrollHeight
    );
    setActive(measured < 0 ? -1 : (current.indexes[measured] ?? -1));
  }, []);

  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller || entries.length < 2) return;
    let frame = 0;
    const measure = () => {
      const scrollerTop = scroller.getBoundingClientRect().top;
      const pairs = entries.flatMap((entry, index) => {
        const anchor = scroller.querySelector(anchorSelector(entry.id));
        return anchor instanceof HTMLElement
          ? [{
              index,
              top:
                anchor.getBoundingClientRect().top -
                scrollerTop +
                scroller.scrollTop,
            }]
          : [];
      });
      measurements.current = {
        tops: pairs.map((pair) => pair.top),
        indexes: pairs.map((pair) => pair.index),
        clientHeight: scroller.clientHeight,
        scrollHeight: scroller.scrollHeight,
      };
      if (located.current) updateActive(scroller.scrollTop);
    };
    const scheduleMeasure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    const onScroll = () => {
      located.current = true;
      updateActive(scroller.scrollTop);
    };
    const content = scroller.querySelector("[data-transcript-content]");
    const observer =
      typeof ResizeObserver !== "undefined" && content
        ? new ResizeObserver(scheduleMeasure)
        : undefined;
    if (content) observer?.observe(content);
    scheduleMeasure();
    scroller.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
      scroller.removeEventListener("scroll", onScroll);
      measurements.current = EMPTY_MEASUREMENTS;
      located.current = false;
    };
  }, [entries, scrollRef, updateActive]);

  const handleHover = useCallback((id: string, top: number) => {
    setPreview((current) =>
      current?.id === id && current.top === top ? current : { id, top }
    );
  }, []);
  const handleLeave = useCallback((id: string) => {
    setPreview((current) => (current?.id === id ? null : current));
  }, []);
  const jump = useCallback((id: string) => {
    if (onJump) {
      onJump(id);
      return;
    }
    const scroller = scrollRef.current;
    const anchor = scroller?.querySelector(anchorSelector(id));
    if (!scroller || !(anchor instanceof HTMLElement)) return;
    const top =
      anchor.getBoundingClientRect().top -
      scroller.getBoundingClientRect().top +
      scroller.scrollTop;
    scroller.scrollTo({ top: Math.max(0, top - 16), behavior: "smooth" });
  }, [onJump, scrollRef]);
  const runtime = useMemo<DotRuntime>(
    () => ({
      onHover: handleHover,
      onLeave: handleLeave,
      onJump: jump,
      onRove: setRovingId,
    }),
    [handleHover, handleLeave, jump]
  );

  if (entries.length < 2) return null;
  const hoveredIndex = preview
    ? entries.findIndex((entry) => entry.id === preview.id)
    : -1;
  const center = hoveredIndex < 0 ? active : hoveredIndex;
  const previewEntry = preview
    ? entryById.get(preview.id)
    : undefined;

  return (
    <DotContext.Provider value={runtime}>
      <nav
        aria-label={t("chat.transcript.outlineLabel")}
        className="-translate-y-1/2 absolute top-1/2 left-2 z-10 flex max-h-[70%] flex-col justify-center"
        onMouseLeave={() => setPreview(null)}
      >
        {entries.map((entry, index) => {
          const distance =
            center < 0 ? LENS_WIDTHS.length : Math.abs(index - center);
          const widthBucket = Math.min(distance, LENS_WIDTHS.length);
          return (
            <OutlineDot
              id={entry.id}
              isActive={distance === 0}
              isRoving={effectiveRovingId === entry.id}
              key={entry.id}
              label={entry.text.split("\n")[0]}
              widthBucket={widthBucket}
            />
          );
        })}
        {previewEntry && preview && (
          <div
            className="absolute left-full ml-3 w-80 -translate-y-1/2 rounded-md border bg-popover p-4 text-popover-foreground shadow-md"
            role="tooltip"
            style={{ top: preview.top }}
          >
            <p className="line-clamp-2 font-semibold text-sm">
              {previewEntry.text}
            </p>
            {previewEntry.replyExcerpt && (
              <p className="mt-1.5 line-clamp-2 text-muted-foreground text-sm">
                {previewEntry.replyExcerpt}
              </p>
            )}
            {previewEntry.attachments.length > 0 && (
              <div className="mt-2.5 flex items-center gap-2 text-muted-foreground text-sm">
                {previewEntry.attachments.slice(0, 2).map((filename) => (
                  <span className="flex min-w-0 items-center gap-1" key={filename}>
                    <FileTextIcon className="size-3.5 shrink-0" />
                    <span className="truncate">{filename}</span>
                  </span>
                ))}
                {previewEntry.attachments.length > 2 && (
                  <span className="shrink-0">
                    +{previewEntry.attachments.length - 2}
                  </span>
                )}
              </div>
            )}
          </div>
        )}
      </nav>
    </DotContext.Provider>
  );
});
