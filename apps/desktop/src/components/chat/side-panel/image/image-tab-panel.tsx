/**
 * [INPUT]: Depends on React, Gallery transcript projection, panel-catalog Image identity, thumbnail/attachment readers, Gallery zoom settings, and the localized image catalog
 * [OUTPUT]: Provides current-incarnation image resolution and native readers/controls for the shared ImagePanel
 * [POS]: Dynamic chat/side-panel Image view; each tab retains zoom state while inactive tabs release heavy media
 */

import { useMemo } from "react";
import type { ConversationImageProjection } from "./image-projection";
import {
  ViewConfigBar,
  ViewConfigSelect,
} from "@ai-chat/base-ui/ui/views/view-config-bar";
import { GALLERY_ZOOM_OPTIONS } from "@ai-chat/base-ui/ui/views/gallery/gallery-zoom";
import type { ConversationImageSource } from "../../runtime/chat-session-model";
import {
  type ImageRegionId,
} from "../panel-catalog";
import { decodeImageIdentity } from "@ai-chat/chat-ui/image/identity";
import { ImagePanel, type ImageSource, type GalleryImageSource } from "@ai-chat/chat-ui/image/panel";
import type { GalleryMediaBridgeApi } from "@ai-chat/base-ui/attachments/gallery-media-ipc";
import { sidePanelCopy } from "@ai-chat/chat-ui/side-panel-copy";
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
  const identity = decodeImageIdentity(region);
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
      message.role === "assistant" && (message.id === identity.messageId || `seq:${message.seq}` === identity.messageId)
  );
  const assistantSeq = canonical?.seq ?? (/^seq:(0|[1-9][0-9]*)$/.test(identity.messageId) ? Number(identity.messageId.slice(4)) : undefined);
  if (assistantSeq === undefined || !Number.isSafeInteger(assistantSeq)) return null;
  const parts = identity.subagentId === null ? canonical?.parts : canonical && projection.subagents?.[identity.subagentId]?.draft?.parts;
  const canonicalPart = parts?.find(
    (part) =>
      part.type === "tool" &&
      part.tool === "image" &&
      part.status === "completed" &&
      part.itemId === identity.itemId
  );
  const draftPart =
    identity.subagentId === null && projection.assistantSeq === assistantSeq
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
      ...(identity.subagentId ? { subagentId: identity.subagentId } : {}),
      sourceRef: {
        kind: "transcript",
        chatId: projection.chatId,
        incarnationId,
        assistantSeq: assistantSeq,
        itemId: identity.itemId,
      },
    },
    label: title,
    alt: title,
  };
}

const loadGallery: GalleryMediaBridgeApi["thumbnail"] = async input => {
  if (!window.galleryMedia) return { ok: false, error: { code: "IO_ERROR", message: "IO_ERROR", retryable: false } };
  return window.galleryMedia.thumbnail(input);
};
export function ImageTabPanel({ active, hydrated, image }: { active: boolean; hydrated: boolean; image: ResolvedConversationImage | null }) {
  const { i18n, t } = useAppTranslation();
  const key = image ? JSON.stringify(image.source) : "";
  const source = useMemo<ImageSource | GalleryImageSource | null>(() => {
    if (!image) return null;
    const value = image.source;
    if (value.kind === "generated") return { key, gallery: { sourceRef: value.sourceRef, maxEdge: 1024,
      load: input => loadGallery({ ...input, ...(value.subagentId ? { subagentId: value.subagentId } : {}) }) } };
    return { key, read: async signal => {
      signal.throwIfAborted();
      if (!window.chats?.readAttachment) throw new Error("MEDIA_UNAVAILABLE");
      const url = await window.chats.readAttachment(value.chatId, value.attachment.id);
      signal.throwIfAborted();
      return { url, release() {} };
    } };
    // The serialized source includes the complete incarnation and immutable media identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const copy = { ...sidePanelCopy(i18n.language), preview: t("chat.sidePanel.image.preview"), previewNamed: t("chat.sidePanel.image.previewNamed", { name: "{name}" }),
    loadingImage: t(hydrated ? "chat.sidePanel.image.reading" : "chat.sidePanel.image.restoring"), imageUnavailable: t("chat.sidePanel.image.unavailable"), retry: t("chat.sidePanel.image.retry") };
  return <ImagePanel source={source} label={image?.label} active={active} hydrated={hydrated} copy={copy}
    controls={(zoom, change) => <ViewConfigBar><div className="ml-auto"><ViewConfigSelect disabled={!image} label={t("chat.sidePanel.image.zoom")} onChange={value => change(Number(value) || 100)} options={GALLERY_ZOOM_OPTIONS} value={String(zoom)} /></div></ViewConfigBar>} />;
}
