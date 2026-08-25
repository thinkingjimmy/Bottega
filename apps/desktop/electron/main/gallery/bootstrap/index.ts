/**
 * [INPUT]: Depends on ChatStore canonical image detail/homeDir, Gallery broker/cache/media and Base attachment ingestion/target Chat authorization; The user data received and the occurrence of the activity were determined
 * [OUTPUT]: Provides initialize GalleryRuntime, by journal→canonical Reposition→cache GC→Base reconcile
 * [POS]: The combination root of gallery/bootstrap; Isolate Electron main/index.ts to Gallery Restore and attachment Port Connection Details
 */

import { dirname, join } from "node:path";
import {
  galleryOccurrenceKey,
  type GallerySourceRef,
} from "../../../../shared/gallery-media-ipc";
import type { ChatToolPart } from "../../../../shared/chats-ipc";
import type { BasesService } from "../../bases/bases-service";
import { GalleryIngestion } from "../../bases/media-host/gallery-ingestion";
import type { ChatStore } from "../../chats/chat-store";
import { GalleryMediaCache } from "../media-cache";
import { GalleryMediaService } from "../media-service";
import { TurnEventsBroker } from "../turn-events-broker";

export type GalleryRuntime = {
  cache: GalleryMediaCache;
  events: TurnEventsBroker;
  media: GalleryMediaService;
  connectBases(bases: BasesService): Promise<void>;
};

export async function initializeGalleryRuntime(
  userData: string,
  store: ChatStore,
  isActiveSource: (sourceRef: GallerySourceRef) => boolean
): Promise<GalleryRuntime> {
  const cache = new GalleryMediaCache(join(userData, "gallery-media"));
  await cache.initialize();
  const events = new TurnEventsBroker(
    join(userData, "gallery-completions"),
    {
      resolveCanonicalSource: (sourceRef) =>
        resolveCanonicalImageSource(store, sourceRef),
      resolveDurableSource: async (sourceRef) => {
        const record = await cache.lookup(sourceRef);
        if (!record) return null;
        const sourcePath = cache.mediaPath(sourceRef, record);
        return { sourcePath, readRoot: dirname(sourcePath) };
      },
    }
  );
  await events.initialize();
  await cache.collectGarbage(
    new Set(
      events.completedEvents().map((event) =>
        galleryOccurrenceKey(event.sourceRef)
      )
    ),
    (sourceRef) => events.hasCompletion(sourceRef)
  );

  let ingestion: GalleryIngestion | undefined;
  // Base 接线前的窗口期只落 app-owned cache、不 ACK；这些事件由
  // connectBases 里的 reconcileAll 统一补收，双投递被 fingerprint
  // 幂等吸收（idempotent 仍是 ok，不产生假警告）。
  events.subscribe(async (event) => {
    if (ingestion) await ingestion.ingest(event);
    else await cache.ingest(event);
  });
  const media = new GalleryMediaService(
    store,
    cache,
    events,
    isActiveSource
  );

  return {
    cache,
    events,
    media,
    async connectBases(bases) {
      ingestion = new GalleryIngestion(cache, bases, events);
      await ingestion.reconcileAll();
      connectAttachmentMedia(media, bases);
    },
  };
}

export async function resolveCanonicalImageSource(
  store: ChatStore,
  sourceRef: Extract<GallerySourceRef, { kind: "transcript" }>
) {
  const record = await store.get(sourceRef.chatId);
  if (
    !record ||
    record.incarnationId !== sourceRef.incarnationId ||
    !record.homeDir
  ) {
    return null;
  }
  const message = record.messages.find(
    (message) =>
      message.role === "assistant" &&
      message.seq === sourceRef.assistantSeq
  );
  const image = message?.parts?.find(
    (part): part is ChatToolPart =>
      part.type === "tool" &&
      part.tool === "image" &&
      part.status === "completed" &&
      part.itemId === sourceRef.itemId
  );
  return image?.detail
    ? { sourcePath: image.detail, readRoot: record.homeDir }
    : null;
}

function connectAttachmentMedia(
  media: GalleryMediaService,
  bases: BasesService
) {
  media.setAttachmentMedia({
    assertAuthorized: (sourceRef, destinationChatId) =>
      bases.assertGalleryAttachmentAuthorized(sourceRef, destinationChatId),
    thumbnail: (sourceRef, maxEdge) =>
      bases.galleryThumbnail(sourceRef, maxEdge).then(
        (result) => result ?? sourceGone()
      ),
    materialize: (sourceRef, destinationChatId) =>
      bases.galleryMaterialize(sourceRef, destinationChatId).then(
        (result) => result ?? sourceGone()
      ),
  });
}

function sourceGone() {
  return {
    ok: false as const,
    error: {
      code: "SOURCE_GONE" as const,
      retryable: false,
      message: "Attachment source 不存在",
    },
  };
}
