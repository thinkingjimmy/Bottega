/**
 * [INPUT]: Depends on ImageShimmer, GalleryMediaSourceRef, share useGalleryThumbnail state machine, external retry signal and state playback
 * [OUTPUT]: Renders Gallery thumbnails, loading/error states and source-device-only labels without suggesting a remote file can be downloaded.
 * [POS]: Shared Base presentation in ui/views/gallery.
 */

import { useBasePlatform } from "../../platform/context";
import { useEffect } from "react";
import { useAppTranslation } from "../../platform/i18n";
import { ImageShimmer } from "@ai-chat/ui/components/ai-elements/image-shimmer";
import type { GalleryMediaSourceRef } from "@ai-chat/base-ui/attachments/gallery-media-ipc";
import { useGalleryThumbnail } from "../../media/use-gallery-thumbnail";
import { useLocalImageLabel } from "../../media/availability";
import type { BaseAttachmentValue } from "../../../model/base-values";
export type GalleryThumbnailStatus =
  | "cache-pending"
  | "loading"
  | { error: string; retryable: boolean };

export function GalleryThumbnail({
  sourceRef,
  maxEdge,
  onContentElement,
  onSourceGone,
  onStatus,
  retrySignal = 0,
  localAvailability,
}: {
  sourceRef: GalleryMediaSourceRef;
  maxEdge: number;
  onContentElement?: (element: HTMLImageElement | null) => void;
  onSourceGone?: () => void;
  onStatus?: (status: GalleryThumbnailStatus) => void;
  retrySignal?: number;
  localAvailability?: BaseAttachmentValue["localAvailability"];
}) {
  const { t } = useAppTranslation();
  const { attachments } = useBasePlatform();
  const availabilityLabel = useLocalImageLabel(localAvailability);
  const { preview, request } = useGalleryThumbnail({
    load: attachments.galleryThumbnail,
    sourceRef,
    maxEdge,
    retrySignal,
    onSourceGone,
  });
  const status: GalleryThumbnailStatus =
    request === "cache-pending"
      ? "cache-pending"
      : typeof request === "object"
        ? request
        : "loading";
  useEffect(() => onStatus?.(status), [onStatus, status]);

  if (!preview && typeof request !== "object") {
    return (
      <ImageShimmer
        className="aspect-square w-full"
        label={t("bases.gallery.loadingImage")}
      />
    );
  }
  if (!preview && typeof request === "object") {
    return (
      <div className="grid aspect-square w-full place-items-center rounded-lg bg-muted/50 p-4 text-center text-muted-foreground text-xs">
        <span>{availabilityLabel ?? t("bases.gallery.previewFailed")}</span>
      </div>
    );
  }
  return (
    <span className="relative block w-full">
      <img
        alt={t("bases.gallery.generated")}
        className="block h-auto w-full rounded-lg object-contain"
        draggable={false}
        height={preview!.height}
        ref={onContentElement}
        src={preview!.dataUrl}
        width={preview!.width}
      />
      {availabilityLabel && <span className="block px-2 py-2 text-xs text-muted-foreground">{availabilityLabel}</span>}
      {request === "cache-pending" && (
        <span className="absolute right-2 bottom-2 rounded-full bg-background/85 px-2 py-1 text-[10px] text-muted-foreground">
          {t("bases.gallery.syncing")}
        </span>
      )}
    </span>
  );
}
