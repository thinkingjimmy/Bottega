/**
 * [INPUT]: Depends on Electron nativeImage/BrowserWindow, ChatStore, GalleryMediaCache, TurnEventsBroker, active-turn query and sourceRef IPC schema
 * [OUTPUT]: Provides sourceRef-only GalleryMediaService, transcript/attachment Submit backsource authorization, cache→canonical lease Backward, incarnation fence, ≤12MP single-fly decoding and dual-budget LRU
 * [POS]: The renderer media parsing port of the gallery; Paths are only analyzed by receiving cache index or canonical lease in the main
 */

import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { BrowserWindow, nativeImage } from "electron";
import {
  galleryMaterializeInputSchema,
  galleryThumbnailInputSchema,
  GALLERY_MEDIA_CHANNEL,
  GALLERY_THUMB_BUCKETS,
  type GalleryMediaErrorCode,
  type GalleryMaterializeResult,
  type GalleryMediaSourceRef,
  type GallerySourceRef,
  type GalleryThumbnailResult,
} from "../../../shared/gallery-media-ipc";
import type { ChatStore } from "../chats/chat-store";
import { rendererIpc } from "../ipc-registrar";
import type { GalleryMediaCache } from "./media-cache";
import type { GalleryMediaIndexRecordV1 } from "../../../shared/gallery-media-ipc";
import type { TurnEventsBroker } from "./turn-events-broker";
import { parseAttachmentImageHeader } from "./image-header";

type CacheEntry<T> = { value: T; bytes: number };
type AuthorizedTranscriptMedia = {
  record: GalleryMediaIndexRecordV1;
  path: string;
  bytes?: Buffer;
};
type AttachmentMediaPort = {
  assertAuthorized(
    sourceRef: Extract<GalleryMediaSourceRef, { kind: "attachment" }>,
    destinationChatId: string
  ): Promise<boolean>;
  thumbnail(
    sourceRef: Extract<GalleryMediaSourceRef, { kind: "attachment" }>,
    maxEdge: number
  ): Promise<GalleryThumbnailResult>;
  materialize(
    sourceRef: Extract<GalleryMediaSourceRef, { kind: "attachment" }>,
    destinationChatId: string
  ): Promise<GalleryMaterializeResult>;
};

export class GalleryMediaService {
  private tail = Promise.resolve();
  private queued = 0;
  private queuedBytes = 0;
  private readonly thumbs = new LruCache<unknown>(64 * 1024 * 1024, 256);
  private readonly materialized = new LruCache<unknown>(32 * 1024 * 1024, 32);
  private attachmentMedia?: AttachmentMediaPort;

  constructor(
    private readonly store: ChatStore,
    private readonly cache: GalleryMediaCache,
    private readonly broker: TurnEventsBroker,
    private readonly isActiveSource: (sourceRef: GallerySourceRef) => boolean
  ) {}

  /** attachment port 唯一注入通道；Base 接线晚于 media service 构造。 */
  setAttachmentMedia(port: AttachmentMediaPort) {
    this.attachmentMedia = port;
  }

  register(window: BrowserWindow, rendererUrl: string) {
    this.broker.attachWindow(window);
    rendererIpc(window, rendererUrl, "拒绝非主窗口的 Gallery 媒体请求")
      .handle(GALLERY_MEDIA_CHANNEL.thumbnail, async (raw) => {
        const input = galleryThumbnailInputSchema.parse(raw);
        return this.thumbnail(input.sourceRef, input.maxEdge);
      })
      .handle(GALLERY_MEDIA_CHANNEL.materialize, async (raw) => {
        const input = galleryMaterializeInputSchema.parse(raw);
        return this.materialize(input.sourceRef, input.destinationChatId);
      });
  }

  async assertAuthorizedSource(
    sourceRef: GalleryMediaSourceRef,
    destinationChatId: string
  ) {
    if (sourceRef.kind === "attachment") {
      const authorized = await this.attachmentMedia?.assertAuthorized(
        sourceRef,
        destinationChatId
      );
      if (!authorized) throw codedError("SOURCE_GONE");
      return;
    }
    if (sourceRef.chatId !== destinationChatId) {
      throw codedError("OUT_OF_WORKSPACE");
    }
    await this.authorize(sourceRef);
  }

