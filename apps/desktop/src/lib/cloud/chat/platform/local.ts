/**
 * [INPUT]: Native SQLite timeline/runtime clients, Agent attach, original coordinator commands and scoped account/execution adapters.
 * [OUTPUT]: LocalPlatform with six typed facades and native capabilities, preserving native records and submission custody.
 * [POS]: Desktop execution port; native data is never recast as authenticated cloud metadata.
 */
import { useMemo } from "react";
import { useDesktopAccountFacade } from "./account";
import { LOCAL_CHAT_CAPABILITIES, type ChatPlatformFacades, type AccountFacade, type ExecutionFacade } from "@ai-chat/chat-ui/contracts";
import { getChat, listChats, onChatsEvent, getChatTimelinePage, getChatTimelineAround, getChatOutlinePage, findChatMessages } from "../../../chats-client";
import { readChatMessages, subscribeChatMessages, loadInitialChatMessages, loadOlderChatMessages, materializeChatMessage, useChatMessages } from "../../../chat-messages-store";
import { attachToAgent, listAgentActivity, onAgentActivity } from "../../../agent-client";
import { nativeChatCommands } from "./commands";
export const localChatReads = Object.freeze({
  chats: Object.freeze({ head: getChat, list: listChats, subscribe: onChatsEvent }),
  transcript: Object.freeze({ page: getChatTimelinePage, around: getChatTimelineAround, outline: getChatOutlinePage, find: findChatMessages,
    useSnapshot: useChatMessages, snapshot: readChatMessages, subscribe: subscribeChatMessages, load: loadInitialChatMessages, earlier: loadOlderChatMessages, materialize: materializeChatMessage }),
  live: Object.freeze({ attach: attachToAgent, activity: listAgentActivity, subscribe: onAgentActivity }),
});
export type LocalPlatform = ChatPlatformFacades<AccountFacade, typeof localChatReads.chats, typeof localChatReads.transcript,
  typeof localChatReads.live, typeof nativeChatCommands, ExecutionFacade>;
export function createLocalPlatform(account: AccountFacade, execution: ExecutionFacade): LocalPlatform {
  return Object.freeze({ ...localChatReads, capabilities: LOCAL_CHAT_CAPABILITIES, account, commands: nativeChatCommands, execution });
}

const execution: ExecutionFacade = {
  read: async chatId => { if (!window.cloudChat) throw new Error("CHAT_EXECUTION_UNAVAILABLE"); return window.cloudChat.execution({ chatId }); },
  subscribe: (_chatId, changed) => window.cloudChat?.onLocalChanged(changed) ?? (() => {}),
  prepare: async chatId => { if (!window.cloudChat) throw new Error("CHAT_EXECUTION_UNAVAILABLE"); await window.cloudChat.prepare({ chatId }); },
};
export function useLocalPlatform(head: typeof getChat = getChat) {
  const account = useDesktopAccountFacade();
  return useMemo(() => ({ ...createLocalPlatform(account, execution), chats: { ...localChatReads.chats, head } }), [account, head]);
}
