/**
 * [INPUT]: Message text, localized fold labels and host-owned attachment/action slots.
 * [OUTPUT]: ConversationUser, the same bubble for pending and canonical messages without source labels.
 * [POS]: Shared user-message presentation; persistence and attachment access stay in adapters.
 */
import type { ReactNode } from "react";
import { Message, MessageContent, MessageResponse } from "@ai-chat/ui/components/ai-elements/message";
import { ConversationFold } from "@ai-chat/ui/components/conversation/fold";
export function ConversationUser({ content, showMore, showLess, attachments, actions }: {
  content: string; showMore: string; showLess: string; attachments?: ReactNode; actions?: ReactNode;
}) {
  return <Message from="user">{attachments}{content && <MessageContent className="gap-1">
    <ConversationFold measurementKey={content} showMore={showMore} showLess={showLess}><MessageResponse>{content}</MessageResponse></ConversationFold>
  </MessageContent>}{actions}</Message>;
}
