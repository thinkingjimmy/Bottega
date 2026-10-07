/**
 * [INPUT]: Bounded transcript bodies, live projections, live read failures and native/imported window provenance.
 * [OUTPUT]: ConversationModelProvider, useConversationModel and publication store for transcript, composer and sibling panel readers.
 * [POS]: One read-only publication channel; an outer host provider is reused by RemoteConversation.
 */
import { createContext, createElement, useContext, useState, useSyncExternalStore, type ReactNode } from "react";
import type { ChatBody } from "@ai-chat/cloud-protocol/chats/transcript/body";
import type { ChatLiveView } from "../../../platform/model";
export type ConversationModel = {
  chatId: string; incarnationId: string; bodies: ChatBody[]; live: ChatLiveView | null;
  segments: { kind: "native" | "imported"; id: string }[];
  liveError?: boolean;
  ready: boolean; hasEarlier: boolean; latest: boolean; canonicalReady: boolean;
};
export const EMPTY_CONVERSATION: ConversationModel = { chatId: "", incarnationId: "", bodies: [], live: null, segments: [], ready: false, hasEarlier: false, latest: true, canonicalReady: false };
export class ConversationModelStore {
  private value = EMPTY_CONVERSATION;
  private listeners = new Set<() => void>();
  snapshot = () => this.value;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  publish(value: ConversationModel) { this.value = value; for (const listener of this.listeners) listener(); }
}
const context = createContext<ConversationModelStore | null>(null);
export function ConversationModelProvider({ children }: { children: ReactNode }) {
  const parent = useContext(context), [owned] = useState(() => new ConversationModelStore());
  return createElement(context.Provider, { value: parent ?? owned }, children);
}
export const useConversationModelPublisher = () => useContext(context);
const emptySubscribe = () => () => {};
export function useConversationModel() {
  const store = useContext(context);
  return useSyncExternalStore(store?.subscribe ?? emptySubscribe, store?.snapshot ?? (() => EMPTY_CONVERSATION), store?.snapshot ?? (() => EMPTY_CONVERSATION));
}
