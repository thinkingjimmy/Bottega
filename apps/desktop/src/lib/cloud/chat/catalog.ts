/**
 * [INPUT]: Depends on scoped readonly Chat sources and React disposal boundaries.
 * [OUTPUT]: Provides portable catalog, current head and confirmed-deletion hooks with stale-account and incomplete-load fences.
 * [POS]: Mirror navigation state; never inserts a fabricated executable ChatRecord into native providers.
 */
import { useEffect, useState } from "react";
import type { CloudChatHead } from "@ai-chat/cloud-protocol/chats/model";
import type { ChatCatalogFacts } from "@ai-chat/chat-ui/model";
import { useDesktopChatSources } from "./sources";
export function useCloudChatHead(chatId: string | undefined) {
  const sources = useDesktopChatSources(), [value, setValue] = useState<{ sources: typeof sources; chatId: string; head: CloudChatHead | null; residence?: "native" | "mirror" | null; deleted: boolean; error: boolean } | null>(null);
  useEffect(() => {
    if (!sources || !chatId) return;
    const controller = new AbortController(); let revision = 0;
    /* Every local change re-reads; most of them say nothing new about this Chat. Publishing an equal
       value would re-render the whole route for nothing, so unchanged reads keep the current state. */
    const same = (previous: typeof value, next: { head: CloudChatHead | null; residence?: "native" | "mirror" | null; deleted: boolean }) =>
      previous !== null && previous.sources === sources && previous.chatId === chatId && !previous.error &&
      previous.residence === next.residence && previous.deleted === next.deleted && JSON.stringify(previous.head) === JSON.stringify(next.head);
    const refresh = () => { const expected = ++revision;
      void Promise.all([sources.chats.head(chatId, controller.signal), sources.executor.read(chatId)]).then(([head, execution]) => {
        if (controller.signal.aborted || revision !== expected) return;
        const next = { head, residence: execution.residence, deleted: execution.reason === "deleted" };
        setValue(previous => same(previous, next) ? previous : { sources, chatId, ...next, error: false }); })
        .catch(() => { if (!controller.signal.aborted && revision === expected) setValue({ sources, chatId, head: null, deleted: false, error: true }); }); };
    const stop = sources.chats.subscribe(refresh, refresh); refresh(); return () => { controller.abort(); stop(); };
  }, [sources, chatId]);
  return { sources, head: value?.sources === sources && value.chatId === chatId ? value.head : undefined,
    residence: value?.sources === sources && value.chatId === chatId ? value.residence : undefined,
    deleted: value?.sources === sources && value.chatId === chatId && value.deleted,
    error: value?.sources === sources && value.chatId === chatId && value.error };
}
export function useCloudChatCatalog() {
  const sources = useDesktopChatSources(), [value, setValue] = useState<{ sources: typeof sources; heads: CloudChatHead[]; facts: ChatCatalogFacts[]; error: boolean } | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!sources) return;
    let controller = new AbortController();
    const refresh = () => { controller.abort(); controller = new AbortController(); const request = controller;
      void (async () => {
        const heads: CloudChatHead[] = [], facts: ChatCatalogFacts[] = []; let afterRevision = 0, throughRevision: number | null = null;
        for (;;) {
          const page = await sources.chats.page({ afterRevision, throughRevision }, request.signal);
          heads.push(...page.items); facts.push(...page.facts ?? []); if (heads.length > 10000) throw new Error("CHAT_CATALOG_LIMIT");
          if (page.complete) break;
          if (page.cursor === null || page.cursor <= afterRevision) throw new Error("CHAT_CATALOG_CURSOR");
          afterRevision = page.cursor; throughRevision = page.revision;
        }
        if (!request.signal.aborted) setValue({ sources, heads, facts, error: false });
      })().catch(() => { if (!request.signal.aborted) setValue(previous => ({ sources, heads: previous?.sources === sources ? previous.heads : [], facts: previous?.sources === sources ? previous.facts : [], error: true })); });
    };
    const stop = sources.chats.subscribe(refresh, refresh); refresh(); return () => { controller.abort(); stop(); };
  }, [sources, attempt]);
  return { facts: value?.sources === sources ? value.facts : [], loading: Boolean(sources && value?.sources !== sources), retry: () => setAttempt(value => value + 1), heads: value?.sources === sources ? value.heads : [], error: value?.sources === sources && value.error, enabled: Boolean(sources) };
}
