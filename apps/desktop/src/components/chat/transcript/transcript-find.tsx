"use client";

/**
 * [INPUT]: Depends on React, visible surface visibility, shared search-text/foreign grouping, full Chat messages/History prefix, unified jumpTo, lib/shortcuts' matchShortcut(findInChat) and ui Input/Button
 * [OUTPUT]: Provides TranscriptFind; Only visible chat surface: Intercept the central findInChat shortcut (rebindable, default Cmd/Ctrl-F), complete data matching, loop navigation, complete toolbar Esc, and prioritize returning the focus to the previous focus
 * [POS]: The full text search bar on the data side of chat/transcript; The positioning is given to the only jumpTo without relying on the current progressive rendering window
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronUp, X } from "lucide-react";
import type { ChatMessage } from "../../../../shared/chats-ipc";
import type { HistoryAdoptionPrefix } from "../../../../shared/history-import-ipc";
import {
  foreignHistoryAnchor,
  groupForeignHistoryBlocks,
} from "../../../../shared/foreign-history-grouping";
import {
  matchSearchTokens,
  normalizeSearchText,
  tokenizeSearchQuery,
} from "../../../../shared/search-text";
import { Input } from "@ai-chat/ui/components/ui/input";
import { Button } from "@ai-chat/ui/components/ui/button";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import { matchShortcut } from "@/lib/shortcuts";

export function TranscriptFind({
  messages,
  historyPrefix,
  jumpTo,
  surfaceVisible,
}: {
  messages: ChatMessage[];
  historyPrefix?: HistoryAdoptionPrefix | null;
  jumpTo(id: string): void;
  surfaceVisible: boolean;
}) {
  const { t } = useAppTranslation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [index, setIndex] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(query), 120);
    return () => window.clearTimeout(timer);
  }, [query]);

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

  const corpus = useMemo(() => {
    const prefix = historyPrefix
      ? groupForeignHistoryBlocks(historyPrefix.blocks).map((row) => ({
          id: foreignHistoryAnchor(row.key),
          text: row.kind === "user"
            ? row.block.content
            : row.messages.map((message) => message.content).join("\n"),
        }))
      : [];
    return [
      ...prefix,
      ...messages
        .filter((message) => message.role !== "notice")
        .map((message) => ({ id: message.id, text: message.content })),
    ];
  }, [historyPrefix, messages]);

  const matches = useMemo(() => {
    if (!debounced.trim()) return [];
    let tokens: string[];
    try { tokens = tokenizeSearchQuery(debounced); } catch { return []; }
    return corpus.filter((item) =>
      matchSearchTokens(normalizeSearchText(item.text), tokens) !== null
    );
  }, [corpus, debounced]);

  const activeIndex = matches.length ? Math.min(index, matches.length - 1) : 0;
  useEffect(() => {
    const target = matches[activeIndex];
    if (open && target) jumpTo(target.id);
  }, [activeIndex, jumpTo, matches, open]);

  if (!open) return null;
  const move = (delta: number) => {
    if (!matches.length) return;
    setIndex((activeIndex + delta + matches.length) % matches.length);
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
        {matches.length
          ? t("history.findCount", { current: activeIndex + 1, total: matches.length })
          : t("history.findNoMatches")}
      </span>
      <Button aria-label={t("history.findPrevious")} onClick={() => move(-1)} size="icon-sm" variant="ghost"><ChevronUp /></Button>
      <Button aria-label={t("history.findNext")} onClick={() => move(1)} size="icon-sm" variant="ghost"><ChevronDown /></Button>
      <Button aria-label={t("history.findClose")} onClick={close} size="icon-sm" variant="ghost"><X /></Button>
    </div>
  );
}
