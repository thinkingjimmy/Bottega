/**
 * [INPUT]: Depends on stable Sketch error markers, shared Gallery refusal mapping and current locale translation.
 * [OUTPUT]: Provides localized Sketch failures, a failed send preparation's localized message (sendPreparationMessage), and cross-window migration error normalization.
 * [POS]: Shared projection for composer, editor, queue, and migration initiators.
 */
import { galleryFailureCopyKey } from "@ai-chat/base-ui/ui/media/gallery-failure";
import { effectiveLocale } from "../appearance/i18n-locale";
import { translate } from "../../../shared/i18n/runtime";
/**
 * What a send whose preparation failed says (freezeGalleryDraft's coded refusals, or anything else it threw). A code with existing
 * copy reads its own sentence; every other failure, a schema rejection included, reads the generic one. The thrown messages are
 * never shown: a backend diagnostic can include paths, and a schema rejection carries its issue list. The caller logs the raw cause.
 */
export function sendPreparationMessage(error: unknown): string {
  const locale = effectiveLocale();
  const code = typeof error === "object" && error !== null && "code" in error ? String((error as { code: unknown }).code) : "";
  if (code === "ATTACHMENT_LIMIT") return translate(locale, "sketch.attachmentLimit");
  if (code === "EPOCH_MISMATCH") return translate(locale, "agentAvailability.imagesPreserved");
  const key = galleryFailureCopyKey(error);
  return translate(locale, key === "bases.gallery.actionFailed" ? "ui.submissionFailed" : key);
}

export function sketchErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const locale = effectiveLocale();
  if (message.includes("SKETCH_EDITOR_ACTIVE"))
    return translate(locale, "sketch.editorActive");
  if (message.includes("COMPOSER_MIGRATION_ACTIVE"))
    return translate(locale, "sketch.migrationActive");
  switch (message) {
    case "SKETCH_SOURCE_MISSING":
    case "SKETCH_INVALID_SOURCE":
      return translate(locale, "sketch.sourceMissing");
    case "SKETCH_OWNER_EXPIRED":
      return translate(locale, "sketch.ownerExpired");
    case "SKETCH_READ_ONLY":
      return translate(locale, "sketch.readOnly");
    case "SKETCH_VERSION_CHANGED":
      return translate(locale, "sketch.versionChanged");
    case "SKETCH_ATTACHMENT_LIMIT":
      return translate(locale, "sketch.attachmentLimit");
    case "SKETCH_IMAGE_TOO_LARGE":
      return translate(locale, "sketch.imageTooLarge");
    case "SKETCH_BUDGET":
      return translate(locale, "sketch.budget");
    case "SKETCH_RESIZE_BUDGET":
      return translate(locale, "sketch.resizeBudget");
    case "SKETCH_ERASE_BUDGET":
      return translate(locale, "sketch.eraseBudget");
    case "SKETCH_EMPTY":
      return translate(locale, "sketch.empty");
    case "SKETCH_EXPORT_FAILED":
      return translate(locale, "sketch.exportFailed");
    case "SKETCH_WORKER_FAILED":
      return translate(locale, "sketch.workerFailed");
    case "SKETCH_TEXT_OVERFLOW":
      return translate(locale, "sketch.textOverflow");
    case "chat.queue.chatBudget":
      return translate(locale, "chat.queue.chatBudget");
    case "chat.queue.globalBudget":
      return translate(locale, "chat.queue.globalBudget");
    default:
      return translate(locale, "sketch.error");
  }
}
export function surfaceErrorMessage(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("SKETCH_EDITOR_ACTIVE")
    ? sketchErrorMessage(error)
    : error instanceof Error
      ? error.message
      : fallback;
}
