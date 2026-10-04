/**
 * [INPUT]: Depends on React useSyncExternalStore, Chat message contracts, the chats-client initial snapshot, and message identity stabilization (mergeChatMessages)
 * [OUTPUT]: Provides the tail-anchored count/byte-bounded per-chat event projection ordered by segment then seq (byte sizes measured once per message, D-15), revision/incarnation/session fences,
 *           authoritative replace epochs, subscription-gated event receipt (C-20: an unwatched Chat takes no deltas, is marked stale and filled on its next subscriber), finite LRU, and the initial fill
 * [POS]: apps/desktop/src/lib/chat/state; Renderer event intake for native Chats; the transcript window and its paging live in lib/native-transcript's TranscriptSession (TASK-25 S4d), this only tracks each watched Chat's head and recent rows
 */

import { useCallback, useSyncExternalStore } from "react";
import type {
  ChatMessagesSnapshot,
  ChatsEvent,
} from "../../../../shared/ipc/content/chats-ipc";
import { getChatMessagesSnapshot } from "../session/chats-client";
import { mergeChatMessages } from "../session/chat-turn-attach";

const UNPINNED_LIMIT = 8;
const MESSAGE_COUNT_LIMIT = 500;
const MESSAGE_BYTE_LIMIT = 2 * 1024 * 1024;
const encoder = new TextEncoder();
type MessageEvent = Extract<
  ChatsEvent,
  { type: "messages" | "messages-delta" }
>;

const entries = new Map<string, ChatMessagesSnapshot>();
const listeners = new Map<string, Set<() => void>>();
const buffered = new Map<string, MessageEvent[]>();
const fetching = new Map<string, number>();
const epochs = new Map<string, number>();
const access = new Map<string, number>();
/* C-20: Chats that missed events while nobody watched them; their next subscriber fills them once. */
const stale = new Set<string>();
const sizes = new WeakMap<ChatMessagesSnapshot["messages"][number], number>();
let clock = 0;

const touch = (chatId: string) => access.set(chatId, ++clock);
const watched = (chatId: string) => (listeners.get(chatId)?.size ?? 0) > 0;
/* D-15: rows keep their identity across merges, so each one is measured once instead of the whole window on every delta. */
function bytesOf(message: ChatMessagesSnapshot["messages"][number]) {
  let size = sizes.get(message);
  if (size === undefined) sizes.set(message, (size = encoder.encode(JSON.stringify(message)).byteLength));
  return size;
}

/* 窗口永远从尾部量起：用户在看的是最新那一段，装不下的一律从头上削。 */
function boundMessages(messages: ChatMessagesSnapshot["messages"]) {
  const retained = [] as ChatMessagesSnapshot["messages"];
  let bytes = 0;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]!;
    const next = bytesOf(message);
    if (
      retained.length >= MESSAGE_COUNT_LIMIT ||
      (retained.length > 0 && bytes + next > MESSAGE_BYTE_LIMIT)
    ) break;
    retained.push(message);
    bytes += next;
  }
  return retained.reverse();
}

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
    /* 逐出必须整条抹掉：留下的 epoch/fetching 会让下一次进入这条会话的
       补拉被自己上一世的在途请求判成过期，界面停在空转录上。 */
    epochs.delete(chatId);
    fetching.delete(chatId);
    stale.delete(chatId);
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
    chatMessageRevision: event.chatMessageRevision ?? event.revision,
    messages: boundMessages(mergeChatMessages(current.messages, event.appended)),
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
            ...current,
            chatId: event.chatId,
            incarnationId: event.incarnationId,
            revision: event.revision,
            chatMessageRevision: event.chatMessageRevision ?? event.revision,
            ...(event.mode ? { mode: event.mode } : {}),
            messages: boundMessages(event.messages),
          }
        : applyDelta(current, event);
  }
  buffered.set(base.chatId, remaining);
  return current;
}

function acceptSnapshot(snapshot: ChatMessagesSnapshot) {
  const current = entries.get(snapshot.chatId);
  const carried =
    current?.incarnationId === snapshot.incarnationId ? current : undefined;
  /* 排队中的补拉可能带着更旧的 revision 才落地：它绝不能盖掉已经更新的快照。 */
  if (carried && carried.revision > snapshot.revision) {
    publish(snapshot.chatId, applyBuffered(carried));
    return;
  }
  const sameRevision = carried?.revision === snapshot.revision;
  const base: ChatMessagesSnapshot = {
    ...(sameRevision ? carried! : snapshot),
    activeGenerationId: snapshot.activeGenerationId,
    // An event snapshot carries no paging facts: absent means unchanged, only the fill says what lies before.
    hasMoreBefore: snapshot.hasMoreBefore ?? carried?.hasMoreBefore ?? false,
  };
  publish(snapshot.chatId, applyBuffered(base));
}

function requestFill(chatId: string) {
  const epoch = epochs.get(chatId) ?? 0;
  if (fetching.get(chatId) === epoch) return;
  touch(chatId);
  fetching.set(chatId, epoch);
  let succeeded = false;
  void getChatMessagesSnapshot(chatId)
    .then((snapshot) => {
      if ((epochs.get(chatId) ?? 0) !== epoch) return;
      succeeded = true;
      if (snapshot) acceptSnapshot(snapshot);
      else removeChatMessages(chatId);
    })
    .catch(() => {
      // IPC 故障留待下一条事件重试，禁止 finally 立即自旋。
    })
    .finally(() => {
      if (fetching.get(chatId) === epoch) fetching.delete(chatId);
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
  if (event.type === "removed" || event.type === "session-invalidated") {
    removeChatMessages(event.chatId);
    return;
  }
  if (event.type !== "messages" && event.type !== "messages-delta") return;
  if (!watched(event.chatId)) {
    stale.add(event.chatId);
    buffered.delete(event.chatId);
    return;
  }
  const current = entries.get(event.chatId);
  if (event.type === "messages") {
    acceptSnapshot({
      chatId: event.chatId,
      incarnationId: event.incarnationId,
      revision: event.revision,
      chatMessageRevision: event.chatMessageRevision ?? event.revision,
      ...(event.mode ? { mode: event.mode } : {}),
      messages: boundMessages(event.messages),
    });
    requestFill(event.chatId);
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

export const loadInitialChatMessages = (chatId: string) => requestFill(chatId);

function removeChatMessages(chatId: string) {
  epochs.set(chatId, (epochs.get(chatId) ?? 0) + 1);
  fetching.delete(chatId);
  const existed = entries.delete(chatId);
  buffered.delete(chatId);
  access.delete(chatId);
  stale.delete(chatId);
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
  if (stale.delete(chatId)) requestFill(chatId);
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

/* 渲染期只能读，不能写：getSnapshot 里 touch 一下 LRU，就是在 React 的
   读路径上改共享状态，并发渲染下同一次提交会看见两个不同的顺序。访问序
   由 publish/subscribe 记账，那两处本来就在渲染之外。 */
export function readChatMessages(chatId: string) {
  return entries.get(chatId);
}

export function resetChatMessagesStoreForTests() {
  entries.clear();
  listeners.clear();
  buffered.clear();
  fetching.clear();
  epochs.clear();
  access.clear();
  stale.clear();
  clock = 0;
}
