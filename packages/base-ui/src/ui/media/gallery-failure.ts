/**
 * [INPUT]: Depends on Gallery media and attachment error contracts and shared IPC error classification.
 * [OUTPUT]: Provides galleryFailureCopyKey with exhaustive refusal copy and a safe fallback for unknown diagnostics.
 * [POS]: Shared Gallery presentation boundary for previews, selection, comments and automatic ingestion.
 */
import type { GalleryMediaErrorCode } from "@ai-chat/base-core/attachments/gallery-media-ipc";
import type { BaseAttachmentFailure } from "@ai-chat/base-core/attachments/gallery-attachments";
import { failureCode } from "@ai-chat/ui/lib/errors";

type GalleryCode = GalleryMediaErrorCode | BaseAttachmentFailure["error"]["code"]
  | "GALLERY_SELECTION_STALE" | "ATTACHMENT_LIMIT" | "AGENT_INPUT_LIMIT" | "COMMENT_TEXT_LIMIT";

const COPY = {
  OUT_OF_WORKSPACE: "outsideWorkspace",
  INCARNATION_MISMATCH: "contextChanged",
  SOURCE_GONE: "sourceUnavailable",
  SOURCE_LOCAL_ONLY: "onlyOnSource",
  CACHE_PENDING: "syncing",
  BUDGET_EXCEEDED: "resourceLimit",
  UNSUPPORTED_FORMAT: "unsupportedFormat",
  INVALID_IMAGE: "invalidImage",
  TOO_LARGE: "tooLarge",
  DECODE_TIMEOUT: "decodeTimeout",
  QUEUE_FULL: "queueFull",
  IO_ERROR: "readFailed",
  ATTACHMENT_CONFLICT: "attachmentConflict",
  ATTACHMENT_NOT_FOUND: "sourceUnavailable",
  DECODE_FAILED: "invalidImage",
  EPOCH_MISMATCH: "contextChanged",
  INVALID_INPUT: "invalidInput",
  ATTACHMENT_LIMIT: "attachmentLimit",
  AGENT_INPUT_LIMIT: "inputLimit",
  COMMENT_TEXT_LIMIT: "commentLimit",
  GALLERY_SELECTION_STALE: "invalidInput",
} as const satisfies Record<GalleryCode, string>;

export function galleryFailureCopyKey(cause: unknown): string {
  const code = cause && typeof cause === "object" && "code" in cause && typeof cause.code === "string"
    ? cause.code : failureCode(cause);
  const key = Object.hasOwn(COPY, code) ? COPY[code as GalleryCode] : "actionFailed";
  return `bases.gallery.${key}`;
}
