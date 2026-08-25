/**
 * [INPUT]: Depends on shared ChatMessage and TurnDraft; Receiving canonical transcript replacement and only active draft
 * [OUTPUT]: Provides ConversationImageProjection with a narrow draft DTO/key with only itemId/status/title/startedAt, for the image tab to parse the running/completed transcript image
 * [POS]: The contract for the transcription of images from chat/side-panel/image; Do not enter the Base Gallery, durable Gallery only read Base rows
 */

import type { TurnDraft } from "../../../../../shared/chat-turn-reducer";
import type { ChatMessage } from "../../../../../shared/chats-ipc";

export type ConversationImageProjection = {
  chatId: string;
  canonicalMessages: ChatMessage[];
  draft: ConversationImageDraft | null;
  assistantSeq?: number;
  incarnationId: string | null;
  hydrated: boolean;
};

export type ConversationImageDraft = {
  startedAt: number;
  parts: Array<{
    itemId: string;
    type: "tool";
    tool: "image";
    status: "running" | "completed" | "failed";
    title: string;
  }>;
};

export function conversationImageDraftKey(draft: TurnDraft | null) {
  if (!draft) return "";
  return JSON.stringify({
    startedAt: draft.startedAt,
    parts: draft.parts.flatMap((part) =>
      part.type === "tool" && part.tool === "image"
        ? [{
            itemId: part.itemId,
            status: part.status,
            title: part.title,
          }]
        : []
    ),
  });
}

export function projectConversationImageDraft(
  key: string
): ConversationImageDraft | null {
  if (!key) return null;
  const value = JSON.parse(key) as Omit<ConversationImageDraft, "parts"> & {
    parts: Array<Omit<ConversationImageDraft["parts"][number], "type" | "tool">>;
  };
  return {
    startedAt: value.startedAt,
    parts: value.parts.map((part) => ({
      ...part,
      type: "tool",
      tool: "image",
    })),
  };
}
