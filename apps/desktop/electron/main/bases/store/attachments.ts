/**
 * [INPUT]: Depends on Node crypto/fs/path, the commit-kernel durable write and errno guard, shared attachment budgets, and the Gallery image header parser; receives the owner file stem + lifecycle id and final bytes
 * [OUTPUT]: Provides verified owner-local attachment custody, source-only oversized originals, budgets and collection; missing local-only images never invoke a cloud reader.
 * [POS]: The source of the truth of the blob of bases/store; Final bytes hashed by magic/header after a second test, the directory physical name with owner lifecycle
 */

import { describeBlob, publishBlobMetadata, readBlobMetadata, verifyBlob } from "../../persistence/logical-blob";
import { createHash } from "node:crypto";
import {
  mkdir,
  cp,
  readFile,
  readdir,
  rm,
  stat,
} from "node:fs/promises";
import { basename, join } from "node:path";
import {
  BASE_ATTACHMENT_BYTE_LIMIT,
  BASE_ATTACHMENT_CHAT_BUDGET,
  BASE_ATTACHMENT_GLOBAL_BUDGET,
  baseAttachmentValueSchema,
} from "../../../../shared/bases/gallery-attachments";
import type { BaseAttachmentValue } from "../../../../shared/bases-ipc";
import { parseAttachmentImageHeader } from "../../gallery/image-header";
import { durableAtomicWrite, isErrnoCode } from "./commit-kernel";

type Reservation = {
  chatKey: string;
  bytes: number;
  committed: boolean;
};
export type MissingBaseAttachment = { ownerStem: string; ownerInstanceId: string; value: BaseAttachmentValue };

export class AttachmentBudgetError extends Error {
  readonly status = 413;
  readonly code = "BUDGET_EXCEEDED";
}

/** The caller must have verified the complete stream before describing it. */
export function describeVerifiedImage(input: { filename: string; sourceRevision: string; header: Buffer; byteLength: number; sha256: string;
  localAvailability?: BaseAttachmentValue["localAvailability"] }): BaseAttachmentValue {
  if (!Number.isSafeInteger(input.byteLength) || input.byteLength < 1 || input.byteLength > BASE_ATTACHMENT_BYTE_LIMIT && !input.localAvailability) {
    throw new AttachmentBudgetError("Attachments must be between 1 byte and 50 MB");
  }
  if (!/^[a-f0-9]{64}$/.test(input.sha256)) throw new Error("Invalid image digest");
  const header = parseAttachmentImageHeader(input.header.subarray(0, 512 * 1024));
  return baseAttachmentValueSchema.parse({ kind: "attachment", attachmentId: `attachment_${input.sha256.slice(0, 24)}`,
    blobId: `att_${input.sha256}.${header.extension}`, filename: input.filename, mediaType: mediaTypeFor(header.extension),
    byteLength: input.byteLength, width: header.width, height: header.height, revision: input.sourceRevision,
    ...(input.localAvailability ? { localAvailability: input.localAvailability } : {}) });
}

export class BaseAttachmentStore {
  private missingReader: ((input: MissingBaseAttachment) => Promise<void>) | null = null;
  private committedGlobal = 0;
  private reservedGlobal = 0;
  private readonly committedChats = new Map<string, number>();
  private readonly reservedChats = new Map<string, number>();

  constructor(private readonly location: string | (() => string)) {}
  get root() { return typeof this.location === "string" ? this.location : this.location(); }

  setMissingReader(reader: (input: MissingBaseAttachment) => Promise<void>) {
    if (this.missingReader) throw new Error("BASE_ATTACHMENT_READER_ALREADY_ATTACHED");
    this.missingReader = reader;
    return () => { if (this.missingReader === reader) this.missingReader = null; };
  }

  /**
   * 全量重扫只属于启动：它 stat 每个家族的每个 blob，代价与磁盘上的
   * 附件总量成正比。此后账目一律增量维护——删了多少减多少，拷来多少加多少。
   */
  async initialize() {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    this.committedGlobal = 0;
    this.committedChats.clear();
    for (const entry of await readdir(this.root, { withFileTypes: true })) {
      if (!entry.isDirectory() || !entry.name.endsWith(".attachments")) {
        continue;
      }
      this.account(entry.name, await this.measureFamily(join(this.root, entry.name), true));
    }
  }

  familyPath(ownerStem: string, ownerInstanceId: string) {
    return join(this.root, `${ownerStem}.${ownerInstanceId}.attachments`);
  }

