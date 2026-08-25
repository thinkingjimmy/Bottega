/**
 * [INPUT]: Depends on active TurnDraft and Chat's incarnation/assistant sequence identity
 * [OUTPUT]: Provides Chat image tool draft → The purest projection of ephemeral GalleryItem
 * [POS]: The lightweight boundaries of Gallery mode; The main input only loads this file, and the durable row model continues to be delayed Base chunk
 */

import type {
  DraftPart,
  TurnDraft,
} from "../../../shared/chat-turn-reducer";
import type { GalleryItem } from "./model";

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
