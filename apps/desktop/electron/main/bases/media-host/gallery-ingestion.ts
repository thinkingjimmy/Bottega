/**
 * [INPUT]: Depends on the TurnEventsBroker durable journal, GalleryMediaCache app-owned custody, ImageCodecHost, BasesService attachment ingestion/event publication, and main/errors
 * [OUTPUT]: Provides cache-first automatic ingestion, isolated validation of byte-exact oversized originals and receipt-gated ACK/recovery-window release.
 * [POS]: bases/media-host's ingestion boundary; never touches TurnRegistry directly and never accepts a bare filesystem path — it copies the source into the app-owned cache before decoding
 */

import type { BasesService } from "../bases-service";
import { errorMessage } from "../../errors";
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
      this.warn(`图片 ${event.logicalKey} 自动入库失败：${result.error.message}`);
    }
    // 确定性冲突（tombstone/指纹）重试永不改变结果，ACK 掉避免每次
    // 启动 reconcile 重复告警；可重试错误保留 journal 待下次收敛。
    const settled = result.ok || result.error.code === "ATTACHMENT_CONFLICT";
    if (settled && (await this.broker.acknowledge(event))) {
      await this.releaseAfterReceipt(event);
    }
    return result;
  }

  /** 自动入库失败对用户是可见事实：日志留证，同时推一条 warning 事件到 renderer。 */
  private warn(message: string) {
    console.warn(message);
    this.bases.publishEvent({ type: "warning", message });
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
      const lease = await this.broker.reissueLease(event.sourceRef);
      if (!lease) continue;
      await this.ingest({ ...event, lease }).catch((cause) => {
        this.warn(
          `图片 ${event.logicalKey} reconcile 失败：${errorMessage(cause)}`
        );
      });
    }
  }

  reconcileAll() {
    return this.reconcile();
  }
}
