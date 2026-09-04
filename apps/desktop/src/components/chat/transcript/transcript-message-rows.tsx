/**
 * [INPUT]: Depends on canonical user/notice messages, attachment/image projection, localized notice rendering, and shared message actions
 * [OUTPUT]: Provides memoized user and notice transcript rows plus the common message anchor shell
 * [POS]: Static transcript row sibling; assistant turns and transcript window orchestration remain in ChatTranscript
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
} from "../../../../shared/chats-ipc";
import type { ConversationImageSource } from "../runtime/chat-session-model";
import type { LiveAttachmentPreview } from "../runtime/chat-attachments";
import { capMarkdown } from "@/lib/charts/chart-markdown";
import { ChatMessageActions } from "./chat-message-actions";
import { ChatNotice } from "./chat-notice";
import { ChatUserAttachments, UserMessageFold } from "./chat-user-attachments";

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
  return (
    <MessageShell id={message.id}>
      <Message from="user">
        <ChatUserAttachments
          attachments={message.attachments}
          live={live}
          onOpen={incarnationId && onOpenImage
            ? (attachment) => onOpenImage({
                kind: "attachment",
                chatId,
                incarnationId,
                attachment,
              })
            : undefined}
        />
        <UserMessageBody content={message.content} />
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
