/**
 * [INPUT]: React external-store subscriptions and native TurnDraft projections scoped by Chat incarnation.
 * [OUTPUT]: publishTurnDraft, releaseTurnDraft useTurnDraftSelection and useTurnDraft isolate token updates from transcript controllers.
 * [POS]: Native live-draft store; attachment publishers own lifetime, draft leaves and an open Plan panel own subscriptions.
 */
import { useCallback, useSyncExternalStore } from "react";
import type { TurnDraft } from "../../../../../shared/chats/model/chat-turn-reducer";
const entries = new Map<string, { incarnationId: string | null; draft: TurnDraft | null; owner: object }>();
const listeners = new Map<string, Set<() => void>>();
const notify = (chatId: string) => listeners.get(chatId)?.forEach(listener => listener());
export function publishTurnDraft(chatId: string, incarnationId: string | null, draft: TurnDraft | null, owner: object) {
  const previous = entries.get(chatId);
  entries.set(chatId, { incarnationId, draft, owner });
  if (previous?.draft !== draft || previous.incarnationId !== incarnationId) notify(chatId);
}
export function releaseTurnDraft(chatId: string, owner: object) {
  if (entries.get(chatId)?.owner !== owner) return;
  entries.delete(chatId); notify(chatId);
}
export function useTurnDraftSelection<T>(chatId: string, incarnationId: string | null, select: (draft: TurnDraft | null) => T, enabled = true) {
  const subscribe = useCallback((listener: () => void) => {
    if (!enabled) return () => {};
    let group = listeners.get(chatId);
    if (!group) listeners.set(chatId, group = new Set());
    group.add(listener);
    return () => { group.delete(listener); if (!group.size) listeners.delete(chatId); };
  }, [chatId, enabled]);
  const read = useCallback(() => {
    const entry = entries.get(chatId);
    return select(enabled && entry?.incarnationId === incarnationId ? entry.draft : null);
  }, [chatId, enabled, incarnationId, select]);
  return useSyncExternalStore(subscribe, read, read);
}

const identity = (draft: TurnDraft | null) => draft;
export const useTurnDraft = (chatId: string, incarnationId: string | null, enabled = true) => useTurnDraftSelection(chatId, incarnationId, identity, enabled);
