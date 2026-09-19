/**
 * [INPUT]: Depends on active TurnDraft and Chat's incarnation/assistant sequence identity
 * [OUTPUT]: Provides projectRunningGalleryItems, a pure projection from a Chat image-tool draft to ephemeral GalleryItems
 * [POS]: The lightweight half of Gallery-item sourcing; the main render path only imports this file, while the durable row model loads separately once its Base chunk resolves
 */

import type {
  DraftPart,
  TurnDraft,
} from "../../../shared/chat-turn-reducer";
import type { GalleryItem } from "@ai-chat/base-ui/ui/media/model";

export function projectRunningGalleryItems(input: {
  chatId: string;
  incarnationId: string | null;
  assistantSeq?: number;
  draft: {
    startedAt: number;
    parts: readonly DraftPart[];
    streaming?: TurnDraft["streaming"];
  } | null;
}): GalleryItem[] {
  if (!input.draft || input.assistantSeq === undefined) return [];
  const draft = input.draft;
  return draft.parts.flatMap((part): GalleryItem[] => {
    if (part.type !== "tool" || part.tool !== "image") return [];
    const logicalKey = [
      "transcript",
      input.chatId,
      input.incarnationId ?? "pending",
      input.assistantSeq,
      part.itemId,
    ].join(":");
    return [
      {
        phase: "running",
        id: `overlay:${logicalKey}`,
        logicalKey,
        occurredAt: draft.startedAt,
        ...(part.status === "failed" ? { failed: true } : {}),
      },
    ];
  });
}
