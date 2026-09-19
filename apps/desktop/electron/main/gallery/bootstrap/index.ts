/**
 * [INPUT]: ChatStore metadata, canonical assistant/Subagent proof, Gallery broker/cache/media and Base attachment authorization.
 * [OUTPUT]: Provides GalleryRuntime with synchronous Base wiring plus deferred cache GC/ingestion reconciliation, and source-device-bound image ingestion from exact canonical transcript facts without aggregate Chat reads.
 * [POS]: Gallery/bootstrap composition root; isolates main/index.ts from restore, cache, and attachment port details
 */

import { dirname, join } from "node:path";
import {
  galleryOccurrenceKey,
  type GallerySourceRef,
} from "../../../../shared/gallery-media-ipc";
import { canonicalImage } from "../source";
import type { BasesService } from "../../bases/bases-service";
import { GalleryIngestion } from "../../bases/media-host/gallery-ingestion";
import type { ChatStore } from "../../chats/chat-store";
import { DeviceIdentityStore } from "../../chats/device-identity/device-identity";
import { GalleryMediaCache } from "../media-cache";
import { GalleryMediaService } from "../media-service";
import { TurnEventsBroker } from "../turn-events-broker";

export type GalleryRuntime = {
  cache: GalleryMediaCache;
  events: TurnEventsBroker;
  media: GalleryMediaService;
  connectBases(bases: BasesService): void;
  /* Cache GC and ingestion catch-up touch nothing the first frame reads; startup
     runs both after the window is up. */
  collectGarbage(): Promise<void>;
  reconcileIngestion(): Promise<void>;
};

export async function initializeGalleryRuntime(
  userData: string,
  store: ChatStore,
  isActiveSource: (sourceRef: GallerySourceRef) => boolean
): Promise<GalleryRuntime> {
  const sourceDeviceId = await new DeviceIdentityStore(userData).loadOrCreate();
  const cache = new GalleryMediaCache(join(userData, "gallery-media"));
  await cache.initialize();
  const events = new TurnEventsBroker(
    join(userData, "gallery-completions"),
    {
      resolveCanonicalSource: (sourceRef, subagentId) =>
        resolveCanonicalImageSource(store, sourceRef, subagentId),
      resolveDurableSource: async (sourceRef) => {
        const record = await cache.lookup(sourceRef);
        if (!record) return null;
        const sourcePath = cache.mediaPath(sourceRef, record);
        return { sourcePath, readRoot: dirname(sourcePath) };
      },
    }
  );
  await events.initialize();

  let ingestion: GalleryIngestion | undefined;
  // Before Bases are wired, events only land in the app-owned cache and are never
  // ACKed; reconcileIngestion collects them afterwards and the fingerprint absorbs the
  // double delivery idempotently (still ok, so no false warning).
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
    connectBases(bases) {
      ingestion = new GalleryIngestion(cache, bases, events, undefined, sourceDeviceId);
      connectAttachmentMedia(media, bases);
    },
    collectGarbage() {
      return cache.collectGarbage(
        new Set(
          events.completedEvents().map((event) =>
            galleryOccurrenceKey(event.sourceRef)
          )
        ),
        (sourceRef) => events.hasCompletion(sourceRef)
      );
    },
    reconcileIngestion() {
      return ingestion?.reconcileAll() ?? Promise.resolve();
    },
  };
}

export async function resolveCanonicalImageSource(
  store: ChatStore,
  sourceRef: Extract<GallerySourceRef, { kind: "transcript" }>,
  subagentId: string | null = null
) {
  const record = store.getMetadata(sourceRef.chatId);
  if (
    !record ||
    record.incarnationId !== sourceRef.incarnationId ||
    !record.homeDir
  ) {
    return null;
  }
  const { image } = await canonicalImage(store, sourceRef, subagentId);
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
