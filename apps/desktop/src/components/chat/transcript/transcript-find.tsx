"use client";

/**
 * [INPUT]: Depends on React, surface visibility, demand-paged Chat find pages, jumpTo, shortcut matching, and UI controls
 * [OUTPUT]: Provides Cmd/Ctrl-F with one-page-at-a-time lookup, the ledger's exact hits and total, loading/error/retry states, demand navigation that pages past the loaded tail, explicit retry after failure, stale-response rejection, and focus restoration
 * [POS]: The demand-driven text search controller for chat/transcript; the ledger is the only matcher, the renderer only navigates
 */

import { useEffect, useRef, useState } from "react";
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
  const [result, setResult] = useState<{
    key: string;
    matches: string[];
    cursor: ChatFindCursor | null;
    total: number | null;
    failed: boolean;
  } | null>(null);
  const [nativeRetry, setNativeRetry] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const value = debounced.trim();
  const searchKey = JSON.stringify([chatId, value, nativeRetry]);
  const current = result?.key === searchKey ? result : null;
  const matches = current?.matches ?? [];
  const nativeTotal = current?.total ?? null;
  const total = nativeTotal ?? matches.length;
  const position = total ? ((index % total) + total) % total : 0;
  const target = matches[position];
  const cursor = position >= matches.length ? current?.cursor ?? null : null;
  const needsPage = Boolean(open && value && !current?.failed && (!current || cursor));
  const nativeStatus = current?.failed ? "error" : needsPage ? "loading" : "ready";

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(query), 120);
    return () => window.clearTimeout(timer);
  }, [query]);

  /* 请求由查询身份和导航位置派生；失败停在当前页，只有显式重试才再次请求。 */
  useEffect(() => {
    if (!needsPage) return;
    let live = true;
    void findChatMessages({ chatId, query: value, limit: 100, ...(cursor ? { cursor } : {}) })
      .then((page) => {
        if (!live) return;
        setResult((previous) => ({
          key: searchKey,
          matches: [...new Set([
            ...(cursor && previous?.key === searchKey ? previous.matches : []),
            ...(page?.items ?? []).map((item) => item.messageId),
          ])],
          cursor: page?.nextCursor ?? null,
          total: page?.total ?? null,
          failed: false,
        }));
      })
      .catch((cause) => {
        if (!live) return;
        setResult((previous) => ({
          key: searchKey,
          matches: previous?.key === searchKey ? previous.matches : [],
          cursor,
          total: previous?.key === searchKey ? previous.total : null,
          failed: true,
        }));
        console.error(cause);
      });
    return () => { live = false; };
  }, [chatId, cursor, needsPage, searchKey, value]);

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

  useEffect(() => {
    if (open && target) jumpTo(target);
  }, [jumpTo, open, target]);

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
