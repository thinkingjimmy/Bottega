"use client";

/**
 * [INPUT]: Depends on useChatSession's fixed-app chat controller and chat/dock's ChatSessionDock
 * [OUTPUT]: Provides AppUseDock, which renders the App Use chat session as a floating dock input bar over the Base surface
 * [POS]: Dock counterpart to the App Use session; shares the same chatId as AppUseChat
 */

import { ChatSessionDock } from "@/components/chat/dock/chat-session-dock";
import { useChatSession } from "@/components/chat/runtime/use-chat-session";
import type { AgentBackendId } from "../../../../shared/agent-ipc";

/* 与全屏 Base 的 dock 逐字同一个组件：那边盖住整页 Base，这边盖住 App 主体。
   悬浮不给 Base 留位——给底部留白等于把输入框「架」在视图之外，那是 dock
   不是悬浮。定位锚点由宿主的 relative 主体提供，本组件不自建。 */
export function AppUseDock({
  appId,
  chatId,
  draftAgent,
}: {
  appId: string;
  chatId: string;
  draftAgent: AgentBackendId;
}) {
  const controller = useChatSession({
    scope: { conversationId: chatId },
    project: { kind: "fixed-app", appId, appRole: "use" },
    draftAgent,
  });
  return <ChatSessionDock chatId={chatId} controller={controller} />;
}
