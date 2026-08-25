/**
 * [INPUT]: Depends on Node fsync journal/realpath/stat, BrowserWindow, canonical image source resolver and durable cache source resolver
 * [OUTPUT]: Provides a durable completion journal, stable completedAt, intergenerational CAS ACK/reference query, multiple subscriptions to TurnEventsBroker, canonical paths between restarting the reset and pathless renderer projections
 * [POS]: The gallery's completed event arbitrator; Before you get durable custody, then project, lease and savePath stay in the main forever
 */

import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
} from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import type { BrowserWindow } from "electron";
import { z } from "zod";
import {
  GALLERY_MEDIA_CHANNEL,
  galleryOccurrenceKey,
  transcriptGallerySourceRefSchema,
  type GalleryItemProjectionEventV1,
  type TranscriptGallerySourceRef,
} from "../../../shared/gallery-media-ipc";

export type WorkspaceReadLease = {
  sourcePath: string;
  workspaceRoot: string;
  size: number;
  mtimeMs: number;
  ctimeMs: number;
  issuedAt: number;
};

export type CompletedImageEventV1 = GalleryItemProjectionEventV1 & {
  lease: WorkspaceReadLease;
  journalToken: string;
};

type Subscriber = (event: CompletedImageEventV1) => Promise<void> | void;

type DurableLeaseSource = {
  sourcePath: string;
  readRoot: string;
};

type TurnEventsBrokerOptions = {
  resolveDurableSource?(
    sourceRef: TranscriptGallerySourceRef
  ): Promise<DurableLeaseSource | null>;
  resolveCanonicalSource?(
    sourceRef: TranscriptGallerySourceRef
  ): Promise<DurableLeaseSource | null>;
};

export class TurnEventsBroker {
  private readonly subscribers = new Set<Subscriber>();
  private readonly inflight = new Map<string, Promise<void>>();
  private readonly failures = new Map<string, unknown>();
  private readonly completed = new Set<string>();
  private readonly leases = new Map<string, CompletedImageEventV1>();
  private readonly windows = new Set<BrowserWindow>();
  private mutationTail = Promise.resolve();

  constructor(
    private readonly journalRoot?: string,
    private readonly options: TurnEventsBrokerOptions = {}
  ) {}

