/**
 * [INPUT]: Depends on ImageShimmer, GalleryMediaSourceRef, share useGalleryThumbnail state machine, external retry signal and state playback
 * [OUTPUT]: Provides a bucket of non-interacting nodes to shorten the chart with a pending/loading/failed state projection
 * [POS]: Media leaf nodes in bases/views/gallery; I don't know what to do, comment and Composer
 */

import { useEffect } from "react";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import { ImageShimmer } from "@ai-chat/ui/components/ai-elements/image-shimmer";
import type { GalleryMediaSourceRef } from "../../../../../shared/gallery-media-ipc";
import { useGalleryThumbnail } from "@/lib/gallery/media/use-gallery-thumbnail";
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
}: {
  sourceRef: GalleryMediaSourceRef;
  maxEdge: number;
  onContentElement?: (element: HTMLImageElement | null) => void;
  onSourceGone?: () => void;
  onStatus?: (status: GalleryThumbnailStatus) => void;
  retrySignal?: number;
}) {
  const { t } = useAppTranslation();
  const { preview, request } = useGalleryThumbnail({
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
        <span>{t("bases.gallery.previewFailed")}</span>
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
      {request === "cache-pending" && (
        <span className="absolute right-2 bottom-2 rounded-full bg-background/85 px-2 py-1 text-[10px] text-muted-foreground">
          {t("bases.gallery.syncing")}
        </span>
      )}
    </span>
  );
}
