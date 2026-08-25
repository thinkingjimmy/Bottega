/**
 * [INPUT]: Depends on Node crypto/fs/path, shared attachment Budget and Gallery image header parser; Receive the owner file stem + lifecycle id and final bytes
 * [OUTPUT]: Provides content addresses AttachmentStore, family copy, data URL parsing, reserve→commit/release, budget, ownership, read and deleted-proven, clean
 * [POS]: The source of the truth of the blob of bases/store; Final bytes hashed by magic/header after a second test, the directory physical name with owner lifecycle
 */

import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  open,
  cp,
  readFile,
  readdir,
  rename,
  rm,
  stat,
} from "node:fs/promises";
import { join } from "node:path";
import {
  BASE_ATTACHMENT_BYTE_LIMIT,
  BASE_ATTACHMENT_CHAT_BUDGET,
  BASE_ATTACHMENT_GLOBAL_BUDGET,
  baseAttachmentValueSchema,
} from "../../../../shared/bases/gallery-attachments";
import type { BaseAttachmentValue } from "../../../../shared/bases-ipc";
import { parseAttachmentImageHeader } from "../../gallery/image-header";
import { fsyncParent } from "./commit-kernel";

type Reservation = {
  chatKey: string;
  bytes: number;
  committed: boolean;
};

export class AttachmentBudgetError extends Error {
  readonly status = 413;
  readonly code = "BUDGET_EXCEEDED";
}

export class BaseAttachmentStore {
  private committedGlobal = 0;
  private reservedGlobal = 0;
  private readonly committedChats = new Map<string, number>();
  private readonly reservedChats = new Map<string, number>();

  constructor(readonly root: string) {}

  async initialize() {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    this.committedGlobal = 0;
    this.committedChats.clear();
    for (const entry of await readdir(this.root, { withFileTypes: true })) {
      if (!entry.isDirectory() || !entry.name.endsWith(".attachments")) {
        continue;
      }
      let bytes = 0;
      for (const file of await readdir(join(this.root, entry.name), {
        withFileTypes: true,
      })) {
        if (!file.isFile()) continue;
        // writeImmutable 崩溃遗留的 tmp 不入预算，就地清理。
        if (file.name.endsWith(".tmp")) {
          await rm(join(this.root, entry.name, file.name), {
            force: true,
          }).catch(() => undefined);
          continue;
        }
        if (!/^att_[a-f0-9]{64}\./.test(file.name)) continue;
        bytes += (await stat(join(this.root, entry.name, file.name))).size;
      }
      this.committedChats.set(entry.name, bytes);
      this.committedGlobal += bytes;
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
  }): Promise<{ value: BaseAttachmentValue; created: boolean }> {
    const value = this.describe(input);
    const blobId = value.blobId;
    const directory = this.familyPath(input.chatId, input.incarnationId);
    const destination = join(directory, blobId);
    const exists = await stat(destination).then(
      () => true,
      (cause) => {
        if ((cause as NodeJS.ErrnoException).code === "ENOENT") return false;
        throw cause;
      }
    );
    const reservation = exists
      ? undefined
      : this.reserve(`${input.chatId}.${input.incarnationId}.attachments`, input.bytes.length);
    try {
      if (!exists) {
        await mkdir(directory, { recursive: true, mode: 0o700 });
        await writeImmutable(destination, input.bytes);
        this.commit(reservation!);
      }
    } catch (cause) {
      if (reservation) this.release(reservation);
      throw cause;
    }
    return { value, created: !exists };
  }

  describe(input: {
    filename: string;
    bytes: Buffer;
    sourceRevision: string;
  }): BaseAttachmentValue {
    if (
      input.bytes.length === 0 ||
      input.bytes.length > BASE_ATTACHMENT_BYTE_LIMIT
    ) {
      throw new AttachmentBudgetError("单附件不能超过 8 MiB");
    }
    const header = parseAttachmentImageHeader(
      input.bytes.subarray(0, 512 * 1024)
    );
    const mediaType = mediaTypeFor(header.extension);
    const hash = createHash("sha256").update(input.bytes).digest("hex");
    const blobId = `att_${hash}.${header.extension}`;
    const attachmentId = `attachment_${hash.slice(0, 24)}`;
    return baseAttachmentValueSchema.parse({
      kind: "attachment",
      attachmentId,
      blobId,
      filename: input.filename,
      mediaType,
      byteLength: input.bytes.length,
      width: header.width,
      height: header.height,
      revision: input.sourceRevision,
    });
  }

  async read(
    chatId: string,
    incarnationId: string,
    value: BaseAttachmentValue
  ) {
    baseAttachmentValueSchema.parse(value);
    const bytes = await readFile(
      join(this.familyPath(chatId, incarnationId), value.blobId)
    );
    const hash = createHash("sha256").update(bytes).digest("hex");
    if (!value.blobId.startsWith(`att_${hash}.`)) {
      throw new Error("Attachment blob 内容哈希不匹配");
    }
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
    await this.initialize();
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
      if (isCode(cause, "ENOENT")) return;
      throw cause;
    }
    await Promise.all(
      entries
        .filter(
          (entry) =>
            entry.isFile() &&
            /^att_[a-f0-9]{64}\./.test(entry.name) &&
            !referenced.has(entry.name)
        )
        .map((entry) => rm(join(directory, entry.name), { force: true }))
    );
    await this.initialize();
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
      if (!isCode(cause, "ENOENT")) throw cause;
    }
    await this.initialize();
  }

  async isolateFamily(
    ownerStem: string,
    ownerInstanceId: string,
    timestamp: number
  ) {
    const source = this.familyPath(ownerStem, ownerInstanceId);
    try {
      await rename(source, `${source}.orphan-${timestamp}`);
    } catch (cause) {
      if (!isCode(cause, "ENOENT")) throw cause;
    }
    await this.initialize();
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
    throw new AttachmentBudgetError("单附件不能超过 8 MiB");
  }
  return { mediaType: match[1]!, bytes };
}

async function writeImmutable(path: string, content: Buffer) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  const file = await open(temporary, "wx", 0o600);
  try {
    await file.writeFile(content);
    await file.sync();
  } finally {
    await file.close();
  }
  try {
    await rename(temporary, path);
    await fsyncParent(path);
  } catch (cause) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw cause;
  }
}

function mediaTypeFor(extension: string): BaseAttachmentValue["mediaType"] {
  if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
  if (extension === "webp") return "image/webp";
  if (extension === "gif") return "image/gif";
  return "image/png";
}

function isCode(cause: unknown, code: string) {
  return (
    cause instanceof Error &&
    "code" in cause &&
    (cause as NodeJS.ErrnoException).code === code
  );
}
