"use client";

/**
 * [INPUT]: Depends on React Context, locale catalogs, shared chat/storage-failure contracts, clients, renderer stores, Agent activity, and toast
 * [OUTPUT]: Provides ChatsProvider/useChats with buffered chat events, structured storage failures, optional activity hydration, and mutation feedback
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
  ChatRuntimeContext,
  ChatSummary,
  ChatsEvent,
  CreateChatInput,
  CreateAppChatInput,
  RenameChatInput,
} from "../../../shared/chats-ipc";
import type { ChatStorageFailure } from "../../../shared/product-failure";
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
import { useAppTranslation } from "./i18n-provider";

type ChatsContextValue = {
  chats: ChatSummary[];
  warning: string;
  storageFailures: ChatStorageFailure[];
  loading: boolean;
  createChat: (input: CreateChatInput) => Promise<ChatRecord>;
  createAppChat: (input: CreateAppChatInput) => Promise<ChatRecord>;
  appendMessage: (input: AppendChatMessageInput) => Promise<ChatMessage>;
  getChat: (chatId: string) => Promise<ChatRuntimeContext | null>;
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

function mergeStorageFailures(
  base: ChatStorageFailure[],
  events: ChatsEvent[]
) {
  const failures = new Map(
    base.map((failure) => [JSON.stringify(failure), failure])
  );
  for (const event of events) {
    if (event.type !== "storage-failure") continue;
    failures.set(JSON.stringify(event.failure), event.failure);
  }
  return [...failures.values()];
}

export function ChatsProvider({
  children,
  includeActivity = true,
}: {
  children: React.ReactNode;
  includeActivity?: boolean;
}) {
  const { t } = useAppTranslation();
  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [warning, setWarning] = useState("");
  const [storageFailures, setStorageFailures] = useState<ChatStorageFailure[]>([]);
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
      else if (event.type === "storage-failure") {
        setStorageFailures((current) => mergeStorageFailures(current, [event]));
      }
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
        setStorageFailures(
          mergeStorageFailures(snapshot.storageFailures ?? [], buffer)
        );
        setWarning(
          warningEvents.at(-1)?.message ?? snapshot.warning ?? ""
        );
        live = true;
      })
      .catch((cause) => {
        if (!active) return;
        setChats(applyEvents([], buffer));
        setStorageFailures(mergeStorageFailures([], buffer));
        setWarning(
          t("chat.provider.listFailed", { message: errorMessage(cause) })
        );
        live = true;
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
      unsubscribe();
    };
  }, [t]);

  // 会话活动：先订阅再补齐初始运行集，prime 只填空，不覆盖订阅期内收到的跃迁。
  useEffect(() => {
    if (!includeActivity) return;
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
  }, [includeActivity]);

  /* 一次性操作失败走 toast；setWarning 只留给主进程事件流的持久告警，
     两种寿命不同的消息不共用同一条侧栏横幅。 */
  const createChat = useCallback(async (input: CreateChatInput) => {
    try {
      return await createChatViaClient(input);
    } catch (cause) {
      toast.error(t("chat.provider.saveFailed", { message: errorMessage(cause) }));
      throw cause;
    }
  }, [t]);

  const createAppChat = useCallback(async (input: CreateAppChatInput) => {
    try {
      return await createAppChatViaClient(input);
    } catch (cause) {
      toast.error(t("chat.provider.appSaveFailed", { message: errorMessage(cause) }));
      throw cause;
    }
  }, [t]);

  const appendMessage = useCallback(
    async (input: AppendChatMessageInput) => {
      try {
        return await appendChatMessage(input);
      } catch (cause) {
        toast.error(
          t("chat.provider.messageSaveFailed", { message: errorMessage(cause) })
        );
        throw cause;
      }
    },
    [t]
  );

  const renameChat = useCallback(async (input: RenameChatInput) => {
    try {
      return await renameChatViaClient(input);
    } catch (cause) {
      toast.error(t("chat.provider.renameFailed", { message: errorMessage(cause) }));
      throw cause;
    }
  }, [t]);

  const archiveChat = useCallback(async (chatId: string) => {
    try {
      await archiveTargets([{ kind: "chat", id: chatId }]);
    } catch (cause) {
      toast.error(t("chat.provider.archiveFailed", { message: errorMessage(cause) }));
      throw cause;
    }
  }, [t]);

  const deleteChat = useCallback(async (chatId: string) => {
    try {
      await deleteChatViaClient(chatId);
    } catch (cause) {
      toast.error(t("chat.provider.deleteFailed", { message: errorMessage(cause) }));
      throw cause;
    }
  }, [t]);

  const value = useMemo<ChatsContextValue>(
    () => ({
      chats,
      warning,
      storageFailures,
      loading,
      createChat,
      createAppChat,
      appendMessage,
      getChat: getChatViaClient,
      renameChat,
      archiveChat,
      deleteChat,
    }),
    [appendMessage, archiveChat, chats, createAppChat, createChat, deleteChat, loading, renameChat, storageFailures, warning]
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
