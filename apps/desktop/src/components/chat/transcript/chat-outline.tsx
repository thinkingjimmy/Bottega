/**
 * [INPUT]: Portable user/reply summaries, canonical outline entries and the shared Conversation scroll context.
 * [OUTPUT]: Shared transcript minimap with roving keyboard focus, previews and native scroll behavior.
 * [POS]: Transport-independent outline presentation; host adapters own canonical outline paging.
 */
import { useCallback, useEffect, useRef, useState, type ComponentProps } from "react";
import { ChatOutline as SharedOutline } from "@ai-chat/chat-ui/timeline/outline";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import { localChatReads } from "@/lib/cloud/chat/platform/local";
const getChatOutlinePage = localChatReads.transcript.outline;
import type { ChatOutlineCursor, ChatOutlineItem } from "../../../../shared/chats-ipc";
export { OutlineDot } from "@ai-chat/chat-ui/timeline/outline";
const OUTLINE_WINDOW_LIMIT = 400, OUTLINE_PAGE_LIMIT = 200;
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

export function ChatOutline(props: Omit<ComponentProps<typeof SharedOutline>, "label">) {
  const { t } = useAppTranslation();
  return <SharedOutline {...props} label={t("chat.transcript.outlineLabel")} />;
}