  async initialize() {
    if (!this.journalRoot) return;
    await mkdir(this.journalRoot, { recursive: true, mode: 0o700 });
    for (const entry of await readdir(this.journalRoot, {
      withFileTypes: true,
    })) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      const path = join(this.journalRoot, entry.name);
      let event: CompletedImageEventV1;
      try {
        const parsed = completedImageEventSchema.parse(
          JSON.parse(await readFile(path, "utf8"))
        );
        event = {
          ...parsed,
          journalToken: parsed.journalToken ?? legacyJournalToken(parsed),
        };
      } catch (cause) {
        // completion journal 是 best-effort 入库的辅助账本：单文件损坏
        // 隔离为 .corrupt 继续启动，缺失的事件由 canonical reconcile 收敛。
        console.warn(
          `[gallery] completion journal 损坏，已隔离：${path}`,
          cause
        );
        await rename(path, `${path}.corrupt`).catch(() => undefined);
        continue;
      }
      this.leases.set(galleryOccurrenceKey(event.sourceRef), event);
    }
  }

  subscribe(subscriber: Subscriber) {
    this.subscribers.add(subscriber);
    return () => this.subscribers.delete(subscriber);
  }

  attachWindow(window: BrowserWindow) {
    this.windows.add(window);
    window.once("closed", () => this.windows.delete(window));
  }

  complete(input: {
    sourceRef: TranscriptGallerySourceRef;
    savedPath: string;
    workspaceRoot: string;
    messageId?: string;
    itemOrdinal: number;
    completedAt?: number;
  }) {
    return this.enqueueMutation(() => this.completeOne(input));
  }

  private async completeOne(input: {
    sourceRef: TranscriptGallerySourceRef;
    savedPath: string;
    workspaceRoot: string;
    messageId?: string;
    itemOrdinal: number;
    completedAt?: number;
  }) {
    const key = galleryOccurrenceKey(input.sourceRef);
    let lease: WorkspaceReadLease;
    try {
      lease = await issueLease(input.savedPath, input.workspaceRoot);
    } catch (cause) {
      this.failures.set(key, cause);
      throw cause;
    }
    const sourceRevision = workspaceLeaseRevision(lease);
    const previous = this.leases.get(key);
    if (
      previous &&
      !sameCompletion(previous, {
        sourceRef: input.sourceRef,
        messageId: input.messageId,
        itemOrdinal: input.itemOrdinal,
        sourceRevision,
      })
    ) {
      throw Object.assign(new Error("COMPLETION_CONFLICT"), {
        code: "COMPLETION_CONFLICT",
      });
    }
    const event: CompletedImageEventV1 = {
      schemaVersion: 1,
      type: "completed-image",
      sourceRef: input.sourceRef,
      ...(input.messageId ? { messageId: input.messageId } : {}),
      itemOrdinal: input.itemOrdinal,
      logicalKey: `transcript:${input.sourceRef.assistantSeq}:${input.sourceRef.itemId}`,
      sourceRevision,
      completedAt:
        previous?.completedAt ??
        input.completedAt ??
        Math.floor(lease.mtimeMs),
      lease,
      journalToken: randomUUID(),
    };
    await this.persist(event);
    this.failures.delete(key);
    this.completed.delete(key);
    this.leases.set(key, event);

    const tasks = [...this.subscribers].map((subscriber) =>
      Promise.resolve().then(() => subscriber(event))
    );
    const inFlight = Promise.all(tasks).then(
      () => {
        if (this.leases.get(key)?.journalToken === event.journalToken) {
          this.completed.add(key);
        }
      },
      (cause) => {
        if (this.leases.get(key)?.journalToken === event.journalToken) {
          this.failures.set(key, cause);
        }
        throw cause;
      }
    );
    this.inflight.set(key, inFlight);
    void inFlight.catch(() => undefined);
    const clear = () => {
      if (this.inflight.get(key) === inFlight) this.inflight.delete(key);
    };
    void inFlight.then(clear, clear);

    const {
      lease: _mainOnly,
      journalToken: _journalToken,
      ...projection
    } = event;
    for (const window of this.windows) {
      if (window.isDestroyed()) continue;
      window.webContents.send(GALLERY_MEDIA_CHANNEL.event, projection);
    }
    return projection;
  }

  join(sourceRef: TranscriptGallerySourceRef) {
    const key = galleryOccurrenceKey(sourceRef);
    const inFlight = this.inflight.get(key);
    if (inFlight) return inFlight;
    const failure = this.failures.get(key);
    if (failure) return Promise.reject(failure);
    return undefined;
  }

  status(sourceRef: TranscriptGallerySourceRef) {
    const key = galleryOccurrenceKey(sourceRef);
    if (this.inflight.has(key)) return "pending" as const;
    if (this.failures.has(key)) return "failed" as const;
    if (this.completed.has(key)) return "complete" as const;
    return "unknown" as const;
  }

  async reissueLease(sourceRef: TranscriptGallerySourceRef) {
    // 重签只信当前 canonical 定位；resolver 未接线一律拒发。
    // journal 中的旧 workspace 路径在任何分支下都不重新授权。
    if (!this.options.resolveCanonicalSource) return null;
    const canonical = await this.options.resolveCanonicalSource(sourceRef);
    if (!canonical) {
      await this.acknowledge(sourceRef);
      return null;
    }
    try {
      return await issueLease(canonical.sourcePath, canonical.readRoot);
    } catch {
      // 当前 canonical 路径不可读时，才允许回退 app-owned cache。
    }
    const durable = await this.options.resolveDurableSource?.(sourceRef);
    return durable
      ? issueLease(durable.sourcePath, durable.readRoot)
      : null;
  }

  completedEvents(chatId?: string, incarnationId?: string) {
    return [...this.leases.values()].filter(
      (event) =>
        (!chatId || event.sourceRef.chatId === chatId) &&
        (!incarnationId ||
          event.sourceRef.incarnationId === incarnationId)
    );
  }

  hasCompletion(sourceRef: TranscriptGallerySourceRef) {
    return this.leases.has(galleryOccurrenceKey(sourceRef));
  }

  acknowledge(
    expected: TranscriptGallerySourceRef | CompletedImageEventV1
  ) {
    return this.enqueueMutation(() => this.acknowledgeOne(expected));
  }

  private async acknowledgeOne(
    expected: TranscriptGallerySourceRef | CompletedImageEventV1
  ) {
    const sourceRef =
      "sourceRef" in expected ? expected.sourceRef : expected;
    const key = galleryOccurrenceKey(sourceRef);
    if (
      "sourceRef" in expected &&
      this.leases.get(key)?.journalToken !== expected.journalToken
    ) {
      return false;
    }
    if (this.journalRoot) {
      await rm(this.journalPath(sourceRef), { force: true });
      await fsyncDirectory(this.journalRoot);
    }
    this.leases.delete(key);
    this.completed.delete(key);
    this.failures.delete(key);
    return true;
  }

  hasInFlight() {
    return this.inflight.size > 0;
  }

  private async persist(event: CompletedImageEventV1) {
    if (!this.journalRoot) return;
    const path = this.journalPath(event.sourceRef);
    await durableJson(path, completedImageEventSchema.parse(event));
  }

  private journalPath(sourceRef: TranscriptGallerySourceRef) {
    const key = galleryOccurrenceKey(sourceRef);
    const digest = createHash("sha256").update(key).digest("hex");
    return join(this.journalRoot!, `${digest}.json`);
  }

  private enqueueMutation<T>(task: () => Promise<T>) {
    const result = this.mutationTail.then(task, task);
    this.mutationTail = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }
}

