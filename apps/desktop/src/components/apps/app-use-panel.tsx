"use client";

/**
 * [INPUT]: Depends on React lazy/Suspense, use AppUseChat, session name given, cross-page header form of the AppSidePanel, ChatView, fixed-app use role
 * [OUTPUT]: Provides AppUsePanel; When changing history or newly created chat, re-attach ChatView by clicking on the chatId, or you can also upload the session to the bottom dock
 * [POS]: Base App uses the default form of the session; ChatView key is the renderer generation boundary, the session identity is used by AppUseChat, the geometry and resize are assigned to AppSidePanel
 */

import { lazy, Suspense } from "react";
import { PanelBottomIcon, PlusIcon } from "lucide-react";
import { Button } from "@ai-chat/ui/components/ui/button";
import { cn } from "@ai-chat/ui/lib/utils";
import { panelChromeClassName } from "@/components/page-shell";
import type { AppRecord } from "../../../shared/apps-ipc";
import type { AppUseChat } from "./use-app-use-chat";
import { AppSidePanel } from "./app-side-panel";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@ai-chat/ui/components/ui/select";

const ChatView = lazy(() =>
  import("@/components/chat/chat-view").then((module) => ({
    default: module.ChatView,
  }))
);

export function AppUsePanel({
  open,
  record,
  chat,
  onClose,
  onDock,
}: {
  open: boolean;
  record: AppRecord;
  chat: AppUseChat;
  onClose: () => void;
  onDock: () => void;
}) {
  const { chatId, error, chats, hasCurrent, createNew, select } = chat;

  return (
    <AppSidePanel
      closeLabel="收起使用栏"
      header={
        <>
          {/* 与页头右上角的 PanelRight 成对：那颗说「放在右栏」，这颗说「放到底部」。
              同一族图标承担同一件事的两个去处，方向就是全部语义。 */}
          <Button
            aria-label="把使用 chat 停靠到底部"
            className={cn("[-webkit-app-region:no-drag]", panelChromeClassName)}
            onClick={onDock}
            size="icon-lg"
            title="停靠到底部：收起本栏，输入框悬浮在 App 底部"
            type="button"
            variant="ghost"
          >
            <PanelBottomIcon />
          </Button>
          {/* 会话选择器就是这条头部唯一的主控件：面板身份由 App 页头与空态各说一遍
              就够了，标题不必在同一屏说第三遍。 */}
          <div className="min-w-0 flex-1 [-webkit-app-region:no-drag]">
            {chatId ? (
              <Select onValueChange={select} value={chatId}>
                <SelectTrigger
                  aria-label="切换使用 chat"
                  className="max-w-full border-0 bg-transparent px-2 font-medium text-sm shadow-none hover:bg-accent"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {!hasCurrent && (
                    /* 不写「未发送」：草稿与已存会话在这张列表里本就无从混淆，
                       而「新对话」三个字已经说完了它是什么。 */
                    <SelectItem value={chatId}>新对话</SelectItem>
                  )}
                  {chats.map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {item.title ?? "标题生成中"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <p className="truncate px-2 font-medium text-sm">
                使用 {record.displayName}
              </p>
            )}
          </div>
          <Button
            aria-label="新建使用 chat"
            className={cn("[-webkit-app-region:no-drag]", panelChromeClassName)}
            onClick={createNew}
            size="icon-lg"
            title="新建使用 chat"
            type="button"
            variant="ghost"
          >
            <PlusIcon />
          </Button>
        </>
      }
      onClose={onClose}
      open={open}
      railHint="拖动或使用方向键调整使用 chat 宽度"
      railLabel="调整使用 chat 宽度"
    >
      {error ? (
        <div className="grid size-full place-items-center p-6 text-destructive text-sm">
          {error}
        </div>
      ) : chatId ? (
        <Suspense
          fallback={
            <div className="grid size-full place-items-center text-muted-foreground text-sm">
              正在载入使用 chat…
            </div>
          }
        >
          <ChatView
            key={chatId}
            draftAgent={record.agent}
            emptyDescription="输入一条典型数据，Agent 会按已生成的 App skill 录入 Base。"
            emptyTitle={`使用 ${record.displayName}`}
            enableSidePanel={false}
            project={{
              kind: "fixed-app",
              appId: record.id,
              appRole: "use",
            }}
            scope={{ conversationId: chatId }}
          />
        </Suspense>
      ) : (
        <div className="grid size-full place-items-center text-muted-foreground text-sm">
          正在准备使用 chat…
        </div>
      )}
    </AppSidePanel>
  );
}
