/**
 * [INPUT]: Depends on a locked folder, attachment payloads, logical blob hashes and durable publication.
 * [OUTPUT]: Persists validated images and trusted remote files with stable identity, hash checks and original cloud descriptors.
 * [POS]: AttachmentStore's only backing store; cloud and interactive writers share one queue per Chat directory.
 */
import { lstat, readFile, readdir, realpath, rm } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { nanoid } from "nanoid";
import type { ChatAttachmentMeta, ChatAttachmentPayload } from "../../../../shared/chats-ipc";
import { ATTACHMENT_BYTE_LIMIT, IMAGE_DATA_URL_PATTERN } from "../../../../shared/agent-ipc";
import { describeBlob, verifyBlob } from "../../persistence/logical-blob";
import { durableReplaceBytes, durableReplaceFile, isErrnoCode } from "../../persistence/durable-json";
import { SerialQueue } from "../../persistence/serial-queue";
import { libraryChatPath, libraryDirectory, libraryObjectId } from "../paths";
import { remotePayload } from "../../chats/lifecycle/remote-input";
import { encryptedFileDescriptorSchema } from "@ai-chat/cloud-protocol/blobs/encrypted";
const entrySchema = z.object({ sha256: z.string().regex(/^[a-f0-9]{64}$/), mime: z.string().min(1).max(100),
  filename: z.string().min(1), bytes: z.number().int().nonnegative().max(ATTACHMENT_BYTE_LIMIT), remoteBlob: encryptedFileDescriptorSchema.optional() });
const mapSchema = z.object({ version: z.literal(1), attachments: z.record(z.string().regex(/^[A-Za-z0-9_-]{10,64}$/), entrySchema) });
/* One writer per Chat directory, evicted the moment it drains: a long-lived profile
   otherwise retains a queue for every Chat it ever touched. */
