/**
 * [INPUT]: Depends on the shared thumbnail lifecycle and the desktop Gallery media bridge.
 * [OUTPUT]: Adapts useGalleryThumbnail and its preview budget for desktop image surfaces.
 * [POS]: Desktop thumbnail transport boundary; the shared hook owns cancellation and retry.
 */
import { useGalleryThumbnail as useSharedGalleryThumbnail } from "@ai-chat/base-ui/ui/media/use-gallery-thumbnail";
import type { GalleryMediaSourceRef } from "../../../../shared/gallery-media-ipc";
export { GalleryThumbnailPreviewBudget } from "@ai-chat/base-ui/ui/media/use-gallery-thumbnail";
export type { GalleryThumbnailPreview, GalleryThumbnailRequest, GalleryThumbnailSnapshot } from "@ai-chat/base-ui/ui/media/use-gallery-thumbnail";
const load: Parameters<typeof useSharedGalleryThumbnail>[0]["load"] = async input => {
  if (!window.galleryMedia) return { ok: false, error: { code: "IO_ERROR", message: "IO_ERROR", retryable: false } };
  return window.galleryMedia.thumbnail(input);
};
export function useGalleryThumbnail(input: { sourceRef: GalleryMediaSourceRef; maxEdge: number; retrySignal?: number; onSourceGone?: () => void }) {
  return useSharedGalleryThumbnail({ ...input, load });
}
