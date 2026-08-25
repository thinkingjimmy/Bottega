/**
 * [INPUT]: Depends on React useSyncExternalStore, Chats Add/Shot contracts, chats-client Atom snapshot and message identity stabilizer
 * [OUTPUT]: Provides per-chat messages external store, revision/incarnation fence, authoritative replace epoch, empty buffer replenishment, subscription to nail LRU, event receipt and hybrid prime
 * [POS]: The only source of truth for the renderer lib is the message projection; Background chat traffic is not coming into ChatsProvider Context
 */

import { useCallback, useSyncExternalStore } from "react";
import type {
  ChatMessagesSnapshot,
  ChatRecord,
  ChatsEvent,
} from "../../shared/chats-ipc";
import { getChatMessagesSnapshot } from "./chats-client";
import { mergeChatMessages } from "./chat-turn-attach";

const UNPINNED_LIMIT = 8;
type MessageEvent = Extract<
  ChatsEvent,
  { type: "messages" | "messages-delta" }
>;

const entries = new Map<string, ChatMessagesSnapshot>();
const listeners = new Map<string, Set<() => void>>();
const buffered = new Map<string, MessageEvent[]>();
const fetching = new Set<string>();
const access = new Map<string, number>();
let clock = 0;

const touch = (chatId: string) => access.set(chatId, ++clock);

function publish(chatId: string, snapshot: ChatMessagesSnapshot) {
  const previous = entries.get(chatId);
  entries.set(chatId, snapshot);
  touch(chatId);
  evict();
  if (previous === snapshot) return;
  for (const listener of listeners.get(chatId) ?? []) listener();
}

function evict() {
  const unpinned = [...entries.keys()]
    .filter((chatId) => (listeners.get(chatId)?.size ?? 0) === 0)
    .sort(
      (left, right) =>
        (access.get(right) ?? 0) - (access.get(left) ?? 0)
    );
  for (const chatId of unpinned.slice(UNPINNED_LIMIT)) {
    entries.delete(chatId);
    buffered.delete(chatId);
    access.delete(chatId);
  }
}

function buffer(event: MessageEvent) {
  const pending = buffered.get(event.chatId) ?? [];
  if (
    !pending.some(
      (candidate) =>
        candidate.incarnationId === event.incarnationId &&
        candidate.revision === event.revision
    )
  ) {
    pending.push(event);
  }
  buffered.set(event.chatId, pending);
}

function applyDelta(
  current: ChatMessagesSnapshot,
  event: Extract<MessageEvent, { type: "messages-delta" }>
) {
  /* mode 是一次性指令，只属于携带它的那个 revision：spread 会让
     "replace" 粘在快照上，此后每条流式 delta 都被消费方当成整体替换，
     本地投影行（排队占位、失败 notice）会被静默丢弃。 */
  const { mode: _mode, ...base } = current;
  return {
    ...base,
    revision: event.revision,
    messages: mergeChatMessages(current.messages, event.appended),
  };
}

function applyBuffered(base: ChatMessagesSnapshot) {
  let current = base;
  const pending = (buffered.get(base.chatId) ?? [])
    .filter(
      (event) =>
        event.incarnationId === base.incarnationId &&
        event.revision > base.revision
    )
    .sort((left, right) => left.revision - right.revision);
  const remaining: MessageEvent[] = [];
  for (const event of pending) {
    if (event.revision !== current.revision + 1) {
      remaining.push(event);
      continue;
    }
    current =
      event.type === "messages"
        ? {
            chatId: event.chatId,
            incarnationId: event.incarnationId,
            revision: event.revision,
            ...(event.mode ? { mode: event.mode } : {}),
            messages: event.messages,
          }
        : applyDelta(current, event);
  }
  buffered.set(base.chatId, remaining);
  return current;
}

function acceptSnapshot(snapshot: ChatMessagesSnapshot) {
  const current = entries.get(snapshot.chatId);
  const base =
    current &&
    current.incarnationId === snapshot.incarnationId &&
    current.revision >= snapshot.revision
      ? current
      : snapshot;
  publish(snapshot.chatId, applyBuffered(base));
}

function requestFill(chatId: string) {
  if (fetching.has(chatId)) return;
  fetching.add(chatId);
  let succeeded = false;
  void getChatMessagesSnapshot(chatId)
    .then((snapshot) => {
      succeeded = true;
      if (snapshot) acceptSnapshot(snapshot);
      else removeChatMessages(chatId);
    })
    .catch(() => {
      // IPC 故障留待下一条事件重试，禁止 finally 立即自旋。
    })
    .finally(() => {
      fetching.delete(chatId);
      if (!succeeded) return;
      const current = entries.get(chatId);
      const pending = buffered.get(chatId) ?? [];
      if (
        pending.some(
          (event) =>
            !current ||
            event.incarnationId !== current.incarnationId ||
            event.revision > current.revision + 1
        )
      ) {
        requestFill(chatId);
      }
    });
}

export function receiveChatMessagesEvent(event: ChatsEvent) {
  if (event.type === "removed") {
    removeChatMessages(event.chatId);
    return;
  }
  if (event.type !== "messages" && event.type !== "messages-delta") return;
  const current = entries.get(event.chatId);
  if (event.type === "messages") {
    acceptSnapshot({
      chatId: event.chatId,
      incarnationId: event.incarnationId,
      revision: event.revision,
      ...(event.mode ? { mode: event.mode } : {}),
      messages: event.messages,
    });
    return;
  }
  if (
    !current ||
    current.incarnationId !== event.incarnationId ||
    event.revision !== current.revision + 1
  ) {
    if (
      current?.incarnationId === event.incarnationId &&
      event.revision <= current.revision
    ) {
      return;
    }
    buffer(event);
    requestFill(event.chatId);
    return;
  }
  publish(event.chatId, applyDelta(current, event));
}

export function primeChatMessages(record: ChatRecord) {
  const current = entries.get(record.id);
  if (
    current &&
    current.incarnationId === record.incarnationId &&
    current.revision > 0
  ) {
    return;
  }
  if (current?.incarnationId !== record.incarnationId) {
    buffered.delete(record.id);
  }
  const snapshot = applyBuffered({
    chatId: record.id,
    incarnationId: record.incarnationId,
    revision: 0,
    messages: record.messages,
  });
  publish(record.id, snapshot);
}

export function removeChatMessages(chatId: string) {
  const existed = entries.delete(chatId);
  buffered.delete(chatId);
  access.delete(chatId);
  if (existed) {
    for (const listener of listeners.get(chatId) ?? []) listener();
  }
}

export function subscribeChatMessages(
  chatId: string,
  listener: () => void
) {
  const current = listeners.get(chatId) ?? new Set<() => void>();
  current.add(listener);
  listeners.set(chatId, current);
  touch(chatId);
  return () => {
    current.delete(listener);
    if (current.size === 0) listeners.delete(chatId);
    evict();
  };
}

export function useChatMessages(chatId: string) {
  const subscribeChat = useCallback(
    (listener: () => void) => subscribeChatMessages(chatId, listener),
    [chatId]
  );
  const getSnapshot = useCallback(
    () => readChatMessages(chatId),
    [chatId]
  );
  return useSyncExternalStore(subscribeChat, getSnapshot, getSnapshot);
}

export function readChatMessages(chatId: string) {
  touch(chatId);
  return entries.get(chatId);
}

export function resetChatMessagesStoreForTests() {
  entries.clear();
  listeners.clear();
  buffered.clear();
  fetching.clear();
  access.clear();
  clock = 0;
}
