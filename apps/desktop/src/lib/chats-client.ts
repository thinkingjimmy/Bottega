/**
 * [INPUT]: Depends on shared/chats-ipc, shared/chat-preview refinement and preload exposure window.chats
 * [OUTPUT]: Provides the renderer Chat IPC adapter for metadata, bounded timeline/around/outline/find reads, create/append/rename/delete/events, App roles, and memory fallbacks
 * [POS]: Renderer-side Chat transport authority; transcript priming reads only the bounded tail and deep navigation uses fenced narrow queries
 */

import type {
  AppendChatMessageInput,
  ChatMessage,
  ChatFindInput,
  ChatRecord,
  ChatRuntimeContext,
  ChatSummary,
  ChatTimelineAroundInput,
  ChatTimelinePageInput,
  ChatsBridgeApi,
  ChatsEvent,
  ChatsSnapshot,
  CreateChatInput,
  CreateAppChatInput,
  ForkChatPreflight,
  ForkChatPreflightInput,
  ForkChatRequest,
  RenameChatInput,
} from "../../shared/chats-ipc";
import { previewOfMessages } from "../../shared/chat-preview";

declare global {
  interface Window {
    chats?: ChatsBridgeApi;
  }
}

const browserChats = new Map<string, ChatRecord>();
const browserListeners = new Set<(event: ChatsEvent) => void>();
const emit = (event: ChatsEvent) => {
  for (const listener of browserListeners) listener(structuredClone(event));
};
const summaryOf = ({
  id,
  incarnationId,
  title,
  createdAt,
  updatedAt,
  projectId,
  appRole,
  context,
  startState,
  titleSource,
  readOnlyReason,
  chatRecordRevision,
  chatMessageRevision,
  agent,
  grants,
  grantRevision,
  parentChatId,
  parentIncarnationId,
  parentMessageId,
  inheritedThroughSeq,
  executionKind,
  messages,
}: ChatRecord): ChatSummary => ({
  id,
  incarnationId,
  title,
  createdAt,
  updatedAt,
  projectId,
  appRole,
  context,
  startState,
  titleSource,
  ...(readOnlyReason ? { readOnlyReason } : {}),
  chatRecordRevision,
  chatMessageRevision,
  agent,
  grants,
  grantRevision,
  parentChatId: parentChatId ?? null,
  parentIncarnationId: parentIncarnationId ?? null,
  parentMessageId: parentMessageId ?? null,
  inheritedThroughSeq: inheritedThroughSeq ?? null,
  executionKind: executionKind ?? null,
  preview: previewOfMessages(messages),
});

export const listChats = (): Promise<ChatsSnapshot> =>
  window.chats?.list() ??
  Promise.resolve({
    chats: [...browserChats.values()]
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .map(summaryOf),
    collectionSnapshotRevision: browserChats.size,
  });

export const getChat = (chatId: string) =>
  window.chats?.runtimeContext(chatId) ??
  Promise.resolve(runtimeContextOf(browserChats.get(chatId) ?? null));

const runtimeContextOf = (
  record: ChatRecord | null
): ChatRuntimeContext | null => {
  if (!record) return null;
  const {
    messages: _messages,
    supersededBranches: _branches,
    supersededBranchesTrimmedThroughSeq: _branchWatermark,
    ...context
  } = structuredClone(record);
  return context;
};

export const getChatMessagesSnapshot = async (chatId: string) => {
  if (window.chats) {
    const page = await window.chats.timelinePage({ chatId, limit: 50 });
    return page ? {
      chatId: page.chatId,
      incarnationId: page.incarnationId,
      revision: page.nativeMessageRevision,
      chatMessageRevision: page.nativeMessageRevision,
      activeGenerationId: page.activeGenerationId,
      messages: page.messages,
      olderCursor: page.olderCursor,
      hasMoreBefore: page.hasMoreBefore,
    } : null;
  }
  const record = browserChats.get(chatId);
  return record
    ? {
        chatId,
        incarnationId: record.incarnationId,
        revision: 0,
        chatMessageRevision: record.chatMessageRevision,
        messages: structuredClone(record.messages),
      }
    : null;
};

export const getChatTimelinePage = (input: ChatTimelinePageInput) => {
  if (window.chats) return window.chats.timelinePage(input);
  const record = browserChats.get(input.chatId);
  if (!record) return Promise.resolve(null);
  const before = input.cursor?.beforeSeq ?? Number.MAX_SAFE_INTEGER;
  const limit = input.limit ?? 50;
  const eligible = record.messages.filter((message) => message.seq < before);
  const messages = eligible.slice(-limit);
  const hasMoreBefore = eligible.length > messages.length;
  return Promise.resolve({
    chatId: record.id,
    incarnationId: record.incarnationId,
    nativeMessageRevision: record.chatMessageRevision,
    activeGenerationId: null,
    messages: structuredClone(messages),
    hasMoreBefore,
    olderCursor: hasMoreBefore ? {
      segment: "native" as const,
      beforeSeq: messages[0]!.seq,
      incarnationId: record.incarnationId,
      nativeMessageRevision: record.chatMessageRevision,
      activeGenerationId: null,
    } : null,
  });
};

