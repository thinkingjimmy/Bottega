/**
 * [INPUT]: Depends on canonical user/notice messages, remote source copy, attachment/image projection, localized notice rendering, and shared message actions.
 * [OUTPUT]: Provides memoized user and notice transcript rows plus the common message anchor shell
 * [POS]: apps/desktop/src/components/chat/transcript/turns; Static transcript row sibling; assistant turns and transcript window orchestration remain in ChatTranscript
 */

import { memo, type ReactNode } from "react";
import {
  Message,
  MessageContent,
  MessageResponse,
} from "@ai-chat/ui/components/ai-elements/message";
import type {
  NoticeChatMessage,
  UserChatMessage,
} from "../../../../../shared/ipc/content/chats-ipc";
import type { ConversationImageSource } from "../../runtime/chat-session-model";
import type { LiveAttachmentPreview } from "../../runtime/files/chat-attachments";
import { capMarkdown } from "@/lib/charts/chart-markdown";
import { ChatMessageActions } from "../navigation/chat-message-actions";
import { ChatNotice } from "../notices/chat-notice";
import { ChatUserAttachments, UserMessageFold } from "../content/chat-user-attachments";
import { remoteCopy } from "@ai-chat/chat-ui/remote-copy";
import { useAppTranslation } from "@/components/providers/preferences/i18n-provider";

export const MessageShell = ({ children, id }: {
  children: ReactNode;
  id: string;
}) => (
  <div className="w-full min-w-0 max-w-full" data-message-id={id} tabIndex={-1}>
    {children}
  </div>
);

function UserMessageBody({ content }: { content: string }) {
  return (
    <MessageContent className="gap-1">
      <UserMessageFold measurementKey={content}>
        <MessageResponse>{capMarkdown(content)}</MessageResponse>
      </UserMessageFold>
    </MessageContent>
  );
}

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
  const { i18n } = useAppTranslation();
  return (
    <MessageShell id={message.id}>
      <Message from="user">
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
        <UserMessageBody content={message.content} />
        {message.remoteSource && <span className="text-xs text-muted-foreground" aria-label={remoteCopy(i18n.language).from.replace("{device}", message.remoteSource.name)}>{remoteCopy(i18n.language).from.replace("{device}", message.remoteSource.name)}</span>}
        <ChatMessageActions
          content={message.content}
          createdAt={message.createdAt}
          onEdit={onEdit}
          editDisabledReason={editDisabledReason}
          role="user"
        />
      </Message>
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