  async put(input: {
    chatId: string;
    incarnationId: string;
    filename: string;
    bytes: Buffer;
    sourceRevision: string;
    localAvailability?: BaseAttachmentValue["localAvailability"];
  }): Promise<{ value: BaseAttachmentValue; created: boolean }> {
    const value = this.describe(input);
    const blobId = value.blobId;
    const directory = this.familyPath(input.chatId, input.incarnationId);
    const destination = join(directory, blobId);
    const exists = await stat(destination).then(
      () => true,
      (cause) => {
        if (isErrnoCode(cause, "ENOENT")) return false;
        throw cause;
      }
    );
    const reservation = exists
      ? undefined
      : this.reserve(`${input.chatId}.${input.incarnationId}.attachments`, input.bytes.length);
    try {
      if (!exists) {
        await mkdir(directory, { recursive: true, mode: 0o700 });
        await durableAtomicWrite(destination, input.bytes);
        this.commit(reservation!);
      }
    } catch (cause) {
      if (reservation) this.release(reservation);
      throw cause;
    }
    if (exists) verifyBlob(await readFile(destination), describeBlob(blobId, input.bytes, value.mediaType));
    await publishBlobMetadata(destination, `${input.chatId}:${input.incarnationId}`, describeBlob(blobId, input.bytes, value.mediaType));
    return { value, created: !exists };
  }

  describe(input: {
    filename: string;
    bytes: Buffer;
    sourceRevision: string;
    localAvailability?: BaseAttachmentValue["localAvailability"];
  }): BaseAttachmentValue {
    return describeVerifiedImage({ filename: input.filename, sourceRevision: input.sourceRevision,
      header: input.bytes.subarray(0, 512 * 1024), byteLength: input.bytes.length,
      sha256: createHash("sha256").update(input.bytes).digest("hex"), localAvailability: input.localAvailability });
  }

  async read(
    chatId: string,
    incarnationId: string,
    value: BaseAttachmentValue
  ) {
    baseAttachmentValueSchema.parse(value);
    const path = join(this.familyPath(chatId, incarnationId), value.blobId);
    const bytes = await readFile(path).catch(async error => {
      if (isErrnoCode(error, "ENOENT") && value.localAvailability) throw Object.assign(new Error("Image is only available on its source computer"), { code: "SOURCE_LOCAL_ONLY" });
      if (!isErrnoCode(error, "ENOENT") || !this.missingReader) throw error;
      await this.missingReader({ ownerStem: chatId, ownerInstanceId: incarnationId, value });
      return readFile(path);
    });
    const hash = createHash("sha256").update(bytes).digest("hex");
    if (!value.blobId.startsWith(`att_${hash}.`)) {
      throw new Error("Attachment blob 内容哈希不匹配");
    }
    const blob = await readBlobMetadata(join(this.familyPath(chatId, incarnationId), value.blobId), `${chatId}:${incarnationId}`);
    verifyBlob(bytes, blob);
    if (blob.blobId !== value.blobId || blob.bytes !== value.byteLength || blob.mime !== value.mediaType) throw new Error("BLOB_REFERENCE_MISMATCH");
    return bytes;
  }

  async releaseFamily(
    ownerStem: string,
    ownerInstanceId: string,
    proof: "deleted-proven" | "unknown"
  ) {
    if (proof !== "deleted-proven") return;
    await rm(this.familyPath(ownerStem, ownerInstanceId), {
      recursive: true,
      force: true,
    });
    this.forget(this.familyKey(ownerStem, ownerInstanceId));
  }

