/**
 * [INPUT]: Depends on React, App i18n, ChatSessionController, latest-turn selector, TurnParts/MessageResponse, and ChatComposer
 * [OUTPUT]: Provides ChatSessionDock: The Latest turn tabs for the real hanging composer and the latest turn tabs for the input card
 * [POS]: The only source of the chat/dock's floating form; No session, no contamination of the Base, the host decides who is covered by it
 */

import { useMemo, useState } from "react";
import { ChevronUpIcon } from "lucide-react";
import { MessageResponse } from "@ai-chat/ui/components/ai-elements/message";
import { ChatComposer } from "../composer/chat-composer";
import type { ChatSessionController } from "../runtime/use-chat-session";
import { TurnParts } from "../transcript/chat-turn";
import { selectLatestTurn } from "./latest-turn";
import { SlimScroller } from "@ai-chat/ui/components/ui/slim-scroller";
import { useAppTranslation } from "@/components/providers/i18n-provider";

/* dock 只负责定位与列宽：卡片形态归 Composer 自己的输入组，内外各画一圈
   圆角边框只会让边界重影；左右下留白也由 Composer 的 p-4 单独供给。
   容器本身对指针透明，只有两张卡接管点击，被盖住的视图不被空白挡住。
   定位锚点是宿主最近的 relative 祖先——dock 不自建，谁盖谁自己声明。 */
export function ChatSessionDock({
  chatId,
  controller,
}: {
  chatId: string;
  controller: ChatSessionController;
}) {
  const { t } = useAppTranslation();
  const [latestOpen, setLatestOpen] = useState(false);
  const latest = useMemo(
    () =>
      selectLatestTurn(
        controller.transcript.messages,
        controller.transcript.draft,
        controller.transcript.assistantSeq
      ),
    [
      controller.transcript.assistantSeq,
      controller.transcript.draft,
      controller.transcript.messages,
    ]
  );

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-40 mx-auto w-full max-w-3xl [&_[data-slot=input-group]]:shadow-xl">
      {latest && (
        /* 与 Composer 的 Project/Branch 条同族：mx-7 = 输入卡再内收 12px，-mb-px 让
           接缝被输入卡自己的边框吃掉，z-0 沉到输入卡（z-10）之下，成为它的页签。 */
        <section className="pointer-events-auto relative z-0 mx-7 -mb-px overflow-hidden rounded-t-2xl bg-muted shadow-xl">
          <button
            aria-expanded={latestOpen}
            aria-label={t(
              latestOpen
                ? "chat.dock.collapseLatest"
                : "chat.dock.expandLatest"
            )}
            className="flex min-h-11 w-full items-center gap-2 px-4 text-left font-medium text-xs"
            onClick={() => setLatestOpen((value) => !value)}
            type="button"
          >
            <span className="min-w-0 flex-1">{t("chat.dock.latestTurn")}</span>
            {!latestOpen && latest.kind === "draft" && (
              <span
                aria-label={t("chat.dock.newReply")}
                className="size-2 rounded-full bg-primary"
              />
            )}
            {/* 页签朝上长：收起时指上（拉开），展开时指下（收回）。
                箭头永远指向点击后内容去的方向，与折叠面板向下展开相反。 */}
            <ChevronUpIcon
              className={`size-4 transition-transform motion-reduce:transition-none ${latestOpen ? "rotate-180" : ""}`}
            />
          </button>
          {latestOpen && (
            <SlimScroller className="max-h-56 overflow-y-auto border-t px-4 py-3 text-sm">
              {latest.kind === "canonical" ? (
                <>
                  <TurnParts
                    imageSourceRef={(itemId) =>
                      controller.transcript.incarnationId
                        ? {
                            kind: "transcript",
                            chatId,
                            incarnationId: controller.transcript.incarnationId,
                            assistantSeq: latest.message.seq,
                            itemId,
                          }
                        : null
                    }
                    parts={latest.message.parts ?? []}
                    subagents={controller.transcript.subagents}
                  />
                  <MessageResponse>{latest.message.content}</MessageResponse>
                </>
              ) : (
                <TurnParts
                  imageSourceRef={(itemId) =>
                    controller.transcript.incarnationId
                      ? {
                          kind: "transcript",
                          chatId,
                          incarnationId: controller.transcript.incarnationId,
                          assistantSeq: latest.assistantSeq,
                          itemId,
                        }
                      : null
                  }
                  parts={latest.draft.parts}
                  streamingIds={new Set(latest.draft.streaming.keys())}
                  subagents={controller.transcript.subagents}
                />
              )}
            </SlimScroller>
          )}
        </section>
      )}
      <div className="pointer-events-auto">
        <ChatComposer
          collapseWhenIdle
          controller={controller.composer}
          enableSidePanel={false}
        />
      </div>
    </div>
  );
}
