/**
 * [INPUT]: Depends on the isolated Sharp codec host, verified image bytes and a bounded target size.
 * [OUTPUT]: Provides cancellable four-format thumbnails, per-key singleflight and a 64 MiB/128-entry LRU.
 * [POS]: Derived Base image cache; decoding stays outside main and source bytes are never rewritten.
 */

import { ImageCodecHost } from "../media-host/codec-host";
import { parseAttachmentImageHeader } from "../../gallery/image-header";
import { BASE_ATTACHMENT_JOB_LIMIT, BASE_ATTACHMENT_QUEUE_BYTES } from "../../../../shared/bases/gallery-attachments";

const ENTRY_LIMIT = 128;
const BYTE_LIMIT = 64 * 1024 * 1024;
const CONCURRENCY = 4;

export type CachedThumbnail = {
  dataUrl: string;
  width: number;
  height: number;
};

type Entry = CachedThumbnail & { bytes: number };

export class AttachmentThumbnailCache {
  private readonly entries = new Map<string, Entry>();
  private readonly flights = new Map<string, Promise<CachedThumbnail>>();
  private readonly waiters: Array<() => void> = [];
  private active = 0;
  private bytes = 0;
  private pendingBytes = 0;
  constructor(private readonly codec = new ImageCodecHost()) {}

  get(key: string, input: Buffer, bucket: number, signal?: AbortSignal) {
    signal?.throwIfAborted();
    const cached = this.entries.get(key);
    if (cached) {
      this.entries.delete(key);
      this.entries.set(key, cached);
      return Promise.resolve(stripSize(cached));
    }
    const flight = this.flights.get(key);
    if (flight) return flight;
    if (this.flights.size >= BASE_ATTACHMENT_JOB_LIMIT || this.pendingBytes + input.length > BASE_ATTACHMENT_QUEUE_BYTES) {
      return Promise.reject(Object.assign(new Error("QUEUE_FULL"), { code: "QUEUE_FULL" }));
    }
    this.pendingBytes += input.length;
    const created = this.create(key, input, bucket, signal);
    this.flights.set(key, created);
    return created.finally(() => { this.flights.delete(key); this.pendingBytes -= input.length; });
  }

  clearFamily(prefix: string) {
    for (const key of this.entries.keys()) {
      if (!key.startsWith(prefix)) continue;
      const entry = this.entries.get(key)!;
      this.entries.delete(key);
      this.bytes -= entry.bytes;
    }
  }

  private async create(key: string, input: Buffer, bucket: number, signal?: AbortSignal) {
    await this.acquire();
    try {
      const output = await this.codec.thumbnail(input, bucket, signal);
      signal?.throwIfAborted();
      const { width, height } = parseAttachmentImageHeader(output);
      const value = { dataUrl: `data:image/png;base64,${output.toString("base64")}`, width, height };
      this.insert(key, value);
      return value;
    } finally {
      this.release();
    }
  }

  private insert(key: string, value: CachedThumbnail) {
    const entry = { ...value, bytes: Buffer.byteLength(value.dataUrl) };
    this.entries.set(key, entry);
    this.bytes += entry.bytes;
    while (this.entries.size > ENTRY_LIMIT || this.bytes > BYTE_LIMIT) {
      const oldest = this.entries.keys().next().value as string | undefined;
      if (!oldest) break;
      const removed = this.entries.get(oldest)!;
      this.entries.delete(oldest);
      this.bytes -= removed.bytes;
    }
  }

  private acquire() {
    if (this.active < CONCURRENCY) {
      this.active += 1;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => this.waiters.push(resolve)).then(
      () => {
        this.active += 1;
      }
    );
  }

  private release() {
    this.active -= 1;
    this.waiters.shift()?.();
  }
}

function stripSize(entry: Entry): CachedThumbnail {
  return {
    dataUrl: entry.dataUrl,
    width: entry.width,
    height: entry.height,
  };
}
