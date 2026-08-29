/**
 * [INPUT]: Depends on Apps ensureChatSlot, optional Chats/Projects providers, AppRecord, and canonical Chat lookup
 * [OUTPUT]: Provides useAppUseChat with one durable canonical use-chat identity, incarnation hydration, and explicit recovery after deletion
 * [POS]: Apps renderer identity adapter shared by the main-page dock and App-window dock; moving the surface never creates a second conversation
 */

import { useEffect, useRef, useState } from "react";
import { useApps } from "@/components/providers/apps-provider";
import { useOptionalChats } from "@/components/providers/chats-provider";
import { useOptionalProjects } from "@/components/providers/projects-provider";
import { errorMessage } from "@/lib/errors";
import { getChat } from "@/lib/chats-client";
import type { AppRecord } from "../../../shared/apps-ipc";

/* active = 这个 App 此刻要不要一个使用会话，而不是"哪一栏开着"。
   身份与呈现分家的意义全在这一个参数上：栏↔dock 互换时 active 恒为
   true，槽位不重取、chatId 不跳变，用户看到的是同一段对话换了个位置。 */
export function useAppUseChat(record: AppRecord, active: boolean) {
  const { ensureChatSlot } = useApps();
  const chatsContext = useOptionalChats();
  const projectsContext = useOptionalProjects();
  const chats = chatsContext?.chats ?? [];
  const chatsLoading = chatsContext?.loading ?? false;
  const projects = projectsContext?.projects ?? [];
  const [chatId, setChatId] = useState(record.activeUseChatSlot?.id ?? "");
  const [incarnation, setIncarnation] = useState({ chatId: "", value: "" });
  const [error, setError] = useState("");

  useEffect(() => {
    if (!active) return;
    let alive = true;
    void ensureChatSlot({
      appId: record.id,
      role: "use",
      requestId: crypto.randomUUID(),
    })
      .then((slot) => {
        if (alive) setChatId(slot.id);
      })
      .catch((cause) => {
        if (alive) setError(errorMessage(cause, "使用 chat 创建失败"));
      });
    return () => {
      alive = false;
    };
  }, [active, ensureChatSlot, record.id]);

  const projectId = projects.find(
    (project) =>
      project.workspaceBinding.kind === "app" &&
      project.workspaceBinding.appId === record.id
  )?.id;
  const useChats = chats.filter(
    (chat) => chat.projectId === projectId && chat.appRole === "use"
  );
  const hasCurrent = useChats.some((chat) => chat.id === chatId);
  const persistedChatRef = useRef("");

  useEffect(() => {
    if (!chatId) return;
    let alive = true;
    void getChat(chatId).then((chat) => {
      if (alive) setIncarnation({ chatId, value: chat?.incarnationId ?? "" });
    });
    return () => {
      alive = false;
    };
  }, [chatId, hasCurrent]);

  useEffect(() => {
    if (!active || chatsLoading || !chatId) return;
    if (hasCurrent) {
      persistedChatRef.current = chatId;
      return;
    }
    /* 自愈只问挂载者自己：「当前 chatId 曾被观察到持久化、现在消失了」才换新。
     * 问槽位状态是错的——Select 切换后 chatId 可与槽位脱钩（槽位是 draft、
     * 挂载的却是刚被删掉的历史 canonical chat），继续挂着等于往已删除的
     * conversation id 里写字。草稿本来就不在列表里，不触发自愈。 */
    if (persistedChatRef.current !== chatId) return;
    persistedChatRef.current = "";
    void ensureChatSlot({
      appId: record.id,
      role: "use",
      requestId: crypto.randomUUID(),
    })
      .then((slot) => setChatId(slot.id))
      .catch((cause) => setError(errorMessage(cause, "使用 chat 恢复失败")));
  }, [active, chatId, chatsLoading, ensureChatSlot, hasCurrent, record.id]);

  const createNew = () => {
    setError("");
    void ensureChatSlot({
      appId: record.id,
      role: "use",
      mode: "new",
      requestId: crypto.randomUUID(),
    })
      .then((slot) => setChatId(slot.id))
      .catch((cause) => setError(errorMessage(cause, "使用 chat 创建失败")));
  };

  return {
    chatId,
    incarnationId: incarnation.chatId === chatId ? incarnation.value : "",
    error,
    chats: useChats,
    hasCurrent,
    createNew,
    select: setChatId,
  };
}

export type AppUseChat = ReturnType<typeof useAppUseChat>;
