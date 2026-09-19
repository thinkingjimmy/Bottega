/**
 * [INPUT]: Depends on existing desktop Base providers, private media, Gallery state and controlled external navigation.
 * [OUTPUT]: Provides the desktop six-view Base adapter with a lazy Cloud-only synchronization review overlay.
 * [POS]: Renderer composition boundary; shared UI receives no preload global or Agent authority.
 */
import { lazy, Suspense, useMemo, type ReactNode } from "react";
import { BaseUIProvider, type BasePlatform } from "@ai-chat/base-ui/ui/platform/context";
import type { BaseAttachmentFacade } from "@ai-chat/base-ui/ui/platform/contracts";
import type { GalleryIntegration } from "@ai-chat/base-ui/ui/platform/gallery";
import { useBaseSnapshots, useBasesNavigation } from "../providers/bases-provider";
import { useGalleryRunningOverlay } from "@/lib/gallery/overlay";
import { openExternal } from "@/lib/agent-client";
import { putBaseAttachment, listBaseGalleryEntries } from "@/lib/bases/client";
import { stageNativeBaseImage, discardNativeBaseImages, previewNativeBaseImage } from "@/lib/bases/native-images";
import { readGalleryState, subscribeGalleryState, selectGalleryItem, saveGalleryComment, deleteGalleryComment,
  expireGallerySource, reconcileGallerySources, migrateGalleryIdentity } from "@/lib/gallery/store";
import { focusComposer, registerGalleryFocus } from "@/lib/gallery/focus-controller";
declare const __BOTTEGA_CLOUD_CONFIG__: object | null;
const CloudPlatform = typeof __BOTTEGA_CLOUD_CONFIG__ !== "undefined" && __BOTTEGA_CLOUD_CONFIG__ ?
  lazy(() => import("@/lib/cloud/bases/platform").then(module => ({ default: module.CloudBasePlatform }))) : null;
const gallery: GalleryIntegration = { read: readGalleryState, subscribe: subscribeGalleryState, selectGalleryItem,
  saveGalleryComment, deleteGalleryComment, expireGallerySource, reconcileGallerySources, migrateGalleryIdentity,
  listBaseGalleryEntries, focusComposer, registerGalleryFocus };
const attachments: BaseAttachmentFacade = {
  stageImage: stageNativeBaseImage,
  discardImages: discardNativeBaseImages,
  preview: previewNativeBaseImage,
  async galleryThumbnail(input, signal) {
    signal.throwIfAborted();
    if (!window.galleryMedia) return { ok: false, error: { code: "IO_ERROR", message: "IO_ERROR", retryable: false } };
    return window.galleryMedia.thumbnail(input);
  },
  putAttachment: putBaseAttachment,
};
export function DesktopBasePlatform({ children, chatId }: { children: ReactNode; chatId?: string }) {
  const snapshots = useBaseSnapshots(), navigation = useBasesNavigation(), overlay = useGalleryRunningOverlay(chatId);
  const value = useMemo<BasePlatform>(() => ({ data: { ...snapshots, ensure: navigation.ensure }, mutations: snapshots,
    attachments, gallery, overlay, openExternal }), [navigation.ensure, snapshots, overlay]);
  return CloudPlatform ? <Suspense fallback={<div className="min-h-0 flex-1" aria-busy="true" />}>
    <CloudPlatform value={value}>{children}</CloudPlatform></Suspense> : <BaseUIProvider value={value}>{children}</BaseUIProvider>;
}
