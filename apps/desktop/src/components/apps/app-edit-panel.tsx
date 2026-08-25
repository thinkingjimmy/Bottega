"use client";

/**
 * [INPUT]: Depends on React status, AgentBackendId, Apps/Chats Provider, ChatView fixed-app edit roles and AppEditPanelShell
 * [OUTPUT]: Provides AppEditPanel; Restore the durable edit slot when only opened, and change the new draft to the same main original language after it is deleted
 * [POS]: The app module is a permanent single editing session sidebar; Canonical chat is created only with the first message
 */

import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { useChats } from "@/components/providers/chats-provider";
import { useApps } from "@/components/providers/apps-provider";
import { errorMessage } from "@/lib/errors";
import type { AgentBackendId } from "../../../shared/agent-ipc";
import { AppEditPanelShell } from "./app-edit-panel-shell";

const ChatView = lazy(() =>
  import("@/components/chat/chat-view").then((module) => ({
    default: module.ChatView,
  }))
);

function AppEditChat({
  appId,
  appName,
  defaultAgent,
}: {
  appId: string;
  appName: string;
  defaultAgent: AgentBackendId;
}) {
  const { chats, loading } = useChats();
  const { ensureChatSlot } = useApps();
  const [conversationId, setConversationId] = useState("");
  const [error, setError] = useState("");
  const wasPersisted = useRef(false);

  useEffect(() => {
    let active = true;
    void ensureChatSlot({
      appId,
      role: "edit",
      requestId: crypto.randomUUID(),
    })
      .then((slot) => {
        if (active) setConversationId(slot.id);
      })
      .catch((cause) => {
        if (active) setError(errorMessage(cause, "编辑 chat 恢复失败"));
      });
    return () => {
      active = false;
    };
  }, [appId, ensureChatSlot]);

  useEffect(() => {
    if (!conversationId) return;
    if (loading) return;
    const exists = chats.some((chat) => chat.id === conversationId);
    if (exists) {
      wasPersisted.current = true;
      return;
    }
    if (!wasPersisted.current) return;
    wasPersisted.current = false;
    void ensureChatSlot({
      appId,
      role: "edit",
      requestId: crypto.randomUUID(),
    })
      .then((slot) => setConversationId(slot.id))
      .catch((cause) => setError(errorMessage(cause, "编辑 chat 恢复失败")));
  }, [appId, chats, conversationId, ensureChatSlot, loading]);

  return (
    <>
      <div className="border-b border-sky-500/20 bg-sky-500/5 px-4 py-3">
        <p className="font-semibold text-sky-700 text-sm">
          编辑模式 · {appName}
        </p>
        <p className="text-muted-foreground text-xs">
          这里的讨论只用于修改 App
        </p>
      </div>
      <div className="min-h-0 flex-1">
        {error ? (
          <div className="grid size-full place-items-center p-6 text-destructive text-sm">
            {error}
          </div>
        ) : conversationId ? (
          <Suspense
            fallback={
              <div className="grid size-full place-items-center text-muted-foreground text-sm">
                正在载入编辑 chat…
              </div>
            }
          >
            <ChatView
              key={conversationId}
              scope={{ conversationId }}
              project={{ kind: "fixed-app", appId, appRole: "edit" }}
              draftAgent={defaultAgent}
              emptyTitle={`编辑 ${appName}`}
              emptyDescription="此会话会保留编辑历史；只有 Web App 的编辑 turn 会触发重建。"
              enableSidePanel={false}
            />
          </Suspense>
        ) : (
          <div className="grid size-full place-items-center text-muted-foreground text-sm">
            正在恢复编辑 chat…
          </div>
        )}
      </div>
    </>
  );
}

export function AppEditPanel({
  open,
  appId,
  appName,
  defaultAgent,
}: {
  open: boolean;
  appId: string;
  appName: string;
  defaultAgent: AgentBackendId;
}) {
  return (
    <AppEditPanelShell
      open={open}
      renderContent={() => (
        <AppEditChat
          appId={appId}
          appName={appName}
          defaultAgent={defaultAgent}
        />
      )}
    />
  );
}
