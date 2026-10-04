/**
 * [INPUT]: Depends on the TurnEventsBroker durable journal, GalleryMediaCache app-owned custody, ImageCodecHost, BasesService attachment ingestion/event publication, and the shared Gallery failure normalizer
 * [OUTPUT]: Provides cache-first automatic ingestion, isolated validation of byte-exact oversized originals, receipt-gated ACK/recovery-window release and coded failure events for localized user feedback.
 * [POS]: bases/media-host's ingestion boundary; never touches TurnRegistry directly and never accepts a bare filesystem path — it copies the source into the app-owned cache before decoding
 */

import type { BasesService } from "../bases-service";
import { galleryMediaFailure } from "@ai-chat/base-core/attachments/gallery-media-ipc";
import { parseAttachmentImageHeader } from "../../gallery/image-header";
import type { GalleryMediaCache } from "../../gallery/media-cache";
import type {
  CompletedImageEventV1,
  TurnEventsBroker,
} from "../../gallery/turn-events-broker";
import { ImageCodecHost } from "./codec-host";
import { BASE_ATTACHMENT_BYTE_LIMIT } from "../../../../shared/bases/gallery-attachments";

export class GalleryIngestion {
  constructor(
    private readonly cache: GalleryMediaCache,
    private readonly bases: BasesService,
    private readonly broker: TurnEventsBroker,
    private readonly codec = new ImageCodecHost(),
    private readonly sourceDeviceId?: string
  ) {}

  async ingest(event: CompletedImageEventV1) {
    try {
      return await this.ingestAndAcknowledge(event);
    } catch (cause) {
      console.warn("[gallery] Automatic ingestion failed", event.logicalKey, cause);
      const result = galleryMediaFailure(cause);
      this.warn(event.logicalKey, result.error);
      return result;
    }
  }

  private async ingestAndAcknowledge(event: CompletedImageEventV1) {
    const record = await this.cache.ingest(event);
    const input = await this.cache.readCached(event.sourceRef, record);
    const localAvailability = input.length > BASE_ATTACHMENT_BYTE_LIMIT
      ? { sourceDeviceId: this.sourceDeviceId ?? "" } : undefined;
    if (localAvailability && !localAvailability.sourceDeviceId) throw new Error("Source device identity is unavailable");
    // Oversized originals keep their exact bytes; the isolated decoder still validates their pixels.
    const output = localAvailability ? (await this.codec.thumbnail(input, 160), input) : await this.codec.normalize(input);
    const result = await this.bases.ingestCompletedImage(
      event,
      output,
      `${event.sourceRef.itemId}.${parseAttachmentImageHeader(output).extension}`,
      localAvailability
    );
    if (!result.ok) {
      console.warn("[gallery] Attachment ingestion refused", event.logicalKey, result.error);
      this.warn(event.logicalKey, result.error);
    }
    // A deterministic conflict cannot converge by retrying; transient failures retain the journal.
    const settled = result.ok || result.error.code === "ATTACHMENT_CONFLICT";
    if (settled) {
      try {
        if (await this.broker.acknowledge(event)) await this.releaseAfterReceipt(event);
      } catch (cause) {
        // The image already has a durable receipt; cleanup failure must not report a failed import.
        console.warn("[gallery] Completion cleanup failed", event.logicalKey, cause);
      }
    }
    return result;
  }

  private warn(logicalKey: string, error: Extract<Awaited<ReturnType<BasesService["ingestCompletedImage"]>>, { ok: false }>["error"] | ReturnType<typeof galleryMediaFailure>["error"]) {
    this.bases.publishEvent({ type: "gallery-ingestion-failed", logicalKey, code: error.code, retryable: error.retryable });
  }

  private releaseAfterReceipt(event: CompletedImageEventV1) {
    return this.cache.releaseAfterRecoveryWindow(
      event.sourceRef,
      () => this.broker.hasCompletion(event.sourceRef)
    );
  }

  async reconcile(chatId?: string, incarnationId?: string) {
    const events = this.broker.completedEvents(chatId, incarnationId);
    for (const event of events) {
      try {
        const lease = await this.broker.reissueLease(event.sourceRef);
        if (lease) await this.ingest({ ...event, lease });
      } catch (cause) {
        console.warn("[gallery] Completion reconciliation failed", event.logicalKey, cause);
        this.warn(event.logicalKey, galleryMediaFailure(cause).error);
      }
    }
  }

  reconcileAll() {
    return this.reconcile();
  }
}
