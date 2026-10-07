/**
 * [INPUT]: Depends on canonical user/notice messages, the shared origin-free user bubble, attachment/image projection, localized notice rendering, and shared message actions.
 * [OUTPUT]: Provides memoized user and notice transcript rows plus the common message anchor shell
 * [POS]: apps/desktop/src/components/chat/transcript/turns; Static transcript row sibling; assistant turns and transcript window orchestration remain in ChatTranscript
 */

import { memo, type ReactNode } from "react";
import type {
  NoticeChatMessage,
  UserChatMessage,
} from "../../../../../shared/ipc/content/chats-ipc";
import type { ConversationImageSource } from "../../runtime/chat-session-model";
import type { LiveAttachmentPreview } from "../../runtime/files/chat-attachments";
import { capMarkdown } from "@/lib/charts/chart-markdown";
import { ChatMessageActions } from "../navigation/chat-message-actions";
import { ChatNotice } from "../notices/chat-notice";
import { ChatUserAttachments } from "../content/chat-user-attachments";
import { ConversationUser } from "@ai-chat/chat-ui/turn/user";
import { useAppTranslation } from "@/components/providers/preferences/i18n-provider";

export const MessageShell = ({ children, id }: {
  children: ReactNode;
  id: string;
}) => (
  <div className="w-full min-w-0 max-w-full" data-message-id={id} tabIndex={-1}>
    {children}
  </div>
);

export const ChatUserMessage = memo(function ChatUserMessage({
  message,
  live,
  chatId,
  incarnationId,
  onOpenImage,
  onEdit,
  editDisabledReason,
}: {
  message: UserChatMessage;
  live?: LiveAttachmentPreview[];
  chatId: string;
  incarnationId: string | null;
  onOpenImage?: (source: ConversationImageSource) => void;
  onEdit?: () => void;
  editDisabledReason?: string;
}) {
  const { t } = useAppTranslation();
  return (
    <MessageShell id={message.id}>
      <ConversationUser content={capMarkdown(message.content)} showMore={t("chat.transcript.showMore")} showLess={t("chat.transcript.showLess")} attachments={
        <ChatUserAttachments
          attachments={message.attachments}
          chatId={chatId}
          live={live}
          onOpen={incarnationId && onOpenImage
            ? (attachment) => onOpenImage({
                kind: "attachment",
                chatId,
                incarnationId,
                attachment,
                // Only a native row's seq names its position; a local-only row sorts at MAX_SAFE_INTEGER.
                ...(message.segment !== "imported" && message.seq < Number.MAX_SAFE_INTEGER ? { seq: message.seq } : {}),
              })
            : undefined}
        />
      } actions={
        <ChatMessageActions
          content={message.content}
          createdAt={message.createdAt}
          onEdit={onEdit}
          editDisabledReason={editDisabledReason}
          role="user"
        />
      } />
    </MessageShell>
  );
});

export const ChatNoticeRow = memo(function ChatNoticeRow({
  message,
}: {
  message: NoticeChatMessage;
}) {
  if (message.notice.kind === "app-chat-ready") return null;
  return (
    <MessageShell id={message.id}>
      <ChatNotice message={message} />
    </MessageShell>
  );
});
