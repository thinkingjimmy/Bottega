"use client";

/**
 * [INPUT]: Depends on React, surface visibility, demand-paged Chat find pages, jumpTo, shortcut matching, and UI controls
 * [OUTPUT]: Provides Cmd/Ctrl-F with one-page-at-a-time lookup, the ledger's exact hits and total, loading/error/retry states, demand navigation that pages past the loaded tail, and focus restoration
 * [POS]: The demand-driven text search controller for chat/transcript; the ledger is the only matcher, the renderer only navigates
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp, X } from "lucide-react";
import type { ChatFindCursor } from "../../../../shared/chats-ipc";
import { Input } from "@ai-chat/ui/components/ui/input";
import { Button } from "@ai-chat/ui/components/ui/button";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import { matchShortcut } from "@/lib/shortcuts";
import { findChatMessages } from "@/lib/chats-client";

export function TranscriptFind({
  chatId,
  jumpTo,
  surfaceVisible,
}: {
  chatId: string;
  jumpTo(id: string): void;
  surfaceVisible: boolean;
}) {
  const { t } = useAppTranslation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [index, setIndex] = useState(0);
  /* 账本给的是「命中」，不是「候选」：这里再筛一遍，只会用另一片语料
     （已加载消息的正文）去覆盖账本的判定，于是计数与导航各说各话。 */
  const [matches, setMatches] = useState<string[]>([]);
  const [nativeCursor, setNativeCursor] = useState<ChatFindCursor | null>(null);
  /* 总数由账本给出：已加载的语料只是它的前缀，用前缀数数会一直少报。 */
  const [nativeTotal, setNativeTotal] = useState<number | null>(null);
  const [nativeStatus, setNativeStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [nativeRetry, setNativeRetry] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const nativeGeneration = useRef(0);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(query), 120);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    const generation = ++nativeGeneration.current;
    const value = debounced.trim();
    if (!open || !value) {
      queueMicrotask(() => {
        if (generation !== nativeGeneration.current) return;
        setMatches([]);
        setNativeCursor(null);
        setNativeTotal(null);
        setNativeStatus("idle");
      });
      return;
    }
    const controller = new AbortController();
    queueMicrotask(() => {
      if (generation === nativeGeneration.current) setNativeStatus("loading");
    });
    void (async () => {
      if (controller.signal.aborted) throw controller.signal.reason;
      const page = await findChatMessages({ chatId, query: value, limit: 100 });
      if (generation !== nativeGeneration.current) return;
      setMatches((page?.items ?? []).map((item) => item.messageId));
      setNativeCursor(page?.nextCursor ?? null);
      setNativeTotal(page?.total ?? null);
      setNativeStatus("ready");
    })().catch((cause) => {
      if (generation !== nativeGeneration.current || controller.signal.aborted) return;
      setNativeStatus("error");
      console.error(cause);
    });
    return () => controller.abort();
  }, [chatId, debounced, nativeRetry, open]);

  const loadNextNative = useCallback(async () => {
    if (!nativeCursor || nativeStatus === "loading") return false;
    const generation = nativeGeneration.current;
    setNativeStatus("loading");
    try {
      const page = await findChatMessages({
        chatId,
        query: debounced.trim(),
        cursor: nativeCursor,
        limit: 100,
      });
      if (generation !== nativeGeneration.current) return false;
      setMatches((current) => {
        const merged = new Set(current);
        for (const item of page?.items ?? []) merged.add(item.messageId);
        return [...merged];
      });
      setNativeCursor(page?.nextCursor ?? null);
      setNativeTotal(page?.total ?? null);
      setNativeStatus("ready");
      return Boolean(page?.items.length);
    } catch (cause) {
      if (generation === nativeGeneration.current) setNativeStatus("error");
      console.error(cause);
      return false;
    }
  }, [chatId, debounced, nativeCursor, nativeStatus]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      /* 组合键定义收进中央真值表（findInChat，可改绑/可停用）；
         监听器与 surfaceVisible 门控留在本地——作用域是这里的事。 */
      if (!matchShortcut(event, "findInChat")) return;
      if (!surfaceVisible) return;
      event.preventDefault();
      if (!open) {
        previousFocus.current = document.activeElement instanceof HTMLElement
          && document.activeElement !== document.body
          ? document.activeElement
          : null;
      }
      setOpen(true);
      queueMicrotask(() => input.current?.focus());
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, surfaceVisible]);

  /* index 是全量里的逻辑位置，不是已加载数组的下标：越过已加载的尾巴
     就按需再取一页，取不到才停在那里。 */
  const total = nativeTotal ?? matches.length;
  const position = total ? ((index % total) + total) % total : 0;
  const target = matches[position];
  useEffect(() => {
    if (!open) return;
    if (target) { jumpTo(target); return; }
    if (position >= matches.length && nativeCursor && nativeStatus !== "loading") {
      void loadNextNative();
    }
  }, [
    jumpTo, loadNextNative, matches.length, nativeCursor, nativeStatus,
    open, position, target,
  ]);

  if (!open) return null;
  const move = (delta: number) => {
    if (!total) return;
    setIndex((position + delta + total) % total);
  };
  const close = () => {
    const transcript = root.current?.closest<HTMLElement>("[data-transcript-content]") ?? null;
    const target = previousFocus.current?.isConnected
      ? previousFocus.current
      : transcript;
    setOpen(false);
    setQuery("");
    previousFocus.current = null;
    queueMicrotask(() => target?.focus({ preventScroll: true }));
  };
  return (
    <div
      className="sticky top-0 z-20 flex items-center gap-1 rounded-lg border bg-background/95 p-2 shadow-sm backdrop-blur"
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        close();
      }}
      ref={root}
    >
      <Input
        ref={input}
        aria-label={t("history.findPlaceholder")}
        className="h-8"
        onChange={(event) => {
          setQuery(event.target.value);
          setIndex(0);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") { event.preventDefault(); move(event.shiftKey ? -1 : 1); }
        }}
        placeholder={t("history.findPlaceholder")}
        value={query}
      />
      <span className="min-w-16 text-center text-muted-foreground text-xs tabular-nums">
        {nativeStatus === "error"
          ? t("history.findFailed")
          : nativeStatus === "loading" && nativeTotal === null
            ? t("history.findLoading")
            : total
              ? t("history.findCount", { current: position + 1, total })
              : t("history.findNoMatches")}
      </span>
      {nativeStatus === "error" && (
        <Button
          onClick={() => setNativeRetry((value) => value + 1)}
          size="sm"
          type="button"
          variant="ghost"
        >
          {t("history.findRetry")}
        </Button>
      )}
      <Button aria-label={t("history.findPrevious")} onClick={() => move(-1)} size="icon-sm" variant="ghost"><ChevronUp /></Button>
      <Button aria-label={t("history.findNext")} onClick={() => move(1)} size="icon-sm" variant="ghost"><ChevronDown /></Button>
      <Button aria-label={t("history.findClose")} onClick={close} size="icon-sm" variant="ghost"><X /></Button>
    </div>
  );
}