  private async thumbnail(sourceRef: GalleryMediaSourceRef, maxEdge: number) {
    if (sourceRef.kind === "attachment") {
      return this.attachmentMedia?.thumbnail(sourceRef, maxEdge) ??
        mediaFailure(codedError("SOURCE_GONE"));
    }
    try {
      const media = await this.authorize(sourceRef);
      const { record } = media;
      const bucket =
        GALLERY_THUMB_BUCKETS.find((value) => value >= maxEdge) ?? 1024;
      const key = mediaCacheKey("thumb", sourceRef, record, `png:${bucket}`);
      const cached = this.thumbs.get(key) as
        | { dataUrl: string; width: number; height: number }
        | undefined;
      const value =
        cached ??
        (await this.decode(bucket, "png", media));
      // 单次 IPC 结果 ≤8MiB；超限条目不得进 LRU 污染缓存
      if (Buffer.byteLength(value.dataUrl) > 8 * 1024 * 1024) {
        throw codedError("TOO_LARGE");
      }
      if (!cached) this.thumbs.set(key, value, Buffer.byteLength(value.dataUrl));
      return { ok: true, value: { ...value, bucket, sourceRevision: record.sourceRevision } } as const;
    } catch (cause) {
      return mediaFailure(cause);
    }
  }

  private async materialize(
    sourceRef: GalleryMediaSourceRef,
    destinationChatId: string
  ) {
    if (sourceRef.kind === "attachment") {
      return this.attachmentMedia?.materialize(sourceRef, destinationChatId) ??
        mediaFailure(codedError("SOURCE_GONE"));
    }
    try {
      if (sourceRef.chatId !== destinationChatId) {
        throw codedError("OUT_OF_WORKSPACE");
      }
      const media = await this.authorize(sourceRef);
      const { record } = media;
      const key = mediaCacheKey("materialize", sourceRef, record, "png:1024");
      const cached = this.materialized.get(key) as
        | { dataUrl: string; width: number; height: number }
        | undefined;
      const value =
        cached ??
        (await this.decode(1024, "png", media));
      // 超限先判再入缓存：永远发不出去的条目不配挤掉有效 LRU 条目
      if (Buffer.byteLength(value.dataUrl) > 8 * 1024 * 1024) {
        throw codedError("TOO_LARGE");
      }
      if (!cached) {
        this.materialized.set(key, value, Buffer.byteLength(value.dataUrl));
      }
      const attachmentId = createHash("sha256")
        .update(`${sourceRef.incarnationId}:${sourceRef.assistantSeq}:${sourceRef.itemId}:`)
        .update(value.dataUrl)
        .digest("hex")
        .slice(0, 20);
      return {
        ok: true,
        value: {
          attachmentId,
          filename: `${attachmentId}.png`,
          mediaType: "image/png",
          dataUrl: value.dataUrl,
          sourceRevision: record.sourceRevision,
          materializationToken: randomUUID(),
        },
      } as const;
    } catch (cause) {
      return mediaFailure(cause);
    }
  }

  private async authorize(
    sourceRef: GallerySourceRef
  ): Promise<AuthorizedTranscriptMedia> {
    const record = await this.store.get(sourceRef.chatId);
    if (!record || record.incarnationId !== sourceRef.incarnationId) {
      throw codedError("INCARNATION_MISMATCH");
    }
    const canonical = record.messages.find(
      (message) =>
        message.role === "assistant" &&
        message.seq === sourceRef.assistantSeq
    );
    if (canonical) {
      const present = canonical.parts?.some(
        (part) =>
          part.type === "tool" &&
          part.tool === "image" &&
          part.status === "completed" &&
          part.itemId === sourceRef.itemId
      );
      if (!present) throw codedError("SOURCE_GONE");
    } else if (!this.isActiveSource(sourceRef)) {
      throw codedError("SOURCE_GONE");
    }
    await this.broker.join(sourceRef);
    const indexed = await this.cache.lookup(sourceRef);
    if (indexed) {
      return {
        record: indexed,
        path: this.cache.mediaPath(sourceRef, indexed),
      };
    }
    const lease = await this.broker.reissueLease(sourceRef);
    if (!lease) {
      const status = this.broker.status(sourceRef);
      throw codedError(status === "pending" ? "CACHE_PENDING" : "SOURCE_GONE");
    }
    const bytes = await readFile(lease.sourcePath);
    const header = parseAttachmentImageHeader(bytes.subarray(0, 512 * 1024));
    const sourceRevision = createHash("sha256").update(bytes).digest("hex");
    return {
      bytes,
      path: lease.sourcePath,
      record: {
        schemaVersion: 1,
        incarnationId: sourceRef.incarnationId,
        assistantSeq: sourceRef.assistantSeq,
        itemId: sourceRef.itemId,
        itemOrdinal: 0,
        logicalKey: `transcript:${sourceRef.assistantSeq}:${sourceRef.itemId}`,
        sourceRevision,
        file: `${sourceRevision}.${header.extension}`,
        width: header.width,
        height: header.height,
        completedAt: 0,
        copiedAt: 0,
      },
    };
  }