export const getChatTimelineAround = (input: ChatTimelineAroundInput) =>
  window.chats?.timelineAround(input) ?? Promise.resolve(null);

export const getChatOutlinePage = (input: import("../../shared/chats-ipc").ChatOutlineInput) =>
  window.chats?.outlinePage(input) ?? Promise.resolve(null);

export const findChatMessages = (input: ChatFindInput) =>
  window.chats?.findMessages(input) ?? Promise.resolve(null);

export const createChat = async (input: CreateChatInput) => {
  if (window.chats) return window.chats.create(input);
  if (browserChats.has(input.id)) throw new Error("聊天 id 已存在");
  const record: ChatRecord = {
    id: input.id,
    incarnationId: crypto.randomUUID().replaceAll("-", ""),
    title: Array.from(input.firstMessage.content).slice(0, 30).join(""),
    agent: input.agent,
    session: null,
    projectId: input.projectId ?? null,
    appRole: null,
    context: { kind: "ordinary" },
    startState: {
      kind: "started-exact",
      firstUserMessageAt: input.firstMessage.createdAt,
      firstUserMessageSeq: 1,
    },
    titleSource: "local-fallback",
    chatRecordRevision: 1,
    chatMessageRevision: 1,
    grants: [],
    grantRevision: 0,
    homeDir: `/browser-chat-homes/${input.id}`,
    createdAt: input.firstMessage.createdAt,
    updatedAt: input.firstMessage.createdAt,
    nextSeq: 2,
    messages: [{ ...structuredClone(input.firstMessage), seq: 1 }],
    titleJob: {
      state: "pending",
      jobId: crypto.randomUUID(),
      expectedRecordRevision: 1,
      expectedTitleSource: "local-fallback",
      createdAt: input.firstMessage.createdAt,
    },
  };
  browserChats.set(input.id, record);
  emit({ type: "upserted", summary: summaryOf(record) });
  return structuredClone(record);
};

export const createAppChat = async (input: CreateAppChatInput) => {
  if (window.chats) return window.chats.createForApp(input);
  const record = await createChat({ ...input, agent: input.agent ?? "codex" });
  const next: ChatRecord = {
    ...record,
    appRole: input.appRole,
    context: {
      kind: input.appRole === "use" ? "app-use" : "app-edit",
      appId: input.appId,
      ...(input.appRole === "edit" ? { projectId: input.projectId } : {}),
    } as ChatRecord["context"],
    titleSource: "app-fallback",
    titleJob: {
      state: "pending",
      jobId:
        record.titleJob.state === "pending"
          ? record.titleJob.jobId
          : crypto.randomUUID(),
      expectedRecordRevision: record.chatRecordRevision,
      expectedTitleSource: "app-fallback",
      createdAt: record.createdAt,
    },
  };
  browserChats.set(input.id, next);
  emit({ type: "upserted", summary: summaryOf(next) });
  return structuredClone(next);
};

export const appendChatMessage = async (
  input: AppendChatMessageInput
): Promise<ChatMessage> => {
  if (window.chats) return window.chats.append(input);
  const record = browserChats.get(input.chatId);
  if (!record) throw new Error("聊天不存在");
  const stored: ChatMessage = {
    ...structuredClone(input.message),
    seq: record.nextSeq,
  };
  const next = {
    ...record,
    updatedAt: input.message.createdAt,
    chatRecordRevision: record.chatRecordRevision + 1,
    chatMessageRevision: record.chatMessageRevision + 1,
    nextSeq: record.nextSeq + 1,
    messages: [...record.messages, stored],
  };
  browserChats.set(input.chatId, next);
  emit({ type: "upserted", summary: summaryOf(next) });
  return structuredClone(stored);
};

export const renameChat = async (
  input: RenameChatInput
): Promise<ChatSummary> => {
  if (window.chats) return window.chats.rename(input);
  const record = browserChats.get(input.chatId);
  if (!record) throw new Error("聊天不存在");
  const next = { ...record, title: input.title.trim() };
  browserChats.set(input.chatId, next);
  emit({ type: "upserted", summary: summaryOf(next) });
  return summaryOf(next);
};

export const deleteChat = async (chatId: string): Promise<void> => {
  if (window.chats) return window.chats.remove(chatId);
  if (!browserChats.delete(chatId)) throw new Error("聊天不存在");
  emit({ type: "removed", chatId });
};

export const preflightChatFork = (
  input: ForkChatPreflightInput
): Promise<ForkChatPreflight> => {
  if (!window.chats) return Promise.reject(new Error("Chat fork is unavailable"));
  return window.chats.forkPreflight(input);
};

export const forkChat = (input: ForkChatRequest): Promise<ChatRecord> => {
  if (!window.chats) return Promise.reject(new Error("Chat fork is unavailable"));
  return window.chats.fork(input);
};

export const onChatsEvent = (callback: (event: ChatsEvent) => void) => {
  if (window.chats) return window.chats.onEvent(callback);
  browserListeners.add(callback);
  return () => browserListeners.delete(callback);
};