const queues = new Map<string, { queue: SerialQueue; pending: number }>();
function serialize<T>(directory: string, job: () => Promise<T>) {
  const owner = queues.get(directory) ?? { queue: new SerialQueue(), pending: 0 };
  queues.set(directory, owner);
  owner.pending++;
  return owner.queue.enqueue(job).finally(() => {
    if (--owner.pending === 0 && queues.get(directory) === owner) queues.delete(directory);
  });
}
type MapFile = z.infer<typeof mapSchema>;
export class LibraryAttachments {
  constructor(private root: () => string | null) {}
  private requireRoot() { const root = this.root(); if (!root) throw new Error("LIBRARY_NOT_CONFIGURED"); return root; }
  /** Reads probe the folder as it is; only publication may bring a Chat directory into existence. */
  private chatPath(chatId: string) { return libraryChatPath(this.requireRoot(), chatId); }
  private async map(directory: string): Promise<MapFile> {
    const path = join(directory, "attachments.json");
    try {
      const info = await lstat(path);
      if (!info.isFile() || info.isSymbolicLink() || info.size > 4 * 1024 * 1024) throw new Error("ATTACHMENT_MAP_INVALID");
      return mapSchema.parse(JSON.parse(await readFile(path, "utf8")));
    } catch (error) { if (isErrnoCode(error, "ENOENT")) return { version: 1, attachments: {} }; throw error; }
  }
  private writeMap(directory: string, map: MapFile) {
    return durableReplaceFile(join(directory, "attachments.json"), JSON.stringify(mapSchema.parse(map), null, 2) + "\n");
  }
  async persist(payloads: ChatAttachmentPayload[], ids: string[] | undefined, chatId: string) {
    if (!payloads.length) return [];
    const directory = await libraryDirectory(this.requireRoot(), "chats", libraryObjectId(chatId));
    return serialize(directory, async () => {
      const map = await this.map(directory), result: ChatAttachmentMeta[] = [];
      await libraryDirectory(this.requireRoot(), "chats", chatId, "attachments");
      for (const [index, payload] of payloads.entries()) {
        const id = libraryObjectId(ids?.[index] ?? nanoid());
        const remote = remotePayload(payload);
        if (!remote && !IMAGE_DATA_URL_PATTERN.test(payload.dataUrl)) throw new Error("ATTACHMENT_CONTENT_INVALID");
        if (remote && (remote.remote.attachmentId !== id || remote.remote.blob.encryption.owner.kind !== "chat" || remote.remote.blob.encryption.owner.id !== chatId)) throw new Error("ATTACHMENT_IDENTITY_CHANGED");
        const mime = payload.dataUrl.slice(5, payload.dataUrl.indexOf(";")), bytes = Buffer.from(payload.dataUrl.slice(payload.dataUrl.indexOf(",") + 1), "base64");
        if (!bytes.length || bytes.length > ATTACHMENT_BYTE_LIMIT || mime !== payload.mediaType.toLowerCase()) throw new Error("ATTACHMENT_CONTENT_INVALID");
        const blob = describeBlob(id, bytes, mime), path = join(directory, "attachments", id);
        if (map.attachments[id] && map.attachments[id]!.sha256 !== blob.sha256) throw new Error("ATTACHMENT_IDENTITY_CHANGED");
        try {
          const info = await lstat(path);
          if (!info.isFile() || info.isSymbolicLink() || info.size !== bytes.length) throw new Error("ATTACHMENT_IDENTITY_CHANGED");
          verifyBlob(await readFile(path), blob);
        } catch (error) { if (!isErrnoCode(error, "ENOENT")) throw error; await durableReplaceBytes(path, bytes); }
        map.attachments[id] = { sha256: blob.sha256, mime, filename: payload.filename, bytes: bytes.length,
          ...(remote ? { remoteBlob: remote.remote.blob } : map.attachments[id]?.remoteBlob ? { remoteBlob: map.attachments[id]!.remoteBlob } : {}) };
        result.push({ id, filename: payload.filename, mediaType: mime, byteSize: bytes.length });
      }
      await this.writeMap(directory, map);
      return result;
    });
  }
  async read(id: string, chatId: string) {
    const directory = this.chatPath(chatId), entry = (await this.map(directory)).attachments[libraryObjectId(id)];
    if (!entry) throw new Error("ATTACHMENT_MISSING");
    const parent = join(directory, "attachments"), path = join(parent, id);
    if (await realpath(parent).catch(() => null) !== parent) throw new Error("ATTACHMENT_MISSING");
    const info = await lstat(path).catch(() => null);
    if (!info?.isFile() || info.isSymbolicLink() || info.size !== entry.bytes) throw new Error("ATTACHMENT_MISSING");
    const bytes = await readFile(path), blob = describeBlob(id, bytes, entry.mime);
    if (blob.sha256 !== entry.sha256) throw new Error("ATTACHMENT_INTEGRITY_FAILED");
    return { blob, remoteBlob: entry.remoteBlob, dataUrl: `data:${entry.mime};base64,${bytes.toString("base64")}` };
  }
  /** One map rewrite per Chat, then the bytes: a dangling map entry is recoverable, a dangling reference is not. */
  async remove(ids: readonly string[], chatId: string) {
    if (!ids.length) return { failed: [] as string[] };
    const directory = this.chatPath(chatId);
    return serialize(directory, async () => {
      const map = await this.map(directory), removable = ids.filter(id => map.attachments[libraryObjectId(id)]);
      for (const id of removable) delete map.attachments[id];
      if (removable.length) await this.writeMap(directory, map);
      const failed: string[] = [];
      for (const id of ids) await rm(join(directory, "attachments", id), { force: true }).catch(() => failed.push(id));
      return { failed };
    }).catch(() => ({ failed: [...ids] }));
  }
  async sweep(referenced: ReadonlySet<string>) {
    const root = this.root();
    if (!root) return {};
    const chats = join(root, "chats");
    const entries = await readdir(chats, { withFileTypes: true }).catch(error => { if (isErrnoCode(error, "ENOENT")) return []; throw error; });
    let pending = false;
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink() || !/^[A-Za-z0-9_-]{1,128}$/.test(entry.name)) continue;
      const map = await this.map(join(chats, entry.name));
      const unused = Object.keys(map.attachments).filter(id => !referenced.has(id));
      if (unused.length && (await this.remove(unused, entry.name)).failed.length) pending = true;
    }
    return pending ? { warning: "Attachment collection is pending" } : {};
  }
}
