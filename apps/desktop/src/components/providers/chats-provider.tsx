"use client";

/**
 * [INPUT]: Depends on React Context, shared chats, contracts, chats-client, archive-client, composer/messages stores, agent activity and sonner toast
 * [OUTPUT]: Provides ChatsProvider/useChats; chats are always in the createdAt reverse order (Sidebar location is constant, Activity order is exclusive to the Activity view); The event chat is synchronous with the transfer of messages, projection, composer incarnation/delete clearing and activity store; mutation failed to get out toast, warning only to carry the main process
 * [POS]: The only source of truth is the chat summary of the providers; Draft Resource Cleaning at the provider level subscribe to one-time connections
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type {
  AppendChatMessageInput,
  ChatMessage,
  ChatRecord,
  ChatSummary,
  ChatsEvent,
  CreateChatInput,
  CreateAppChatInput,
  RenameChatInput,
} from "../../../shared/chats-ipc";
import { receiveChatMessagesEvent } from "@/lib/chat-messages-store";
import { receiveComposerChatEvent } from "@/lib/chat-composer-store";
import {
  clearChatActivity,
  primeChatActivity,
  receiveChatActivity,
} from "@/lib/chat-activity-store";
import { listAgentActivity, onAgentActivity } from "@/lib/agent-client";
import {
  appendChatMessage,
  createChat as createChatViaClient,
  createAppChat as createAppChatViaClient,
  deleteChat as deleteChatViaClient,
  getChat as getChatViaClient,
  listChats,
  onChatsEvent,
  renameChat as renameChatViaClient,
} from "@/lib/chats-client";
import { archiveTargets } from "@/lib/archive-client";
import { errorMessage } from "@/lib/errors";
import { toast } from "@ai-chat/ui/components/ui/sonner";

type ChatsContextValue = {
  chats: ChatSummary[];
  warning: string;
  loading: boolean;
  createChat: (input: CreateChatInput) => Promise<ChatRecord>;
  createAppChat: (input: CreateAppChatInput) => Promise<ChatRecord>;
  appendMessage: (input: AppendChatMessageInput) => Promise<ChatMessage>;
  getChat: (chatId: string) => Promise<ChatRecord | null>;
  renameChat: (input: RenameChatInput) => Promise<ChatSummary>;
  archiveChat: (chatId: string) => Promise<void>;
  deleteChat: (chatId: string) => Promise<void>;
};

const ChatsContext = createContext<ChatsContextValue | null>(null);

/* Sidebar 列表（根级 Chats 与 Project 子列表）一律按创建时间倒序：
 * 位置在 chat 诞生那一刻定死，跑一轮 turn 不会把它顶上来，肌肉记忆不失效。
 * 「最近聊过什么」是另一个问题，由 Activity 视图按活动时间独立回答。 */
const sortChats = (chats: ChatSummary[]) =>
  [...chats].sort(
    (left, right) =>
      right.createdAt - left.createdAt || left.id.localeCompare(right.id)
  );

function applyEvents(base: ChatSummary[], events: ChatsEvent[]) {
  const summaries = new Map(base.map((chat) => [chat.id, chat]));
  for (const event of events) {
    if (event.type === "upserted") {
      summaries.set(event.summary.id, event.summary);
    } else if (event.type === "removed") {
      summaries.delete(event.chatId);
    }
  }
  return sortChats([...summaries.values()]);
}

export function ChatsProvider({ children }: { children: React.ReactNode }) {
  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [warning, setWarning] = useState("");
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    let live = false;
    const buffer: ChatsEvent[] = [];
    const receive = (event: ChatsEvent) => {
      if (!active) return;
      receiveChatMessagesEvent(event);
      receiveComposerChatEvent(event);
      // 外部 store 的转发不受 Context 就绪门控，删除即刻抹掉活动标记。
      if (event.type === "removed") clearChatActivity(event.chatId);
      if (!live) {
        buffer.push(event);
        return;
      }
      if (event.type === "warning") setWarning(event.message);
      else if (
        event.type === "messages" ||
        event.type === "messages-delta"
      ) return;
      else setChats((current) => applyEvents(current, [event]));
    };
    const unsubscribe = onChatsEvent(receive);

    void listChats()
      .then((snapshot) => {
        if (!active) return;
        const warningEvents = buffer.filter(
          (event): event is Extract<ChatsEvent, { type: "warning" }> =>
            event.type === "warning"
        );
        setChats(applyEvents(snapshot.chats, buffer));
        setWarning(
          warningEvents.at(-1)?.message ?? snapshot.warning ?? ""
        );
        live = true;
      })
      .catch((cause) => {
        if (!active) return;
        setChats(applyEvents([], buffer));
        setWarning(`聊天列表加载失败：${errorMessage(cause)}`);
        live = true;
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  // 会话活动：先订阅再补齐初始运行集，prime 只填空，不覆盖订阅期内收到的跃迁。
  useEffect(() => {
    let active = true;
    const unsubscribe = onAgentActivity(receiveChatActivity);
    void listAgentActivity()
      .then((snapshots) => {
        if (active) primeChatActivity(snapshots);
      })
      .catch(() => {});
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  /* 一次性操作失败走 toast；setWarning 只留给主进程事件流的持久告警，
     两种寿命不同的消息不共用同一条侧栏横幅。 */
  const createChat = useCallback(async (input: CreateChatInput) => {
    try {
      return await createChatViaClient(input);
    } catch (cause) {
      toast.error(`聊天保存失败：${errorMessage(cause)}`);
      throw cause;
    }
  }, []);

  const createAppChat = useCallback(async (input: CreateAppChatInput) => {
    try {
      return await createAppChatViaClient(input);
    } catch (cause) {
      toast.error(`App 聊天保存失败：${errorMessage(cause)}`);
      throw cause;
    }
  }, []);

  const appendMessage = useCallback(
    async (input: AppendChatMessageInput) => {
      try {
        return await appendChatMessage(input);
      } catch (cause) {
        toast.error(`聊天消息保存失败：${errorMessage(cause)}`);
        throw cause;
      }
    },
    []
  );

  const renameChat = useCallback(async (input: RenameChatInput) => {
    try {
      return await renameChatViaClient(input);
    } catch (cause) {
      toast.error(`聊天重命名失败：${errorMessage(cause)}`);
      throw cause;
    }
  }, []);

  const archiveChat = useCallback(async (chatId: string) => {
    try {
      await archiveTargets([{ kind: "chat", id: chatId }]);
    } catch (cause) {
      toast.error(`聊天归档失败：${errorMessage(cause)}`);
      throw cause;
    }
  }, []);

  const deleteChat = useCallback(async (chatId: string) => {
    try {
      await deleteChatViaClient(chatId);
    } catch (cause) {
      toast.error(`聊天删除失败：${errorMessage(cause)}`);
      throw cause;
    }
  }, []);

  const value = useMemo<ChatsContextValue>(
    () => ({
      chats,
      warning,
      loading,
      createChat,
      createAppChat,
      appendMessage,
      getChat: getChatViaClient,
      renameChat,
      archiveChat,
      deleteChat,
    }),
    [appendMessage, archiveChat, chats, createAppChat, createChat, deleteChat, loading, renameChat, warning]
  );

  return <ChatsContext.Provider value={value}>{children}</ChatsContext.Provider>;
}

export function useChats() {
  const context = useOptionalChats();
  if (!context) throw new Error("useChats 必须在 ChatsProvider 内使用");
  return context;
}

export function useOptionalChats() {
  return useContext(ChatsContext);
}
