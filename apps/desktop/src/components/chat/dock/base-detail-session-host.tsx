/**
 * [INPUT]: Depends on single useChatSession, BaseWorkbench, ChatSessionDock and active-chat store
 * [OUTPUT]: Provides full-screen BaseDetailSessionHost: Drive Base with independent owner key, insert the Composer chat identity, and give the pending form to ChatSessionDock
 * [POS]: The full-screen host of the chat/dock's Base chat; The Base owner and the carrying session are still the only session shared by the workbench and dock
 */

import { useEffect } from "react";
import { BaseWorkbench } from "@/components/bases/base-workbench";
import { claimActiveChat } from "@/lib/chat-activity-store";
import { useChatSession } from "../runtime/use-chat-session";
import { ChatSessionDock } from "./chat-session-dock";

export function BaseDetailSessionHost({
  ownerKey,
  chatId,
}: {
  ownerKey: string;
  chatId: string;
}) {
  /* 只声明「可挑 Project」，不谈是哪一个：本宿主承载的永远是已落盘会话，
     workspace scope 由 record 决定（chatWorkspaceScope 此时返回 conversation）。
     路由改写 Project 的通道只对当前待发草稿槽开放，真会话够不着。 */
  const controller = useChatSession({
    scope: { conversationId: chatId },
    project: { kind: "selectable" },
  });
  // 声明栈：本宿主与 chat 视图各自声明、各自撤销，卸载不再互踩对方的活跃态。
  useEffect(() => claimActiveChat(chatId), [chatId]);

  return (
    <div className="relative h-full min-h-0 overflow-hidden">
      {/* Base 铺满全高，dock 真悬浮其上：给底部留白等于把输入框「架」在视图之外，
          那是 dock 不是悬浮。视图自己的底栏因此始终贴着窗口底缘。 */}
      <div className="h-full min-h-0">
        <BaseWorkbench
          ownerKey={ownerKey}
          attachmentOwner={
            controller.transcript.incarnationId
              ? {
                  chatId,
                  incarnationId: controller.transcript.incarnationId,
                }
              : undefined
          }
        />
      </div>
      <ChatSessionDock chatId={chatId} controller={controller} />
    </div>
  );
}
