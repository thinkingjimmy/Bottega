/**
 * [INPUT]: Depends on React, Gallery transcript projection, panel-catalog Image identity, thumbnail/attachment readers, Gallery zoom settings, and the localized image catalog
 * [OUTPUT]: Provides resolveConversationImage with an explicit localized fallback title and ImageTabPanel with localized preview, loading, retry, and failure states
 * [POS]: Dynamic chat/side-panel Image view; each tab retains zoom state while inactive tabs release heavy media
 */

import { useEffect, useState } from "react";
import { ImageShimmer } from "@ai-chat/ui/components/ai-elements/image-shimmer";
import { Button } from "@ai-chat/ui/components/ui/button";
import { SlimScroller } from "@ai-chat/ui/components/ui/slim-scroller";
import { cn } from "@ai-chat/ui/lib/utils";
import type { ConversationImageProjection } from "./image-projection";
import {
  useGalleryThumbnail,
  type GalleryThumbnailRequest,
} from "@/lib/gallery/media/use-gallery-thumbnail";
import type { GallerySourceRef } from "../../../../../shared/gallery-media-ipc";
import {
  ViewConfigBar,
  ViewConfigSelect,
} from "@/components/bases/views/view-config-bar";
import { GALLERY_ZOOM_OPTIONS } from "@/components/bases/views/gallery/gallery-zoom";
import type { ConversationImageSource } from "../../runtime/chat-session-model";
import {
  imageIdentityOf,
  type ImageRegionId,
} from "../panel-catalog";
import { useAppTranslation } from "@/components/providers/i18n-provider";

export type ResolvedConversationImage = {
  source: ConversationImageSource;
  label: string;
  alt: string;
};

export function resolveConversationImage(
  region: ImageRegionId,
  projection: ConversationImageProjection,
  fallbackTitle: string
): ResolvedConversationImage | null {
  const identity = imageIdentityOf(region);
  const incarnationId = projection.incarnationId;
  if (!identity || !incarnationId) return null;

  if (identity.kind === "attachment") {
    const attachment = projection.canonicalMessages
      .flatMap((message) =>
        message.role === "user" ? message.attachments ?? [] : []
      )
      .find((item) => item.id === identity.attachmentId);
    return attachment
      ? {
          source: {
            kind: "attachment",
            chatId: projection.chatId,
            incarnationId,
            attachment,
          },
          label: attachment.filename,
          alt: attachment.filename,
        }
      : null;
  }

  const canonical = projection.canonicalMessages.find(
    (message) =>
      message.role === "assistant" && message.seq === identity.assistantSeq
  );
  const canonicalPart = canonical?.parts?.find(
    (part) =>
      part.type === "tool" &&
      part.tool === "image" &&
      part.status === "completed" &&
      part.itemId === identity.itemId
  );
  const draftPart =
    projection.assistantSeq === identity.assistantSeq
      ? projection.draft?.parts.find(
          (part) =>
            part.type === "tool" &&
            part.tool === "image" &&
            part.status === "completed" &&
            part.itemId === identity.itemId
        )
      : undefined;
  const part = canonicalPart ?? draftPart;
  if (!part || part.type !== "tool") return null;
  const title = part.title || fallbackTitle;
  return {
    source: {
      kind: "generated",
      title,
      sourceRef: {
        kind: "transcript",
        chatId: projection.chatId,
        incarnationId,
        assistantSeq: identity.assistantSeq,
        itemId: identity.itemId,
      },
    },
    label: title,
    alt: title,
  };
}

type AttachmentRequest =
  | "idle"
  | "loading"
  | "ready"
  | { error: string; retryable: boolean };

function useAttachmentPreview({
  source,
  retrySignal,
}: {
  source: Extract<ConversationImageSource, { kind: "attachment" }>;
  retrySignal: number;
}) {
  const attachmentId = source.attachment.id;
  const requestKey = `${attachmentId}:${retrySignal}`;
  const [snapshot, setSnapshot] = useState<{
    key: string;
    url: string;
    request: AttachmentRequest;
  }>({ key: "", url: "", request: "loading" });
  useEffect(() => {
    const read = window.chats?.readAttachment;
    if (!read) return;
    let active = true;
    void read(attachmentId)
      .then((dataUrl) => {
        if (!active) return;
        setSnapshot({ key: requestKey, url: dataUrl, request: "ready" });
      })
      .catch(() => {
        if (!active) return;
        setSnapshot({
          key: requestKey,
          url: "",
          request: { error: "ATTACHMENT_READ_FAILED", retryable: true },
        });
      });
    return () => {
      active = false;
    };
  }, [attachmentId, requestKey]);
  if (!window.chats?.readAttachment) {
    return {
      url: "",
      request: { error: "MEDIA_UNAVAILABLE", retryable: false } as const,
    };
  }
  return snapshot.key === requestKey
    ? snapshot
    : { url: "", request: "loading" as const };
}

