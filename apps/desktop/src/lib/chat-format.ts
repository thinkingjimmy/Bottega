/**
 * [INPUT]: Depends on shared conversation duration/heading formatting and the renderer's current Intl locale; AssistantChatMessage is a type-only import
 * [OUTPUT]: Provides formatMessageTime, formatDuration, and workedForLabel (null for headless turns; imported turns with process rows but no source duration fall back to the plain "Worked for" label)
 * [POS]: Pure chat-timestamp/duration formatting functions in lib, consumed by ChatTurn; independent of React
 */

import type { AssistantChatMessage } from "../../shared/chats-ipc";
import { effectiveLocale, intlLocale } from "./i18n-locale";
import { conversationWorkedFor, formatConversationDuration } from "@ai-chat/ui/components/conversation/activity/format";

export const formatMessageTime = (createdAt: number) =>
  new Intl.DateTimeFormat(intlLocale(), {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(createdAt));

export const formatDuration = (ms: number) => formatConversationDuration(ms, intlLocale());
export function workedForLabel(message: AssistantChatMessage): string | null {
  return conversationWorkedFor({ durationMs: message.durationMs, isError: message.isError, hasParts: Boolean(message.parts?.length), imported: message.segment === "imported" }, effectiveLocale());
}
