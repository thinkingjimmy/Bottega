/**
 * [INPUT]: Depends on canonical assistant message and chart Markdown quota projection
 * [OUTPUT]: Provides projectAssistantTurn, which converts the text/parts into a translatable message at once
 * [POS]: The first is the free-to-play chat/transcriptChatTurn only quotes memo by message, not component weight
 */

import type { AssistantChatMessage } from "../../../../shared/chats-ipc";
import { capPartMarkdown } from "@/lib/charts/chart-markdown";

export function projectAssistantTurn(
  message: AssistantChatMessage
): AssistantChatMessage {
  const projection = capPartMarkdown(
    message.parts ?? [],
    [{ id: "content", markdown: message.content }]
  );
  return {
    ...message,
    content: projection.fragments[0]?.markdown ?? message.content,
    ...(message.parts ? { parts: projection.parts } : {}),
  };
}