export function ImageTabPanel({
  active,
  hydrated,
  image,
}: {
  active: boolean;
  hydrated: boolean;
  image: ResolvedConversationImage | null;
}) {
  const { t } = useAppTranslation();
  const [zoom, setZoom] = useState(100);
  const [retrySignal, setRetrySignal] = useState(0);

  return (
    <section
      aria-label={
        image
          ? t("chat.sidePanel.image.previewNamed", { name: image.label })
          : t("chat.sidePanel.image.preview")
      }
      className="flex min-h-0 flex-1 flex-col"
    >
      <ViewConfigBar>
        <div className="ml-auto">
          <ViewConfigSelect
            disabled={!image}
            label={t("chat.sidePanel.image.zoom")}
            onChange={(value) => setZoom(Number(value) || 100)}
            options={GALLERY_ZOOM_OPTIONS}
            value={String(zoom)}
          />
        </div>
      </ViewConfigBar>
      {active ? (
        <ImageTabContent
          hydrated={hydrated}
          image={image}
          onRetry={() => setRetrySignal((value) => value + 1)}
          retrySignal={retrySignal}
          zoom={zoom}
        />
      ) : null}
    </section>
  );
}

function ImageTabContent({
  hydrated,
  image,
  onRetry,
  retrySignal,
  zoom,
}: {
  hydrated: boolean;
  image: ResolvedConversationImage | null;
  onRetry(): void;
  retrySignal: number;
  zoom: number;
}) {
  const { t } = useAppTranslation();
  return (
    <SlimScroller
      className="min-h-0 flex-1 overflow-auto bg-muted/20"
      data-testid="conversation-image-scroll"
    >
      <div
        className={cn(
          "flex min-h-full min-w-full p-4",
          zoom <= 100
            ? "items-center justify-center"
            : "items-start justify-start"
        )}
      >
        {!hydrated ? (
          <ImageShimmer
            className="mx-auto"
            label={t("chat.sidePanel.image.restoring")}
          />
        ) : !image ? (
          <ImageUnavailable />
        ) : image.source.kind === "generated" ? (
          <GeneratedImage
            alt={image.alt}
            onRetry={onRetry}
            retrySignal={retrySignal}
            sourceRef={image.source.sourceRef}
            zoom={zoom}
          />
        ) : (
          <AttachmentImage
            alt={image.alt}
            onRetry={onRetry}
            retrySignal={retrySignal}
            source={image.source}
            zoom={zoom}
          />
        )}
      </div>
    </SlimScroller>
  );
}

function GeneratedImage({
  alt,
  onRetry,
  retrySignal,
  sourceRef,
  zoom,
}: ImageMediaProps & { sourceRef: GallerySourceRef }) {
  const { preview, request } = useGalleryThumbnail({
    sourceRef,
    maxEdge: 1024,
    retrySignal,
  });
  return (
    <ImageMedia
      alt={alt}
      onRetry={onRetry}
      previewUrl={preview?.dataUrl ?? ""}
      request={request}
      zoom={zoom}
    />
  );
}

function AttachmentImage({
  alt,
  onRetry,
  retrySignal,
  source,
  zoom,
}: ImageMediaProps & {
  source: Extract<ConversationImageSource, { kind: "attachment" }>;
}) {
  const { url, request } = useAttachmentPreview({
    source,
    retrySignal,
  });
  return (
    <ImageMedia
      alt={alt}
      onRetry={onRetry}
      previewUrl={url}
      request={request}
      zoom={zoom}
    />
  );
}

type ImageMediaProps = {
  alt: string;
  onRetry(): void;
  retrySignal: number;
  zoom: number;
};

function ImageMedia({
  alt,
  onRetry,
  previewUrl,
  request,
  zoom,
}: Omit<ImageMediaProps, "retrySignal"> & {
  previewUrl: string;
  request: GalleryThumbnailRequest | AttachmentRequest;
}) {
  const { t } = useAppTranslation();
  if (!previewUrl) {
    return typeof request === "object" ? (
      <ImageUnavailable retryable={request.retryable} onRetry={onRetry} />
    ) : (
      <ImageShimmer
        className="mx-auto"
        label={t("chat.sidePanel.image.reading")}
      />
    );
  }
  return (
    <div
      className={cn("shrink-0", zoom <= 100 && "mx-auto")}
      data-testid="conversation-image-canvas"
      data-zoom={zoom}
      style={{ width: `${zoom}%` }}
    >
      <img
        alt={alt}
        className="block h-auto w-full rounded-lg border object-contain shadow-sm"
        draggable={false}
        src={previewUrl}
      />
    </div>
  );
}

function ImageUnavailable({
  retryable = false,
  onRetry,
}: {
  retryable?: boolean;
  onRetry?: () => void;
}) {
  const { t } = useAppTranslation();
  return (
    <div
      className="mx-auto grid min-h-40 max-w-sm place-items-center gap-3 rounded-lg border bg-background p-6 text-center text-muted-foreground text-sm"
      role="status"
    >
      <p>{t("chat.sidePanel.image.unavailable")}</p>
      {retryable && onRetry ? (
        <Button
          className="min-h-11"
          onClick={onRetry}
          type="button"
          variant="outline"
        >
          {t("chat.sidePanel.image.retry")}
        </Button>
      ) : null}
    </div>
  );
}