  async gcFamily(
    ownerStem: string,
    ownerInstanceId: string,
    referenced: ReadonlySet<string>
  ) {
    const directory = this.familyPath(ownerStem, ownerInstanceId);
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (cause) {
      if (isErrnoCode(cause, "ENOENT")) return;
      throw cause;
    }
    const doomed: string[] = [];
    const temporary: string[] = [];
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      // durableAtomicWrite 崩溃遗留的 tmp 从未入账：删它不动账目。
      if (entry.name.endsWith(".tmp")) temporary.push(entry.name);
      else if (
        /^att_[a-f0-9]{64}\.(png|jpe?g|webp|gif)$/.test(entry.name) &&
        !referenced.has(entry.name)
      ) {
        doomed.push(entry.name);
      }
    }
    await Promise.all(
      temporary.map((name) =>
        rm(join(directory, name), { force: true }).catch(() => undefined)
      )
    );
    if (!doomed.length) return;
    const freed = await Promise.all(
      doomed.map(async (name) => {
        const path = join(directory, name);
        const bytes = await stat(path).then(
          (info) => info.size,
          () => 0
        );
        await rm(path, { force: true });
        await rm(`${path}.blob.json`, { force: true });
        return bytes;
      })
    );
    this.account(
      this.familyKey(ownerStem, ownerInstanceId),
      -freed.reduce((total, bytes) => total + bytes, 0)
    );
  }

  async copyFamily(
    fromStem: string,
    fromInstanceId: string,
    toStem: string,
    toInstanceId: string
  ) {
    const source = this.familyPath(fromStem, fromInstanceId);
    const destination = this.familyPath(toStem, toInstanceId);
    try {
      await cp(source, destination, {
        recursive: true,
        force: false,
        errorOnExist: false,
      });
    } catch (cause) {
      if (!isErrnoCode(cause, "ENOENT")) throw cause;
    }
    for (const entry of await readdir(destination).catch(() => [])) {
      if (!entry.endsWith(".blob.json")) continue;
      const blobId = entry.slice(0, -10);
      const blob = await readBlobMetadata(join(source, blobId), `${fromStem}:${fromInstanceId}`);
      await durableAtomicWrite(join(destination, entry), JSON.stringify({ version: 1, owner: `${toStem}:${toInstanceId}`, blob }));
    }
    const key = this.familyKey(toStem, toInstanceId);
    this.forget(key);
    this.account(key, await this.measureFamily(destination, false));
  }

  private familyKey(ownerStem: string, ownerInstanceId: string) {
    return basename(this.familyPath(ownerStem, ownerInstanceId));
  }

  /** 只丈量一个家族目录；sweepTemporary 仅在启动重扫时开启。 */
  private async measureFamily(directory: string, sweepTemporary: boolean) {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (cause) {
      if (isErrnoCode(cause, "ENOENT")) return 0;
      throw cause;
    }
    let bytes = 0;
    for (const file of entries) {
      if (!file.isFile()) continue;
      // durableAtomicWrite 崩溃遗留的 tmp 不入预算，就地清理。
      if (file.name.endsWith(".tmp")) {
        if (sweepTemporary) {
          await rm(join(directory, file.name), { force: true }).catch(
            () => undefined
          );
        }
        continue;
      }
      if (!/^att_[a-f0-9]{64}\.(png|jpe?g|webp|gif)$/.test(file.name)) continue;
      bytes += (await stat(join(directory, file.name))).size;
    }
    return bytes;
  }

  private account(chatKey: string, delta: number) {
    if (!delta) {
      this.committedChats.set(chatKey, this.committedChats.get(chatKey) ?? 0);
      return;
    }
    const next = Math.max(0, (this.committedChats.get(chatKey) ?? 0) + delta);
    this.committedChats.set(chatKey, next);
    this.committedGlobal = Math.max(0, this.committedGlobal + delta);
  }

  private forget(chatKey: string) {
    this.committedGlobal = Math.max(
      0,
      this.committedGlobal - (this.committedChats.get(chatKey) ?? 0)
    );
    this.committedChats.delete(chatKey);
  }

  private reserve(chatKey: string, bytes: number): Reservation {
    const chat =
      (this.committedChats.get(chatKey) ?? 0) +
      (this.reservedChats.get(chatKey) ?? 0);
    if (
      this.committedGlobal + this.reservedGlobal + bytes >
        BASE_ATTACHMENT_GLOBAL_BUDGET ||
      chat + bytes > BASE_ATTACHMENT_CHAT_BUDGET
    ) {
      throw new AttachmentBudgetError("Attachment 磁盘预算不足");
    }
    this.reservedGlobal += bytes;
    this.reservedChats.set(
      chatKey,
      (this.reservedChats.get(chatKey) ?? 0) + bytes
    );
    return { chatKey, bytes, committed: false };
  }

  private commit(reservation: Reservation) {
    if (reservation.committed) return;
    reservation.committed = true;
    this.releaseReserved(reservation);
    this.committedGlobal += reservation.bytes;
    this.committedChats.set(
      reservation.chatKey,
      (this.committedChats.get(reservation.chatKey) ?? 0) + reservation.bytes
    );
  }

  private release(reservation: Reservation) {
    if (!reservation.committed) this.releaseReserved(reservation);
  }

  private releaseReserved(reservation: Reservation) {
    this.reservedGlobal -= reservation.bytes;
    const next =
      (this.reservedChats.get(reservation.chatKey) ?? reservation.bytes) -
      reservation.bytes;
    if (next > 0) this.reservedChats.set(reservation.chatKey, next);
    else this.reservedChats.delete(reservation.chatKey);
  }
}

export function parseAttachmentDataUrl(value: string) {
  const match =
    /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/=\r\n]+)$/.exec(
      value
    );
  if (!match) throw new Error("附件 dataURL 格式无效");
  const bytes = Buffer.from(match[2]!, "base64");
  if (bytes.length === 0 || bytes.length > BASE_ATTACHMENT_BYTE_LIMIT) {
    throw new AttachmentBudgetError("Attachments must be between 1 byte and 50 MB");
  }
  return { mediaType: match[1]!, bytes };
}

function mediaTypeFor(extension: string): BaseAttachmentValue["mediaType"] {
  if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
  if (extension === "webp") return "image/webp";
  if (extension === "gif") return "image/gif";
  return "image/png";
}
