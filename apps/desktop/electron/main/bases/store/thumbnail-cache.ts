/**
 * [INPUT]: Depends on Electron nativeImage; Receive bytes of an image that is already owned, content address key and fixed bucket
 * [OUTPUT]: Provides a single-fly, four-way linear key; decodes itself to the main thread; sequence-by-section events are allowed to be passed); 64MiB/128 LRU shortened data URL
 * [POS]: The database contains the database of the databaseRebuild without loss of business ownership, deletion or restart
 */

import { nativeImage } from "electron";

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

  get(key: string, input: Buffer, bucket: number) {
    const cached = this.entries.get(key);
    if (cached) {
      this.entries.delete(key);
      this.entries.set(key, cached);
      return Promise.resolve(stripSize(cached));
    }
    const flight = this.flights.get(key);
    if (flight) return flight;
    const created = this.create(key, input, bucket);
    this.flights.set(key, created);
    return created.finally(() => this.flights.delete(key));
  }

  clearFamily(prefix: string) {
    for (const key of this.entries.keys()) {
      if (!key.startsWith(prefix)) continue;
      const entry = this.entries.get(key)!;
      this.entries.delete(key);
      this.bytes -= entry.bytes;
    }
  }

  private async create(key: string, input: Buffer, bucket: number) {
    await this.acquire();
    try {
      // nativeImage 解码是 main 线程同步操作；每张缩略图前让渡一次
      // 事件循环，避免批量请求把 IPC/渲染事件饿死。
      await new Promise<void>((resolve) => setImmediate(resolve));
      const value = makeThumbnail(input, bucket);
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

function makeThumbnail(input: Buffer, bucket: number): CachedThumbnail {
  const image = nativeImage.createFromBuffer(input);
  if (image.isEmpty()) throw codedError("DECODE_FAILED", "图片解码失败");
  const size = image.getSize();
  const scale = Math.min(1, bucket / Math.max(size.width, size.height));
  const width = Math.max(1, Math.round(size.width * scale));
  const height = Math.max(1, Math.round(size.height * scale));
  const thumbnail =
    scale < 1 ? image.resize({ width, height, quality: "good" }) : image;
  return { dataUrl: thumbnail.toDataURL(), width, height };
}

function stripSize(entry: Entry): CachedThumbnail {
  return {
    dataUrl: entry.dataUrl,
    width: entry.width,
    height: entry.height,
  };
}

function codedError(code: string, message: string) {
  return Object.assign(new Error(message), { code });
}