const workspaceReadLeaseSchema = z
  .object({
    sourcePath: z.string().min(1),
    workspaceRoot: z.string().min(1),
    size: z.number().int().positive().max(25 * 1024 * 1024),
    mtimeMs: z.number().finite().nonnegative(),
    ctimeMs: z.number().finite().nonnegative(),
    issuedAt: z.number().finite().nonnegative(),
  })
  .strict();

const completedImageEventSchema = z
  .object({
    schemaVersion: z.literal(1),
    type: z.literal("completed-image"),
    sourceRef: transcriptGallerySourceRefSchema,
    messageId: z.string().min(1).max(256).optional(),
    itemOrdinal: z.number().int().nonnegative(),
    logicalKey: z.string().min(1).max(512),
    sourceRevision: z.string().min(1).max(256),
    completedAt: z.number().finite().nonnegative(),
    lease: workspaceReadLeaseSchema,
    journalToken: z.string().uuid().optional(),
  })
  .strict()
  .superRefine((event, context) => {
    const logicalKey =
      `transcript:${event.sourceRef.assistantSeq}:${event.sourceRef.itemId}`;
    if (
      event.logicalKey !== logicalKey ||
      event.sourceRevision !== workspaceLeaseRevision(event.lease)
    ) {
      context.addIssue({
        code: "custom",
        message: "Completed image immutable identity 冲突",
      });
    }
  });

async function issueLease(
  savedPath: string,
  workspaceRoot: string
): Promise<WorkspaceReadLease> {
  const root = await realpath(workspaceRoot);
  const source = await realpath(resolve(workspaceRoot, savedPath));
  const relation = relative(root, source);
  // win32 跨盘符时 relative 返回绝对路径而非 ../ 前缀，必须一并拒绝
  if (
    relation === ".." ||
    isAbsolute(relation) ||
    relation.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)
  ) {
    throw Object.assign(new Error("OUT_OF_WORKSPACE"), {
      code: "OUT_OF_WORKSPACE",
    });
  }
  const snapshot = await stat(source);
  if (!snapshot.isFile() || snapshot.size > 25 * 1024 * 1024) {
    throw Object.assign(new Error("BUDGET_EXCEEDED"), {
      code: "BUDGET_EXCEEDED",
    });
  }
  return {
    sourcePath: source,
    workspaceRoot: root,
    size: snapshot.size,
    mtimeMs: snapshot.mtimeMs,
    ctimeMs: snapshot.ctimeMs,
    issuedAt: Date.now(),
  };
}

function workspaceLeaseRevision(lease: WorkspaceReadLease) {
  return `${lease.size}:${lease.mtimeMs}:${lease.ctimeMs}`;
}

function sameCompletion(
  event: CompletedImageEventV1,
  input: {
    sourceRef: TranscriptGallerySourceRef;
    messageId?: string;
    itemOrdinal: number;
    sourceRevision: string;
  }
) {
  return (
    galleryOccurrenceKey(event.sourceRef) ===
      galleryOccurrenceKey(input.sourceRef) &&
    event.messageId === input.messageId &&
    event.itemOrdinal === input.itemOrdinal &&
    event.sourceRevision === input.sourceRevision
  );
}

function legacyJournalToken(
  event: Omit<CompletedImageEventV1, "journalToken"> & {
    journalToken?: string;
  }
) {
  return createHash("sha256")
    .update(
      [
        galleryOccurrenceKey(event.sourceRef),
        event.sourceRevision,
        event.completedAt,
        event.lease.issuedAt,
      ].join("\0")
    )
    .digest("hex");
}

async function durableJson(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${randomUUID()}.tmp`;
  const file = await open(temporary, "wx", 0o600);
  try {
    await file.writeFile(JSON.stringify(value));
    await file.sync();
  } finally {
    await file.close();
  }
  try {
    await rename(temporary, path);
    await fsyncDirectory(dirname(path));
  } catch (cause) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw cause;
  }
}

async function fsyncDirectory(path: string) {
  const directory = await open(path, "r");
  try {
    await directory.sync();
  } catch (cause) {
    if (!isCode(cause, "EINVAL") && !isCode(cause, "ENOTSUP")) {
      throw cause;
    }
  } finally {
    await directory.close();
  }
}

function isCode(cause: unknown, code: string) {
  return (
    cause instanceof Error &&
    "code" in cause &&
    (cause as NodeJS.ErrnoException).code === code
  );
}
