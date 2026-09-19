/**
 * [INPUT]: Depends on shared/chats-ipc and the preload-exposed window.chats bridge
 * [OUTPUT]: Provides the renderer Chat IPC adapter for metadata, bounded timeline/around/outline/find reads, fork preflight/create, rename/sort-key/delete and events; throws when the bridge is absent
 * [POS]: Renderer-side Chat transport authority; transcript priming reads only the bounded tail and deep navigation uses fenced narrow queries
 */

import type {
  ChatFindInput,
  ChatOutlineInput,
  ChatRecord,
  ChatsBridgeApi,
  ChatsEvent,
  ChatsSnapshot,
  ChatTimelineAroundInput,
  ChatTimelinePageInput,
  ForkChatPreflight,
  ForkChatPreflightInput,
  ForkChatRequest,
  RenameChatInput,
  SetChatSortKeyInput,
} from "../../shared/chats-ipc";

declare global {
  interface Window {
    chats?: ChatsBridgeApi;
  }
}

const bridge = (): ChatsBridgeApi => {
  const api = window.chats;
  if (!api) throw new Error("chats bridge unavailable");
  return api;
};

export const listChats = (): Promise<ChatsSnapshot> => bridge().list();

export const getChat = (chatId: string) => bridge().runtimeContext(chatId);

export const getChatMessagesSnapshot = async (chatId: string) => {
  const page = await bridge().timelinePage({ chatId, limit: 50 });
  return page
    ? {
        chatId: page.chatId,
        incarnationId: page.incarnationId,
        revision: page.nativeMessageRevision,
        chatMessageRevision: page.nativeMessageRevision,
        activeGenerationId: page.activeGenerationId,
        messages: page.messages,
        olderCursor: page.olderCursor,
        hasMoreBefore: page.hasMoreBefore,
      }
    : null;
};

export const getChatTimelinePage = (input: ChatTimelinePageInput) =>
  bridge().timelinePage(input);

export const getChatTimelineAround = (input: ChatTimelineAroundInput) =>
  bridge().timelineAround(input);

export const getChatOutlinePage = (input: ChatOutlineInput) =>
  bridge().outlinePage(input);

export const findChatMessages = (input: ChatFindInput) =>
  bridge().findMessages(input);

export const renameChat = (input: RenameChatInput) => bridge().rename(input);
export const setChatSortKey = (input: SetChatSortKeyInput) => bridge().setSortKey(input);

export const deleteChat = (chatId: string) => bridge().remove(chatId);

export const preflightChatFork = (
  input: ForkChatPreflightInput
): Promise<ForkChatPreflight> => bridge().forkPreflight(input);

export const forkChat = (input: ForkChatRequest): Promise<ChatRecord> =>
  bridge().fork(input);

export const onChatsEvent = (callback: (event: ChatsEvent) => void) =>
  bridge().onEvent(callback);
