/**
 * [INPUT]: Depends on shared/chats-ipc, shared/chat-preview refinement and preload exposure window.chats
 * [OUTPUT]: Provides a list of Project attributes, App edit/use roles and draft of Agent's chat list/get/messagesSnapshot/create/append/rename/delete/event renderer Package and memory degradation
 * [POS]: The only output of the lib is the chat IPC; The browser is also downgraded to the first message, and the App chat Agent is also selected to be firm
 */

import type {
  AppendChatMessageInput,
  ChatMessage,
  ChatRecord,
  ChatSummary,
  ChatsBridgeApi,
  ChatsEvent,
  ChatsSnapshot,
  CreateChatInput,
  CreateAppChatInput,
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
const clone = <T>(value: T): T => structuredClone(value);
const emit = (event: ChatsEvent) => {
  for (const listener of browserListeners) listener(clone(event));
};
const summaryOf = ({
  id,
  title,
  createdAt,
  updatedAt,
  projectId,
  appRole,
  agent,
  grants,
  grantRevision,
  messages,
}: ChatRecord): ChatSummary => ({
  id,
  title,
  createdAt,
  updatedAt,
  projectId,
  appRole,
  agent,
  grants,
  grantRevision,
  preview: previewOfMessages(messages),
});

export const listChats = (): Promise<ChatsSnapshot> =>
  window.chats?.list() ??
  Promise.resolve({
    chats: [...browserChats.values()]
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .map(summaryOf),
  });

export const getChat = (chatId: string) =>
  window.chats?.get(chatId) ??
  Promise.resolve(clone(browserChats.get(chatId) ?? null));

export const getChatMessagesSnapshot = async (chatId: string) => {
  if (window.chats) return window.chats.messagesSnapshot(chatId);
  const record = browserChats.get(chatId);
  return record
    ? {
        chatId,
        incarnationId: record.incarnationId,
        revision: 0,
        messages: clone(record.messages),
      }
    : null;
};

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
    grants: [],
    grantRevision: 0,
    homeDir: `/browser-chat-homes/${input.id}`,
    createdAt: input.firstMessage.createdAt,
    updatedAt: input.firstMessage.createdAt,
    nextSeq: 2,
    messages: [{ ...clone(input.firstMessage), seq: 1 }],
  };
  browserChats.set(input.id, record);
  emit({ type: "upserted", summary: summaryOf(record) });
  return clone(record);
};

export const createAppChat = async (input: CreateAppChatInput) => {
  if (window.chats) return window.chats.createForApp(input);
  const record = await createChat({ ...input, agent: input.agent ?? "codex" });
  const next = { ...record, appRole: input.appRole };
  browserChats.set(input.id, next);
  emit({ type: "upserted", summary: summaryOf(next) });
  return clone(next);
};

export const appendChatMessage = async (
  input: AppendChatMessageInput
): Promise<ChatMessage> => {
  if (window.chats) return window.chats.append(input);
  const record = browserChats.get(input.chatId);
  if (!record) throw new Error("聊天不存在");
  const stored: ChatMessage = {
    ...clone(input.message),
    seq: record.nextSeq,
  };
  const next = {
    ...record,
    updatedAt: input.message.createdAt,
    nextSeq: record.nextSeq + 1,
    messages: [...record.messages, stored],
  };
  browserChats.set(input.chatId, next);
  emit({ type: "upserted", summary: summaryOf(next) });
  return clone(stored);
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

export const onChatsEvent = (callback: (event: ChatsEvent) => void) => {
  if (window.chats) return window.chats.onEvent(callback);
  browserListeners.add(callback);
  return () => browserListeners.delete(callback);
};
