/**
 * [INPUT]: Depends on the type of original text object used in Node fs/path, persistence/SerialQueue and usage-merge
 * [OUTPUT]: Provides v2 usage-cache rigorous testing loading, model/four-barrel fact sequencing, atomic replacement and drain by source
 * [POS]: The use of performance caching; Save only event/meta/fast snapshot, no time zone, scope root, price or aggregate results
 */

import {
  mkdir,
  readFile,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  USAGE_SOURCE_ORDER,
  type UsageSourceId,
} from "../../../shared/usage-ipc";
import { SerialQueue } from "../persistence/serial-queue";
import type { FileEvents } from "./usage-merge";

export const CACHE_VERSION = 2;

export type FileSnapshot = {
  mtimeMs: number;
  size: number;
  dev: number;
  ino: number;
  ctimeMs: number;
};

export type UsageCacheEntry = {
  source: UsageSourceId;
  snap: FileSnapshot;
  file: FileEvents;
};

export type UsageCacheLoad = {
  entries: Map<string, UsageCacheEntry>;
  damaged: boolean;
};

export interface UsageCacheLike {
  load(): Promise<UsageCacheLoad>;
  commitBatch(
    source: UsageSourceId,
    entries: Map<string, UsageCacheEntry>
  ): Promise<void>;
  closeAndFlush(): Promise<void>;
  reopen(): void;
}

function finite(value: unknown) {
  return typeof value === "number" && Number.isFinite(value);
}

function nonNegative(value: unknown) {
  return finite(value) && (value as number) >= 0;
}

function parseEntry(value: unknown): UsageCacheEntry | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (!USAGE_SOURCE_ORDER.includes(record.source as UsageSourceId)) return null;
  const snap = record.snap as Record<string, unknown> | undefined;
  const events = Array.isArray(record.events) ? record.events : null;
  if (
    !snap ||
    !["mtimeMs", "size", "dev", "ino", "ctimeMs"].every((key) =>
      finite(snap[key])
    ) ||
    !events
  ) {
    return null;
  }
  const parsedEvents = events.map((event) => {
    if (!event || typeof event !== "object" || Array.isArray(event)) return null;
    const item = event as Record<string, unknown>;
    if (
      !(typeof item.u === "string" || item.u === null) ||
      !nonNegative(item.t) ||
      !finite(item.ts)
    ) {
      return null;
    }
    const model = item.m === undefined
      ? null
      : typeof item.m === "string" && item.m.length > 0
        ? item.m
        : undefined;
    if (model === undefined) return null;
    let buckets: FileEvents["events"][number]["buckets"] = null;
    if (item.b !== undefined) {
      if (
        !Array.isArray(item.b) ||
        item.b.length !== 4 ||
        item.b.some((value) => !nonNegative(value)) ||
        (item.b as number[]).reduce((sum, value) => sum + value, 0) !== item.t
      ) {
        return null;
      }
      buckets = {
        input: item.b[0] as number,
        cacheRead: item.b[1] as number,
        cacheWrite: item.b[2] as number,
        output: item.b[3] as number,
      };
    }
    return {
      tuple: item.u as string | null,
      tokens: item.t as number,
      tsMs: item.ts as number,
      model,
      buckets,
    };
  });
  if (parsedEvents.some((event) => event === null)) return null;
  const metaValue = record.meta;
  const meta =
    metaValue &&
    typeof metaValue === "object" &&
    !Array.isArray(metaValue) &&
    typeof (metaValue as Record<string, unknown>).nodeId === "string" &&
    (typeof (metaValue as Record<string, unknown>).parentId === "string" ||
      (metaValue as Record<string, unknown>).parentId === null) &&
    (typeof (metaValue as Record<string, unknown>).rootHint === "string" ||
      (metaValue as Record<string, unknown>).rootHint === null)
      ? {
          nodeId: (metaValue as Record<string, string>).nodeId,
          parentId: (metaValue as Record<string, string | null>).parentId,
          rootHint: (metaValue as Record<string, string | null>).rootHint,
        }
      : undefined;
  if (
    record.source === "codex" &&
    !meta
  ) {
    return null;
  }
  if (
    !Number.isSafeInteger(record.fl) ||
    (record.fl as number) < 0 ||
    typeof record.deg !== "boolean"
  ) {
    return null;
  }
  return {
    source: record.source as UsageSourceId,
    snap: snap as FileSnapshot,
    file: {
      events: parsedEvents as FileEvents["events"],
      failedLines: record.fl as number,
      ...(meta ? { meta } : {}),
      scopeDegraded: record.deg === true,
    },
  };
}

