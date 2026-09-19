/**
 * [INPUT]: Shared ChatMessage, TurnDraft and current native Subagent projections.
 * [OUTPUT]: ConversationImageProjection and a narrow main-draft image key; retained Subagent tabs reuse the current projection after port changes.
 * [POS]: The contract for the transcription of images from chat/side-panel/image; Do not enter the Base Gallery, durable Gallery only read Base rows
 */

import type { TurnDraft } from "../../../../../shared/chat-turn-reducer";
import type { ChatMessage } from "../../../../../shared/chats-ipc";
import type { ProjectedSubagent } from "@/lib/chat-turn-attach";

export type ConversationImageProjection = {
  chatId: string;
  canonicalMessages: ChatMessage[];
  subagents?: Record<string, ProjectedSubagent>;
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
