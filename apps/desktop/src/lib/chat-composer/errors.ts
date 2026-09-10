/**
 * [INPUT]: Depends on stable Sketch error markers and current locale translation.
 * [OUTPUT]: Provides localized Sketch failures and cross-window migration error normalization.
 * [POS]: Shared projection for composer, editor, queue, and migration initiators.
 */
import { effectiveLocale } from "../i18n-locale";
import { translate } from "../../../shared/i18n/runtime";
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
