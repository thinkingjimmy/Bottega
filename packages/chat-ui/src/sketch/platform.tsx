/**
 * [INPUT]: Host-owned draft identity, atomic source/PNG save callbacks and localized composer copy.
 * [OUTPUT]: Browser-safe Sketch sessions, ownership checks, translation and error projection.
 * [POS]: Platform boundary for the shared editor; native storage and Web page memory remain host-owned.
 */
import { createContext, useContext } from "react";
import { composerTranslate, type ComposerTranslate } from "../ui/composer/controls/copy/translation";
import type { SketchDocument } from "./model/document";
export type SketchOwner = { chatId: string; epoch: number; incarnationId: string | null; valid?(): boolean };
export const sketchOwnerValid = (owner: SketchOwner) => owner.valid?.() ?? true;
export type SketchSession = {
  id: string; owner: SketchOwner; document: SketchDocument; attachmentId?: string;
  assertSave(): void; save(source: SketchDocument, png: File): void | Promise<void>; close(saved?: boolean): void;
};
const Translation = createContext<ComposerTranslate>(composerTranslate("en"));
export const SketchTranslationProvider = Translation.Provider;
export const useSketchTranslation = () => ({ t: useContext(Translation) });
export function sketchErrorMessage(error: unknown, t: ComposerTranslate = composerTranslate("en")) {
  const message = error instanceof Error ? error.message : String(error);
  const names: Record<string, string> = { SKETCH_EDITOR_ACTIVE: "editorActive", COMPOSER_MIGRATION_ACTIVE: "migrationActive",
    SKETCH_SOURCE_MISSING: "sourceMissing", SKETCH_INVALID_SOURCE: "sourceMissing", SKETCH_OWNER_EXPIRED: "ownerExpired",
    SKETCH_READ_ONLY: "readOnly", SKETCH_VERSION_CHANGED: "versionChanged", SKETCH_ATTACHMENT_LIMIT: "attachmentLimit",
    SKETCH_IMAGE_TOO_LARGE: "imageTooLarge", SKETCH_BUDGET: "budget", SKETCH_RESIZE_BUDGET: "resizeBudget", SKETCH_ERASE_BUDGET: "eraseBudget",
    SKETCH_EMPTY: "empty", SKETCH_EXPORT_FAILED: "exportFailed", SKETCH_WORKER_FAILED: "workerFailed", SKETCH_TEXT_OVERFLOW: "textOverflow" };
  return t(`sketch.${names[message] ?? "error"}`);
}
