/**
 * [INPUT]: Depends on Node crypto/fs, seatbelt sandbox-exec reader, image-header and TurnEventsBroker to complete the event
 * [OUTPUT]: Provides start budget reconstruction, single and concurrent hard budget caching, atomic copying, strict v1 indexing, receipt, restore window and reference perception GC
 * [POS]: The app-owned temporary custody of the gallery; Workspace read consumption main-only lease, durable Base receipt and no longer permanently retain second media
 */

import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import {
  appendFile,
  copyFile,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  galleryOccurrenceKey,
  galleryMediaIndexRecordV1Schema,
  type GalleryMediaIndexRecordV1,
  type TranscriptGallerySourceRef,
} from "../../../shared/gallery-media-ipc";
import { parseAttachmentImageHeader } from "./image-header";
import type {
  CompletedImageEventV1,
  WorkspaceReadLease,
} from "./turn-events-broker";

const run = promisify(execFile);
const GLOBAL_BUDGET = 2 * 1024 * 1024 * 1024;
const CHAT_BUDGET = 512 * 1024 * 1024;
const QUEUE_BYTES = 64 * 1024 * 1024;
const QUEUE_JOBS = 8;
const RECOVERY_WINDOW_MS = 30_000;

export class GalleryMediaCache {
  private readonly records = new Map<string, GalleryMediaIndexRecordV1>();
  private readonly errors = new Map<string, Error>();
  private tail = Promise.resolve();
  private queuedJobs = 0;
  private queuedBytes = 0;
  private reservedGlobal = 0;
  private readonly reservedChats = new Map<string, number>();
  private committedGlobal = 0;
  private readonly committedChats = new Map<string, number>();
  private readonly loadedIndexes = new Map<string, Promise<void>>();
  // admission fence：删除链 fence 后该 incarnation 的复制一律拒绝，防止清理后目录复活
  private readonly fenced = new Set<string>();
  private readonly gcTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    private readonly root: string,
    private readonly options: {
      platform?: NodeJS.Platform;
      recoveryWindowMs?: number;
    } = {}
  ) {}

  async initialize() {
    await mkdir(this.root, { recursive: true });
    this.records.clear();
    this.errors.clear();
    this.loadedIndexes.clear();
    this.committedGlobal = 0;
    this.committedChats.clear();
    for (const chat of await readdir(this.root, { withFileTypes: true })) {
      if (!chat.isDirectory()) continue;
      let chatBytes = 0;
      const chatRoot = join(this.root, chat.name);
      for (const incarnation of await readdir(chatRoot, { withFileTypes: true })) {
        if (!incarnation.isDirectory()) continue;
        const incarnationRoot = join(chatRoot, incarnation.name);
        for (const file of await readdir(incarnationRoot, { withFileTypes: true })) {
          if (!file.isFile() || file.name === "index.jsonl" || file.name.startsWith(".")) {
            continue;
          }
          chatBytes += (await stat(join(incarnationRoot, file.name))).size;
        }
      }
      this.committedChats.set(chat.name, chatBytes);
      this.committedGlobal += chatBytes;
    }
  }

  ingest(event: CompletedImageEventV1) {
    const key = galleryOccurrenceKey(event.sourceRef);
    const bytes = event.lease.size;
    if (this.isFenced(event.sourceRef)) {
      const error = codedError("SOURCE_GONE");
      this.errors.set(key, error);
      return Promise.reject(error);
    }
    if (this.queuedJobs >= QUEUE_JOBS || this.queuedBytes + bytes > QUEUE_BYTES) {
      const error = codedError("QUEUE_FULL");
      this.errors.set(key, error);
      return Promise.reject(error);
    }
    try {
      this.reserve(event.sourceRef.chatId, bytes);
    } catch (cause) {
      const error = cause instanceof Error ? cause : codedError("IO_ERROR");
      this.errors.set(key, error);
      return Promise.reject(error);
    }
    // 重投递成功入队即清陈旧错误，否则 resolve 会被上一次失败永久遮蔽
    this.errors.delete(key);
    this.queuedJobs += 1;
    this.queuedBytes += bytes;
    const task = this.tail.then(() => this.copy(event));
    this.tail = task.then(() => undefined, () => undefined);
    return task.finally(() => {
      this.queuedJobs -= 1;
      this.queuedBytes -= bytes;
      this.release(event.sourceRef.chatId, bytes);
    });
  }

  resolve(sourceRef: TranscriptGallerySourceRef) {
    const key = galleryOccurrenceKey(sourceRef);
    const error = this.errors.get(key);
    if (error) throw error;
    return this.records.get(key) ?? null;
  }

  async lookup(sourceRef: TranscriptGallerySourceRef) {
    const current = this.resolve(sourceRef);
    if (current) return current;
    const index = join(
      this.root,
      sourceRef.chatId,
      sourceRef.incarnationId,
      "index.jsonl"
    );
    // 首次加载存 Promise 供并发请求 join：存布尔会让第二个请求在读盘完成前
    // 拿到空 records，被误判成不可重试的 SOURCE_GONE
    let loading = this.loadedIndexes.get(index);
    if (!loading) {
      loading = this.loadIndex(
        index,
        sourceRef.chatId,
        sourceRef.incarnationId
      ).catch((cause) => {
        this.loadedIndexes.delete(index);
        throw cause;
      });
      this.loadedIndexes.set(index, loading);
    }
    await loading;
    return this.resolve(sourceRef);
  }

  private async loadIndex(
    index: string,
    chatId: string,
    incarnationId: string
  ) {
    const body = await readFile(index, "utf8").catch((cause) => {
      if ((cause as NodeJS.ErrnoException).code === "ENOENT") return "";
      throw cause;
    });
    for (const line of body.split("\n")) {
      if (!line.trim()) continue;
      let raw: unknown;
      try {
        raw = JSON.parse(line);
      } catch {
        continue;
      }
      const parsed = galleryMediaIndexRecordV1Schema.safeParse(raw);
      if (!parsed.success || parsed.data.incarnationId !== incarnationId) {
        continue;
      }
      this.records.set(
        galleryOccurrenceKey(transcriptRef(chatId, parsed.data)),
        parsed.data
      );
    }
  }

  private reserve(chatId: string, bytes: number) {
    const chatBytes = this.reservedChats.get(chatId) ?? 0;
    if (
      this.committedGlobal + this.reservedGlobal + bytes > GLOBAL_BUDGET ||
      (this.committedChats.get(chatId) ?? 0) + chatBytes + bytes > CHAT_BUDGET
    ) {
      throw codedError("BUDGET_EXCEEDED");
    }
    this.reservedGlobal += bytes;
    this.reservedChats.set(chatId, chatBytes + bytes);
  }

  private release(chatId: string, bytes: number) {
    this.reservedGlobal -= bytes;
    const next = (this.reservedChats.get(chatId) ?? bytes) - bytes;
    if (next > 0) this.reservedChats.set(chatId, next);
    else this.reservedChats.delete(chatId);
  }

  private async copy(event: CompletedImageEventV1) {
    // fence 后到达执行位的排队任务同样拒绝：copy 是唯一会重建目录的路径
    if (this.isFenced(event.sourceRef)) {
      const error = codedError("SOURCE_GONE");
      this.errors.set(galleryOccurrenceKey(event.sourceRef), error);
      throw error;
    }
    const directory = join(
      this.root,
      event.sourceRef.chatId,
      event.sourceRef.incarnationId
    );
    await mkdir(directory, { recursive: true });
    const temporary = join(directory, `.copy-${randomUUID()}.tmp`);
    try {
      await copyWithSeatbelt(
        event.lease,
        temporary,
        this.options.platform ?? process.platform
      );
      await assertUnchanged(event.lease);
      const body = await readFile(temporary);
      const header = parseAttachmentImageHeader(
        body.subarray(0, 512 * 1024)
      );
      const hash = createHash("sha256").update(body).digest("hex");
      const file = `${hash}.${header.extension}`;
      const destination = join(directory, file);
      const alreadyStored = await stat(destination).then(
        () => true,
        (cause) => {
          if ((cause as NodeJS.ErrnoException).code === "ENOENT") return false;
          throw cause;
        }
      );
      try {
        await rename(temporary, destination);
      } catch (cause) {
        await unlink(temporary).catch(() => undefined);
        if ((cause as NodeJS.ErrnoException).code !== "EEXIST") throw cause;
      }
      const record: GalleryMediaIndexRecordV1 = {
        schemaVersion: 1,
        incarnationId: event.sourceRef.incarnationId,
        assistantSeq: event.sourceRef.assistantSeq,
        itemId: event.sourceRef.itemId,
        ...(event.messageId ? { messageId: event.messageId } : {}),
        itemOrdinal: event.itemOrdinal,
        logicalKey: event.logicalKey,
        sourceRevision: event.sourceRevision,
        file,
        width: header.width,
        height: header.height,
        completedAt: event.completedAt,
        copiedAt: Date.now(),
      };
      await appendFile(join(directory, "index.jsonl"), `${JSON.stringify(record)}\n`);
      this.errors.delete(galleryOccurrenceKey(event.sourceRef));
      this.records.set(galleryOccurrenceKey(event.sourceRef), record);
      if (!alreadyStored) {
        this.committedGlobal += body.length;
        this.committedChats.set(
          event.sourceRef.chatId,
          (this.committedChats.get(event.sourceRef.chatId) ?? 0) + body.length
        );
      }
      return record;
    } catch (cause) {
      await unlink(temporary).catch(() => undefined);
      const error = cause instanceof Error ? cause : new Error(String(cause));
      this.errors.set(galleryOccurrenceKey(event.sourceRef), error);
      throw error;
    }
  }

  mediaPath(sourceRef: TranscriptGallerySourceRef, record: GalleryMediaIndexRecordV1) {
    return join(
      this.root,
      sourceRef.chatId,
      sourceRef.incarnationId,
      record.file
    );
  }

  readCached(
    sourceRef: TranscriptGallerySourceRef,
    record: GalleryMediaIndexRecordV1
  ) {
    return readFile(this.mediaPath(sourceRef, record));
  }

  /**
   * receipt 已落 Base 后只再保留一个短恢复窗。定时器不维持进程存活；到点时
   * 重新问 journal 引用，避免旧 ACK 的 GC 删掉同 occurrence 的新 completion。
   */
  async releaseAfterRecoveryWindow(
    sourceRef: TranscriptGallerySourceRef,
    isReferenced: () => boolean,
    copiedAt = Date.now()
  ) {
    const key = galleryOccurrenceKey(sourceRef);
    const delay = Math.max(
      0,
      copiedAt + (this.options.recoveryWindowMs ?? RECOVERY_WINDOW_MS) - Date.now()
    );
    const previous = this.gcTimers.get(key);
    if (previous) clearTimeout(previous);
    if (!delay) {
      if (!isReferenced()) await this.releaseOccurrence(sourceRef);
      return;
    }
    const timer = setTimeout(() => {
      this.gcTimers.delete(key);
      if (isReferenced()) return;
      void this.releaseOccurrence(sourceRef);
    }, delay);
    timer.unref?.();
    this.gcTimers.set(key, timer);
  }

  /** 启动期把无 journal 引用的旧暂存压实；仍在恢复窗内的条目只排定 GC。 */
  async collectGarbage(
    referenced: ReadonlySet<string>,
    isReferenced: (sourceRef: TranscriptGallerySourceRef) => boolean
  ) {
    for (const chat of await readdir(this.root, { withFileTypes: true })) {
      if (!chat.isDirectory()) continue;
      const chatRoot = join(this.root, chat.name);
      for (const incarnation of await readdir(chatRoot, { withFileTypes: true })) {
        if (!incarnation.isDirectory()) continue;
        const index = join(chatRoot, incarnation.name, "index.jsonl");
        const records = await readIndex(index, incarnation.name);
        const latest = latestIndexRecords(chat.name, records);
        const stale = new Set<string>();
        for (const [key, record] of latest) {
          if (referenced.has(key)) continue;
          const sourceRef = transcriptRef(chat.name, record);
          const deadline =
            record.copiedAt +
            (this.options.recoveryWindowMs ?? RECOVERY_WINDOW_MS);
          if (deadline <= Date.now()) stale.add(key);
          else {
            await this.releaseAfterRecoveryWindow(
              sourceRef,
              () => isReferenced(sourceRef),
              record.copiedAt
            );
          }
        }
        if (stale.size) {
          await this.removeOccurrences(chat.name, incarnation.name, stale);
        }
      }
    }
  }

  async releaseOccurrence(sourceRef: TranscriptGallerySourceRef) {
    const task = this.tail.then(() =>
      this.removeOccurrences(
        sourceRef.chatId,
        sourceRef.incarnationId,
        new Set([galleryOccurrenceKey(sourceRef)])
      )
    );
    this.tail = task.then(() => undefined, () => undefined);
    await task;
  }

  private async removeOccurrences(
    chatId: string,
    incarnationId: string,
    removedKeys: ReadonlySet<string>
  ) {
    const directory = join(this.root, chatId, incarnationId);
    const index = join(directory, "index.jsonl");
    const latest = latestIndexRecords(
      chatId,
      await readIndex(index, incarnationId)
    );
    const removedFiles = new Set<string>();
    for (const key of removedKeys) {
      const record = latest.get(key);
      if (record) removedFiles.add(record.file);
      latest.delete(key);
      this.records.delete(key);
      this.errors.delete(key);
      const timer = this.gcTimers.get(key);
      if (timer) clearTimeout(timer);
      this.gcTimers.delete(key);
    }
    const records = [...latest.values()];
    if (records.length) {
      const temporary = join(directory, `.index-${randomUUID()}.tmp`);
      await writeFile(
        temporary,
        `${records.map((record) => JSON.stringify(record)).join("\n")}\n`,
        { mode: 0o600 }
      );
      await rename(temporary, index);
    } else {
      await rm(index, { force: true });
    }
    const retainedFiles = new Set(records.map((record) => record.file));
    for (const file of removedFiles) {
      if (retainedFiles.has(file)) continue;
      const path = join(directory, file);
      const bytes = await stat(path).then(
        (value) => value.size,
        () => 0
      );
      await rm(path, { force: true });
      this.committedGlobal = Math.max(0, this.committedGlobal - bytes);
      const chatBytes = Math.max(
        0,
        (this.committedChats.get(chatId) ?? 0) - bytes
      );
      if (chatBytes) this.committedChats.set(chatId, chatBytes);
      else this.committedChats.delete(chatId);
    }
    this.loadedIndexes.delete(index);
  }

  async fenceConversation(chatId: string, incarnationId: string) {
    this.fenced.add(`${chatId}/${incarnationId}`);
    // 复制并发为 1：等 tail 即排空该 incarnation 的在途任务（排队者被 copy 入口的 fence 拒绝）
    await this.tail.catch(() => undefined);
  }

  async releaseConversation(
    chatId: string,
    incarnationId: string,
    proof: "deleted-proven" | "unknown"
  ) {
    if (proof !== "deleted-proven") return;
    const occurrencePrefix = `${chatId}:${incarnationId}:`;
    for (const [key, timer] of this.gcTimers) {
      if (!key.startsWith(occurrencePrefix)) continue;
      clearTimeout(timer);
      this.gcTimers.delete(key);
    }
    // 串入复制 lane：rm + 全量重扫与在途 copy 并发会让 committed 计数漂移
    const task = this.tail.then(async () => {
      await rm(join(this.root, chatId, incarnationId), {
        recursive: true,
        force: true,
      });
      for (const key of [...this.records.keys()]) {
        if (key.startsWith(occurrencePrefix)) this.records.delete(key);
      }
      for (const key of [...this.errors.keys()]) {
        if (key.startsWith(occurrencePrefix)) this.errors.delete(key);
      }
      this.loadedIndexes.delete(
        join(this.root, chatId, incarnationId, "index.jsonl")
      );
      await this.initialize();
    });
    this.tail = task.then(() => undefined, () => undefined);
    return task;
  }

  private isFenced(sourceRef: TranscriptGallerySourceRef) {
    return this.fenced.has(`${sourceRef.chatId}/${sourceRef.incarnationId}`);
  }
}

