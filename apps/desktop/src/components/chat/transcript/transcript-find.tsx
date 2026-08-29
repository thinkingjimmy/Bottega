"use client";

/**
 * [INPUT]: Depends on React, surface visibility, generation-scoped canonical grouping, product messages, abortable HistoryPrefixProjection full-index loader, jumpTo, shortcut matching, and UI controls
 * [OUTPUT]: Provides Cmd/Ctrl-F with truly abortable single-flight imported indexing, loading/error/retry states, complete-domain matching, loop navigation, and focus restoration
 * [POS]: The full-data text search controller for chat/transcript
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronUp, X } from "lucide-react";
import type { ChatMessage } from "../../../../shared/chats-ipc";
import type { HistoryPrefixProjection } from "@/lib/history-prefix";
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
  historyIndexLoader,
}: {
  messages: ChatMessage[];
  historyPrefix?: HistoryPrefixProjection | null;
  jumpTo(id: string): void;
  surfaceVisible: boolean;
  historyIndexLoader?: (signal: AbortSignal) => Promise<HistoryPrefixProjection>;
}) {
  const { t } = useAppTranslation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [index, setIndex] = useState(0);
  const [fullPrefix, setFullPrefix] = useState<HistoryPrefixProjection | null>(null);
  const [indexStatus, setIndexStatus] = useState<"idle" | "loading" | "ready" | "error">(
    historyIndexLoader ? "idle" : "ready"
  );
  const input = useRef<HTMLInputElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const indexGeneration = useRef(0);
  const indexAbort = useRef<AbortController | null>(null);

  const loadIndex = useCallback(() => {
    if (!historyIndexLoader || indexStatus === "loading") return;
    const generation = ++indexGeneration.current;
    indexAbort.current?.abort();
    const controller = new AbortController();
    indexAbort.current = controller;
    setIndexStatus("loading");
    void historyIndexLoader(controller.signal)
      .then((prefix) => {
        if (generation !== indexGeneration.current) return;
        setFullPrefix(prefix);
        setIndexStatus("ready");
      })
      .catch((cause) => {
        if (generation !== indexGeneration.current) return;
        setIndexStatus(controller.signal.aborted ? "idle" : "error");
        if (!controller.signal.aborted) console.error(cause);
      })
      .finally(() => {
        if (indexAbort.current === controller) indexAbort.current = null;
      });
  }, [historyIndexLoader, indexStatus]);

  useEffect(() => {
    if (!open || indexStatus !== "idle") return;
    queueMicrotask(loadIndex);
  }, [indexStatus, loadIndex, open]);

  useEffect(() => () => {
    indexGeneration.current += 1;
    indexAbort.current?.abort();
  }, []);

  const contentGenerationKey = historyPrefix?.source.contentGenerationKey;
  useEffect(() => {
    const generation = ++indexGeneration.current;
    indexAbort.current?.abort();
    indexAbort.current = null;
    queueMicrotask(() => {
      if (generation !== indexGeneration.current) return;
      setFullPrefix(null);
      setIndexStatus(historyIndexLoader ? "idle" : "ready");
    });
  }, [contentGenerationKey, historyIndexLoader]);

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
    const prefixValue =
      fullPrefix?.source.contentGenerationKey === contentGenerationKey
        ? fullPrefix
        : historyPrefix;
    const prefix = prefixValue
      ? groupForeignHistoryBlocks(prefixValue.blocks).map((row) => ({
          id: foreignHistoryAnchor(
            prefixValue.source.contentGenerationKey,
            row.key
          ),
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
  }, [contentGenerationKey, fullPrefix, historyPrefix, messages]);

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
    if (indexStatus === "loading") {
      indexGeneration.current += 1;
      indexAbort.current?.abort();
      indexAbort.current = null;
      setIndexStatus("idle");
    }
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
        {indexStatus === "loading"
          ? t("history.findLoading")
          : indexStatus === "error"
            ? t("history.findFailed")
            : matches.length
          ? t("history.findCount", { current: activeIndex + 1, total: matches.length })
          : t("history.findNoMatches")}
      </span>
      {indexStatus === "error" && (
        <Button onClick={loadIndex} size="sm" type="button" variant="ghost">
          {t("history.findRetry")}
        </Button>
      )}
      <Button aria-label={t("history.findPrevious")} onClick={() => move(-1)} size="icon-sm" variant="ghost"><ChevronUp /></Button>
      <Button aria-label={t("history.findNext")} onClick={() => move(1)} size="icon-sm" variant="ghost"><ChevronDown /></Button>
      <Button aria-label={t("history.findClose")} onClick={close} size="icon-sm" variant="ghost"><X /></Button>
    </div>
  );
}
