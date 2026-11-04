/**
 * [INPUT]: Message text, localized fold labels and host-owned attachment/action slots.
 * [OUTPUT]: ConversationUser, the same bubble for pending and canonical messages with frozen instruction/target rendering.
 * [POS]: Shared user-message presentation; persistence and attachment access stay in adapters.
 */
import { ArtifactMessageRenderers } from "../../../artifacts/renderer";
import type { ReactNode } from "react";
import { Message, MessageContent, MessageResponse } from "@ai-chat/ui/components/ai-elements/message";
import { ConversationFold } from "@ai-chat/ui/components/conversation/fold";
export function ConversationUser({ content, showMore, showLess, attachments, actions }: {
  content: string; showMore: string; showLess: string; attachments?: ReactNode; actions?: ReactNode;
}) {
  return <Message from="user">{attachments}{content && <MessageContent className="gap-1">
    <ConversationFold measurementKey={content} showMore={showMore} showLess={showLess}><ArtifactMessageRenderers><MessageResponse>{content}</MessageResponse></ArtifactMessageRenderers></ConversationFold>
  </MessageContent>}{actions}</Message>;
}
