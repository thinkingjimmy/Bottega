/**
 * [INPUT]: Depends on React useSyncExternalStore, Chat message/timeline contracts, bounded chats-client queries, and message identity stabilization
 * [OUTPUT]: Provides the tail-anchored count/byte-bounded per-chat message window ordered by segment then seq, head-trimming older-page cursors that never drop the tail, carried paging windows across event snapshots, around-target materialization, revision/incarnation/session fences, authoritative replace epochs, finite LRU, event receipt, and paged priming
 * [POS]: Renderer message projection authority; background Chat traffic stays outside ChatsProvider context and full transcripts are loaded only by explicit pagination
 */

import { useCallback, useSyncExternalStore } from "react";
import type {
  ChatMessagesSnapshot,
  ChatsEvent,
} from "../../shared/chats-ipc";
import {
  getChatMessagesSnapshot,
  getChatTimelineAround,
  getChatTimelinePage,
} from "./chats-client";
import { compareChatMessageOrder, mergeChatMessages } from "./chat-turn-attach";

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
let clock = 0;

const touch = (chatId: string) => access.set(chatId, ++clock);
const generationOf = (snapshot: ChatMessagesSnapshot) =>
  snapshot.activeGenerationId ?? snapshot.olderCursor?.activeGenerationId ?? null;
const bytesOf = (message: ChatMessagesSnapshot["messages"][number]) =>
  encoder.encode(JSON.stringify(message)).byteLength;

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

function boundAroundMessage(
  messages: ChatMessagesSnapshot["messages"],
  messageId: string
) {
  const target = messages.findIndex((message) => message.id === messageId);
  if (target < 0) return boundMessages(messages);
  const retained = [messages[target]!];
  let bytes = bytesOf(retained[0]!);
  for (let distance = 1; retained.length < MESSAGE_COUNT_LIMIT; distance += 1) {
    const candidates = [messages[target - distance], messages[target + distance]].filter(Boolean);
    if (!candidates.length) break;
    for (const candidate of candidates) {
      if (retained.length >= MESSAGE_COUNT_LIMIT) break;
      const next = bytesOf(candidate!);
      if (bytes + next > MESSAGE_BYTE_LIMIT) return retained.sort(compareChatMessageOrder);
      retained.push(candidate!);
      bytes += next;
    }
  }
  return retained.sort(compareChatMessageOrder);
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
    olderCursor: carriedCursor(
      current.olderCursor,
      event.chatMessageRevision ?? event.revision
    ),
  };
}

/* 事件投影的 messages 快照不带分页窗口：照抄它就等于把「上面还有」连同
   游标一起抹掉，转录从此再也翻不上去。缺席即沿用，null 才是「没有更早的」。 */
function carriedCursor(
  cursor: ChatMessagesSnapshot["olderCursor"],
  chatMessageRevision: number
) {
  return cursor ? { ...cursor, nativeMessageRevision: chatMessageRevision } : cursor ?? null;
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
            olderCursor: carriedCursor(
              current.olderCursor,
              event.chatMessageRevision ?? event.revision
            ),
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
    olderCursor: snapshot.olderCursor === undefined
      ? carriedCursor(
          carried?.olderCursor,
          snapshot.chatMessageRevision ?? snapshot.revision
        )
      : snapshot.olderCursor,
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

export async function loadOlderChatMessages(chatId: string) {
  const current = entries.get(chatId);
  if (!current?.hasMoreBefore || !current.olderCursor) return current ?? null;
  const page = await getChatTimelinePage({
    chatId,
    cursor: current.olderCursor,
    limit: 50,
  });
  if (!page) return null;
  if (
    page.incarnationId !== current.incarnationId ||
    page.nativeMessageRevision !== (current.chatMessageRevision ?? current.revision) ||
    page.activeGenerationId !== generationOf(current)
  ) {
    removeChatMessages(chatId);
    requestFill(chatId);
    throw new Error("CHAT_TIMELINE_STALE");
  }
  /* 向上翻页只能往头上加，绝不能削尾：留最旧的 500 条等于把用户正在看的
     那一段丢掉，随后一条 delta 会跨着这道看不见的裂口重新贴上来。窗口装
     不下时就在这里停住——游标指向仍在窗内的首条，`hasMoreBefore` 保持真。 */
  const merged = mergeChatMessages(page.messages, current.messages);
  const retained = boundMessages(merged);
  const trimmedHead = retained.length < merged.length;
  const first = retained[0];
  const next: ChatMessagesSnapshot = {
    ...current,
    messages: retained,
    olderCursor: trimmedHead && first
      ? {
          segment: first.segment ?? "native",
          beforeSeq: first.seq,
          incarnationId: page.incarnationId,
          nativeMessageRevision: page.nativeMessageRevision,
          activeGenerationId: page.activeGenerationId,
        }
      : page.olderCursor,
    hasMoreBefore: trimmedHead || page.hasMoreBefore,
  };
  publish(chatId, next);
  return next;
}

export async function materializeChatMessage(
  chatId: string,
  messageId: string
) {
  const current = entries.get(chatId);
  if (!current) return null;
  if (current.messages.some((message) => message.id === messageId)) {
    return current;
  }
  const page = await getChatTimelineAround({
    chatId,
    messageId,
    radius: 25,
    fence: {
      incarnationId: current.incarnationId,
      nativeMessageRevision:
        current.chatMessageRevision ?? current.revision,
      activeGenerationId: generationOf(current),
    },
  });
  if (!page) return null;
  if (
    page.incarnationId !== current.incarnationId ||
    page.nativeMessageRevision !==
      (current.chatMessageRevision ?? current.revision) ||
    page.activeGenerationId !== generationOf(current)
  ) {
    removeChatMessages(chatId);
    requestFill(chatId);
    throw new Error("CHAT_TIMELINE_STALE");
  }
  const next: ChatMessagesSnapshot = {
    ...current,
    messages: boundAroundMessage(
      mergeChatMessages(current.messages, page.messages),
      messageId
    ),
  };
  publish(chatId, next);
  return next;
}

function removeChatMessages(chatId: string) {
  epochs.set(chatId, (epochs.get(chatId) ?? 0) + 1);
  fetching.delete(chatId);
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
  clock = 0;
}