  private decode(
    maxEdge: number,
    format: "png" | "jpeg",
    media: AuthorizedTranscriptMedia
  ) {
    const { record } = media;
    // main 同步 nativeImage 解码的像素硬顶：>12MP 一律拒绝，大图归隔离 codec。
    if (record.width > Math.floor(12_000_000 / record.height)) {
      throw codedError("TOO_LARGE");
    }
    if (this.queued >= 4 || this.queuedBytes + record.width * record.height * 4 > 32 * 1024 * 1024) {
      throw codedError("QUEUE_FULL");
    }
    this.queued += 1;
    this.queuedBytes += record.width * record.height * 4;
    const task = this.tail.then(async () => {
      const bytes = media.bytes ?? await readFile(media.path);
      const image = nativeImage.createFromBuffer(bytes);
      if (image.isEmpty()) throw codedError("INVALID_IMAGE");
      const size = image.getSize();
      const scale = Math.min(1, maxEdge / Math.max(size.width, size.height));
      const width = Math.max(1, Math.round(size.width * scale));
      const height = Math.max(1, Math.round(size.height * scale));
      const resized = scale < 1 ? image.resize({ width, height, quality: "good" }) : image;
      const encoded =
        format === "png" ? resized.toPNG() : resized.toJPEG(85);
      return {
        dataUrl: `data:image/${format};base64,${encoded.toString("base64")}`,
        width,
        height,
        sourceRevision: record.sourceRevision,
      };
    });
    this.tail = task.then(() => undefined, () => undefined);
    void task.then(() => {
      this.queued -= 1;
      this.queuedBytes -= record.width * record.height * 4;
    }, () => {
      this.queued -= 1;
      this.queuedBytes -= record.width * record.height * 4;
    });
    // 同步解码不可抢占：超时只 discard 结果；settle 后清定时器避免每次解码泄漏 2s 计时器
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(codedError("DECODE_TIMEOUT")), 2_000);
    });
    return Promise.race([task, timeout]).finally(() => clearTimeout(timer));
  }
}

class LruCache<T> {
  private readonly values = new Map<string, CacheEntry<T>>();
  private bytes = 0;

  constructor(
    private readonly maxBytes: number,
    private readonly maxEntries: number
  ) {}

  get(key: string) {
    const entry = this.values.get(key);
    if (!entry) return undefined;
    this.values.delete(key);
    this.values.set(key, entry);
    return entry.value;
  }

  set(key: string, value: T, bytes: number) {
    const previous = this.values.get(key);
    if (previous) this.bytes -= previous.bytes;
    this.values.delete(key);
    this.values.set(key, { value, bytes });
    this.bytes += bytes;
    while (this.bytes > this.maxBytes || this.values.size > this.maxEntries) {
      const oldest = this.values.keys().next().value as string | undefined;
      if (!oldest) break;
      const removed = this.values.get(oldest)!;
      this.values.delete(oldest);
      this.bytes -= removed.bytes;
    }
  }
}

const KNOWN_MEDIA_ERROR_CODES: readonly GalleryMediaErrorCode[] = [
  "OUT_OF_WORKSPACE",
  "INCARNATION_MISMATCH",
  "BUDGET_EXCEEDED",
  "SOURCE_GONE",
  "CACHE_PENDING",
  "QUEUE_FULL",
  "DECODE_TIMEOUT",
  "TOO_LARGE",
  "INVALID_IMAGE",
  "UNSUPPORTED_FORMAT",
  "IO_ERROR",
];

function mediaFailure(cause: unknown) {
  const rawCode = String(
    cause && typeof cause === "object" && "code" in cause
      ? (cause as { code: unknown }).code
      : "IO_ERROR"
  );
  // fs 层的 ENOENT/EACCES 等不在契约联合内，一律折叠为可重试 IO_ERROR
  const code = (KNOWN_MEDIA_ERROR_CODES as readonly string[]).includes(rawCode)
    ? (rawCode as GalleryMediaErrorCode)
    : "IO_ERROR";
  return {
    ok: false,
    error: {
      code,
      retryable: ["CACHE_PENDING", "QUEUE_FULL", "DECODE_TIMEOUT", "IO_ERROR"].includes(code),
      message: cause instanceof Error ? cause.message : code,
    },
  } as const;
}

function codedError(code: GalleryMediaErrorCode) {
  return Object.assign(new Error(code), { code });
}

function mediaCacheKey(
  kind: "thumb" | "materialize",
  sourceRef: GallerySourceRef,
  record: GalleryMediaIndexRecordV1,
  profile: string
) {
  return [
    kind,
    sourceRef.chatId,
    sourceRef.incarnationId,
    sourceRef.assistantSeq,
    sourceRef.itemId,
    record.file,
    profile,
  ].join(":");
}