function serializeEntry(entry: UsageCacheEntry) {
  return {
    source: entry.source,
    snap: entry.snap,
    ...(entry.file.meta ? { meta: entry.file.meta } : {}),
    fl: entry.file.failedLines,
    deg: entry.file.scopeDegraded === true,
    events: entry.file.events.map((event) => ({
      u: event.tuple,
      t: event.tokens,
      ts: event.tsMs,
      ...(event.model ? { m: event.model } : {}),
      ...(event.buckets
        ? {
            b: [
              event.buckets.input,
              event.buckets.cacheRead,
              event.buckets.cacheWrite,
              event.buckets.output,
            ],
          }
        : {}),
    })),
  };
}

export function snapshotsEqual(left: FileSnapshot, right: FileSnapshot) {
  return (
    left.mtimeMs === right.mtimeMs &&
    left.size === right.size &&
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.ctimeMs === right.ctimeMs
  );
}

export class UsageCache implements UsageCacheLike {
  private readonly path: string;
  private readonly queue = new SerialQueue();
  private entries = new Map<string, UsageCacheEntry>();
  private loaded = false;
  private writeId = 0;

  constructor(userData: string) {
    this.path = join(userData, "usage-cache.json");
  }

  async load(): Promise<UsageCacheLoad> {
    if (this.loaded) return { entries: new Map(this.entries), damaged: false };
    this.loaded = true;
    try {
      const parsed = JSON.parse(await readFile(this.path, "utf8")) as {
        version?: unknown;
        files?: unknown;
      };
      if (
        parsed.version !== CACHE_VERSION ||
        !parsed.files ||
        typeof parsed.files !== "object" ||
        Array.isArray(parsed.files)
      ) {
        return { entries: new Map(), damaged: true };
      }
      const next = new Map<string, UsageCacheEntry>();
      for (const [path, value] of Object.entries(parsed.files)) {
        const entry = parseEntry(value);
        if (!entry) return { entries: new Map(), damaged: true };
        next.set(path, entry);
      }
      this.entries = next;
      return { entries: new Map(next), damaged: false };
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === "ENOENT") {
        return { entries: new Map(), damaged: false };
      }
      this.entries.clear();
      return { entries: new Map(), damaged: true };
    }
  }

  commitBatch(
    source: UsageSourceId,
    entries: Map<string, UsageCacheEntry>
  ) {
    return this.queue.enqueue(async () => {
      const next = new Map(
        [...this.entries].filter(([, entry]) => entry.source !== source)
      );
      for (const [path, entry] of entries) next.set(path, entry);
      const files = Object.fromEntries(
        [...next]
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([path, entry]) => [path, serializeEntry(entry)])
      );
      await mkdir(dirname(this.path), { recursive: true });
      const temporary = `${this.path}.tmp-${process.pid}-${++this.writeId}`;
      try {
        await writeFile(
          temporary,
          `${JSON.stringify({ version: CACHE_VERSION, files })}\n`,
          { encoding: "utf8", mode: 0o600 }
        );
        await rename(temporary, this.path);
        this.entries = next;
      } catch (cause) {
        await unlink(temporary).catch(() => undefined);
        throw cause;
      }
    });
  }

  async closeAndFlush() {
    this.queue.close();
    await this.queue.flush();
  }

  reopen() {
    this.queue.reopen();
  }
}
