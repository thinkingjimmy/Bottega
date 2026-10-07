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

const GALLERY_ERROR_KEYS = {
  OUT_OF_WORKSPACE: "bases.gallery.outsideWorkspace",
  INCARNATION_MISMATCH: "bases.gallery.contextChanged",
  SOURCE_GONE: "bases.gallery.sourceUnavailable",
  SOURCE_LOCAL_ONLY: "bases.gallery.onlyOnSource",
  CACHE_PENDING: "bases.gallery.syncing",
  BUDGET_EXCEEDED: "bases.gallery.resourceLimit",
  UNSUPPORTED_FORMAT: "bases.gallery.unsupportedFormat",
  INVALID_IMAGE: "bases.gallery.invalidImage",
  TOO_LARGE: "bases.gallery.tooLarge",
  DECODE_TIMEOUT: "bases.gallery.decodeTimeout",
  QUEUE_FULL: "bases.gallery.queueFull",
  IO_ERROR: "bases.gallery.readFailed",
  ATTACHMENT_CONFLICT: "bases.gallery.attachmentConflict",
  ATTACHMENT_NOT_FOUND: "bases.gallery.sourceUnavailable",
  DECODE_FAILED: "bases.gallery.invalidImage",
  EPOCH_MISMATCH: "bases.gallery.contextChanged",
  INVALID_INPUT: "bases.gallery.invalidInput",
  ATTACHMENT_LIMIT: "bases.gallery.attachmentLimit",
  AGENT_INPUT_LIMIT: "bases.gallery.inputLimit",
  COMMENT_TEXT_LIMIT: "bases.gallery.commentLimit",
  GALLERY_SELECTION_STALE: "bases.gallery.invalidInput",
} as const satisfies Record<GalleryCode, string>;

export function galleryFailureCopyKey(cause: unknown): string {
  const code = cause && typeof cause === "object" && "code" in cause && typeof cause.code === "string"
    ? cause.code : failureCode(cause);
  const key = Object.hasOwn(GALLERY_ERROR_KEYS, code) ? GALLERY_ERROR_KEYS[code as GalleryCode] : "bases.gallery.actionFailed";
  return key;
}
