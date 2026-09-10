/**
 * [INPUT]: Depends on Node fs/path, nanoid and shared chats/agent
 * [OUTPUT]: Stable attachment IDs, byte-first atomic data-URL publication, owner-local logical blob metadata, integrity-checked reads and reference-driven cleanup that preserves unknown outcomes.
 * [POS]: Attachment byte store of the chats module; bytes live outside the Chat database and only ChatsService consumes them
 */

import { mkdir, readFile, readdir, rm, lstat } from "node:fs/promises";
import { join } from "node:path";
import { nanoid } from "nanoid";
import { errorMessage } from "../errors";
import { IMAGE_DATA_URL_PATTERN, ATTACHMENT_BYTE_LIMIT } from "../../../shared/agent-ipc";
import type { ChatAttachmentMeta, ChatAttachmentPayload } from "../../../shared/chats-ipc";
import { durableReplaceFile, isErrnoCode } from "../persistence/durable-json";
import { describeBlob, publishBlobMetadata, readBlobMetadata, verifyBlob } from "../persistence/logical-blob";
import { SerialQueue } from "../persistence/serial-queue";
const identity = (id: string) => {
  if (!/^[A-Za-z0-9_-]{10,64}$/.test(id)) throw new Error("Invalid attachment identity");
  return id;
};
function decode(value: string) {
  if (!IMAGE_DATA_URL_PATTERN.test(value)) throw new Error("附件内容已损坏");
  const comma = value.indexOf(",");
  const bytes = Buffer.from(value.slice(comma + 1), "base64");
  if (!bytes.length || bytes.length > ATTACHMENT_BYTE_LIMIT) throw new Error("附件大小无效");
  return { bytes, mime: value.slice(5, value.indexOf(";")) };
}
export class AttachmentStore {
  private readonly queue = new SerialQueue();
  constructor(readonly root: string) {}
  persist(payloads: ChatAttachmentPayload[], stableIds?: string[]): Promise<ChatAttachmentMeta[]> {
    return this.queue.enqueue(async () => {
      try {
      const metas: ChatAttachmentMeta[] = [];
      for (const [index, payload] of payloads.entries()) {
        const id = identity(stableIds?.[index] ?? nanoid());
        const path = join(this.root, id);
        const decoded = decode(payload.dataUrl);
        if (decoded.mime !== payload.mediaType.toLowerCase()) throw new Error("附件类型不匹配");
        const blob = describeBlob(id, decoded.bytes, decoded.mime);
        let existing: string | null;
        try { existing = await this.readBytes(id); }
        catch (cause) { if (!isErrnoCode(cause, "ENOENT")) throw cause; existing = null; }
        if (existing !== null) verifyBlob(decode(existing).bytes, blob);
        else await durableReplaceFile(path, payload.dataUrl);
        // A lost publication reply retains bytes; only an owner verdict may reclaim them.
        await publishBlobMetadata(path, `chat:${id}`, blob);
        metas.push({ id, filename: payload.filename, mediaType: payload.mediaType, byteSize: blob.bytes });
      }
      return metas;
      } catch (cause) { throw new Error(`附件保存失败：${errorMessage(cause)}`, { cause }); }
    });
  }
  remove(metas: ChatAttachmentMeta[]) {
    return this.queue.enqueue(async () => {
      const failed: string[] = [];
      for (const meta of metas) {
        const id = identity(meta.id);
        try { await rm(join(this.root, id), { force: true }); await rm(join(this.root, `${id}.blob.json`), { force: true }); }
        catch { failed.push(id); }
      }
      return { failed };
    });
  }
  sweep(referencedIds: ReadonlySet<string>) {
    return this.queue.enqueue(async () => {
      try {
        await mkdir(this.root, { recursive: true });
        const entries = await readdir(this.root, { withFileTypes: true });
        let failed = 0;
        for (const entry of entries) {
          const id = entry.name.replace(/\.blob\.json$/, "");
          if (!entry.isFile() || referencedIds.has(id)) continue;
          // Unknown files are evidence, not proof of an abandoned owned blob.
          if (!/^[A-Za-z0-9_-]{10,64}$/.test(id) && !entry.name.endsWith(".tmp")) continue;
          try { await rm(join(this.root, entry.name), { force: true }); } catch { failed++; }
        }
        return failed ? { warning: `${failed} 个未引用附件清理失败` } : {};
      } catch (cause) { return { warning: `附件清理失败：${errorMessage(cause)}` }; }
    });
  }
  private async readBytes(id: string) {
    const path = join(this.root, identity(id));
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 12 * 1024 * 1024) throw new Error("附件内容已损坏");
    return readFile(path, "utf8");
  }
  async logical(attachmentId: string) {
    let content: string;
    try { content = await this.readBytes(attachmentId); }
    catch (cause) { if (isErrnoCode(cause, "ENOENT")) throw new Error("附件不存在", { cause }); throw cause; }
    const decoded = decode(content);
    let blob;
    try { blob = await readBlobMetadata(join(this.root, identity(attachmentId)), `chat:${attachmentId}`); }
    catch (cause) { throw new Error("附件元数据缺失或损坏", { cause }); }
    verifyBlob(decoded.bytes, blob);
    if (decoded.mime !== blob.mime || blob.blobId !== attachmentId) throw new Error("附件类型或身份不匹配");
    return blob;
  }
  async read(attachmentId: string): Promise<string> {
    await this.logical(attachmentId);
    return this.readBytes(attachmentId);
  }
}