async function readIndex(index: string, incarnationId: string) {
  const body = await readFile(index, "utf8").catch((cause) => {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw cause;
  });
  const records: GalleryMediaIndexRecordV1[] = [];
  for (const line of body.split("\n")) {
    if (!line.trim()) continue;
    try {
      const parsed = galleryMediaIndexRecordV1Schema.safeParse(JSON.parse(line));
      if (parsed.success && parsed.data.incarnationId === incarnationId) {
        records.push(parsed.data);
      }
    } catch {
      // cache 索引不是事实源；损坏行在下一次压实时自然消失。
    }
  }
  return records;
}

function transcriptRef(
  chatId: string,
  record: GalleryMediaIndexRecordV1
): TranscriptGallerySourceRef {
  return {
    kind: "transcript",
    chatId,
    incarnationId: record.incarnationId,
    assistantSeq: record.assistantSeq,
    itemId: record.itemId,
  };
}

function latestIndexRecords(
  chatId: string,
  records: GalleryMediaIndexRecordV1[]
) {
  return new Map(
    records.map((record) => [
      galleryOccurrenceKey(transcriptRef(chatId, record)),
      record,
    ])
  );
}

async function copyWithSeatbelt(
  lease: WorkspaceReadLease,
  destination: string,
  platform: NodeJS.Platform
) {
  const { sourcePath, workspaceRoot } = lease;
  if (platform !== "darwin") {
    await copyFile(sourcePath, destination);
    return;
  }
  const profile = [
    "(version 1)",
    "(deny default)",
    '(import "system.sb")',
    "(deny process-fork)",
    "(deny process-info*)",
    "(allow process-info* (target self))",
    '(allow process-exec (literal "/bin/cp"))',
    "(deny file-read*)",
    "(allow file-read-metadata)",
    `(allow file-read* (subpath ${quote(workspaceRoot)}))`,
    "(allow file-read* (subpath \"/Applications\"))",
    "(allow file-read* (subpath \"/Library\"))",
    "(allow file-read* (subpath \"/System\"))",
    "(allow file-read* (subpath \"/bin\"))",
    "(allow file-read* (subpath \"/private/etc\"))",
    "(allow file-read* (subpath \"/private/var/db\"))",
    "(allow file-read* (subpath \"/private/var/run\"))",
    "(allow file-read* (subpath \"/private/var/select\"))",
    "(allow file-read* (subpath \"/sbin\"))",
    "(allow file-read* (subpath \"/usr\"))",
    "(allow file-read* (literal \"/dev/null\"))",
    "(deny file-write*)",
    `(allow file-write* (literal ${quote(destination)}))`,
    "(deny network*)",
  ].join("");
  await run("/usr/bin/sandbox-exec", [
    "-p",
    profile,
    "/bin/cp",
    "--",
    sourcePath,
    destination,
  ]);
}

async function assertUnchanged(lease: WorkspaceReadLease) {
  const current = await stat(lease.sourcePath);
  if (
    current.size !== lease.size ||
    current.mtimeMs !== lease.mtimeMs ||
    current.ctimeMs !== lease.ctimeMs
  ) {
    throw codedError("IO_ERROR");
  }
}

function quote(value: string) {
  return JSON.stringify(value);
}

function codedError(code: string) {
  return Object.assign(new Error(code), { code });
}
