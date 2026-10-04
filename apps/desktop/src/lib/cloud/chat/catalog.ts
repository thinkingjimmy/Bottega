/**
 * [INPUT]: Depends on scoped readonly Chat sources and React disposal boundaries.
 * [OUTPUT]: Provides portable catalog, current head and confirmed-deletion hooks (also as ...From(sources) for a given source) with stale-account and incomplete-load fences; a sources rebuild for the same account keeps the last read on screen.
 * [POS]: Mirror navigation state; never inserts a fabricated executable ChatRecord into native providers.
 */
import { useEffect, useState } from "react";
import type { CloudChatHead } from "@ai-chat/cloud-protocol/chats/model";
import type { ChatCatalogFacts } from "@ai-chat/chat-ui/model";
import { useDesktopChatSources } from "./sources";
export type ChatSources = ReturnType<typeof useDesktopChatSources>;
export const useCloudChatHead = (chatId: string | undefined) => useCloudChatHeadFrom(useDesktopChatSources(), chatId);
export const useCloudChatCatalog = () => useCloudChatCatalogFrom(useDesktopChatSources());
/* Retained values are keyed by account scope, not by the sources object: a rebuild for the same account (a wake that lands
   temporarily offline, then ready again) keeps the last read on screen until the new one lands (TASK-20 wake check). */
export function useCloudChatHeadFrom(sources: ChatSources, chatId: string | undefined) {
  const scope = sources?.scope, [value, setValue] = useState<{ scope: string; chatId: string; head: CloudChatHead | null; residence?: "native" | "mirror" | null; deleted: boolean; error: boolean } | null>(null);
  useEffect(() => {
    if (!sources || !chatId) return;
    const controller = new AbortController(); let revision = 0;
    /* Every local change re-reads; most of them say nothing new about this Chat. Publishing an equal
       value would re-render the whole route for nothing, so unchanged reads keep the current state. */
    const same = (previous: typeof value, next: { head: CloudChatHead | null; residence?: "native" | "mirror" | null; deleted: boolean }) =>
      previous !== null && previous.scope === sources.scope && previous.chatId === chatId && !previous.error &&
      previous.residence === next.residence && previous.deleted === next.deleted && JSON.stringify(previous.head) === JSON.stringify(next.head);
    const refresh = () => { const expected = ++revision;
      void Promise.all([sources.chats.head(chatId, controller.signal), sources.execution.read(chatId)]).then(([head, execution]) => {
        if (controller.signal.aborted || revision !== expected) return;
        const next = { head, residence: execution.residence, deleted: execution.reason === "deleted" };
        setValue(previous => same(previous, next) ? previous : { scope: sources.scope, chatId, ...next, error: false }); })
        .catch(() => { if (!controller.signal.aborted && revision === expected) setValue({ scope: sources.scope, chatId, head: null, deleted: false, error: true }); }); };
    const stop = sources.chats.subscribe(refresh, refresh); refresh(); return () => { controller.abort(); stop(); };
  }, [sources, chatId]);
  const known = Boolean(sources) && value !== null && value.scope === scope && value.chatId === chatId;
  return { sources, head: known ? value!.head : undefined, residence: known ? value!.residence : undefined,
    deleted: known && value!.deleted, error: known && value!.error };
}
export function useCloudChatCatalogFrom(sources: ChatSources) {
  const scope = sources?.scope, [value, setValue] = useState<{ scope: string; heads: CloudChatHead[]; facts: ChatCatalogFacts[]; error: boolean } | null>(null);
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
        if (!request.signal.aborted) setValue({ scope: sources.scope, heads, facts, error: false });
      })().catch(() => { if (!request.signal.aborted) setValue(previous => ({ scope: sources.scope, heads: previous?.scope === sources.scope ? previous.heads : [], facts: previous?.scope === sources.scope ? previous.facts : [], error: true })); });
    };
    const stop = sources.chats.subscribe(refresh, refresh); refresh(); return () => { controller.abort(); stop(); };
  }, [sources, attempt]);
  const known = Boolean(sources) && value?.scope === scope;
  return { facts: known ? value!.facts : [], loading: Boolean(sources) && !known, retry: () => setAttempt(value => value + 1), heads: known ? value!.heads : [], error: known && value!.error, enabled: Boolean(sources) };
}
