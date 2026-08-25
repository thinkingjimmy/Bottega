/**
 * [INPUT]: Depends on the Apps Provider's ensureChatSlot, Chats/Projects Provider and AppRecord are available
 * [OUTPUT]: Provides useAppUseChat: durable use Slopes analysis, list of historical use chat of the App, delete self-creation and open re-creation
 * [POS]: The apps module is a single source of "chat identity"; The two types of dock and the co-host present the same identity, changing form without changing session
 */

import { useEffect, useRef, useState } from "react";
import { useApps } from "@/components/providers/apps-provider";
import { useOptionalChats } from "@/components/providers/chats-provider";
import { useOptionalProjects } from "@/components/providers/projects-provider";
import { errorMessage } from "@/lib/errors";
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

  return { chatId, error, chats: useChats, hasCurrent, createNew, select: setChatId };
}

export type AppUseChat = ReturnType<typeof useAppUseChat>;
