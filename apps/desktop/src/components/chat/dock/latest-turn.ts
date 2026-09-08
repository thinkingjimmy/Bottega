/**
 * [INPUT]: Depends on canonical ChatMessage, active TurnDraft and assistantSeq
 * [OUTPUT]: Provides selectLatestTurn, a pure selector that prefers the active draft when its assistantSeq is newer, otherwise returns the canonical assistant message
 * [POS]: The statusless selector for chat/dock; user/notice/settling Not participating Latest turn
 */

import type { TurnDraft } from "../../../../shared/chat-turn-reducer";
import type {
  AssistantChatMessage,
  ChatMessage,
} from "../../../../shared/chats-ipc";

export type LatestTurn =
  | { kind: "canonical"; message: AssistantChatMessage }
  | { kind: "draft"; draft: TurnDraft; assistantSeq: number };

export function selectLatestTurn(
  messages: readonly ChatMessage[],
  draft: TurnDraft | null,
  assistantSeq?: number
): LatestTurn | null {
  const canonical = messages.findLast(
    (message): message is AssistantChatMessage => message.role === "assistant"
  );
  if (
    draft &&
    assistantSeq !== undefined &&
    (!canonical || assistantSeq > canonical.seq)
  ) {
    return { kind: "draft", draft, assistantSeq };
  }
  return canonical ? { kind: "canonical", message: canonical } : null;
}
