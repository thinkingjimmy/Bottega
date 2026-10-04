/**
 * [INPUT]: Depends on file handles, the shared cheap persistence directory guard, private account-scoped paths, admitted crypto transfer ports and verified encrypted offline receipts.
 * [OUTPUT]: Provides scoped verified files and drains both cached reads and downloads before account cleanup.
 * [POS]: Main-only BlobStore; failed downloads keep previous bytes and remove only their own temporary file.
 */
import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { open, rename, unlink } from "node:fs/promises";
import { join } from "node:path";
import { MAX_BLOB_BYTES, MAX_PART_BYTES, type BeginBlobUpload, type BlobSource, type BlobTransferPorts, type FileProgress } from "@ai-chat/cloud-protocol";
import { EncryptedBlobTransfer } from "@ai-chat/cloud-protocol/blobs/encrypted/transport";
import { encryptedFileDescriptorSchema, type EncryptedFileDescriptor } from "@ai-chat/cloud-protocol/blobs/encrypted";
import { readVerifiedCache, retainCacheReceipt } from "./cache";
import { ensureGuardedDirectory } from "../../persistence/durable-json";
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const scopeDigest = (scope: { environmentId: string; deploymentId: string; userId: string }) => digest(JSON.stringify([scope.environmentId, scope.deploymentId, scope.userId]));
export const blobCacheDirectory = (userData: string, scope: { environmentId: string; deploymentId: string; userId: string }) => join(userData, "cloud-files", scopeDigest(scope));
const directory = (path: string) => ensureGuardedDirectory(path, "unsafe-file-cache");
export async function localBlobSource(path: string, mime: string): Promise<{ source: BlobSource; close(): Promise<void> }> {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const initial = await handle.stat();
    if (!initial.isFile() || initial.size > MAX_BLOB_BYTES) throw new Error("file-too-large-or-unavailable");
    const source: BlobSource = { bytes: initial.size, mime, read: async (offset, size) => {
      if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(size) || offset < 0 || size < 0 || size > MAX_PART_BYTES || offset + size > initial.size) throw new Error("invalid-file-range");
      const current = await handle.stat();
      if (current.size !== initial.size || current.mtimeMs !== initial.mtimeMs || current.ctimeMs !== initial.ctimeMs) throw new Error("file-source-changed");
      const bytes = new Uint8Array(size); let read = 0;
      while (read < size) { const result = await handle.read(bytes, read, size - read, offset + read); if (!result.bytesRead) throw new Error("file-source-changed"); read += result.bytesRead; }
      return bytes;
    } };
    return { source, close: () => handle.close() };
  } catch (error) { await handle.close(); throw error; }
}
export class DesktopBlobStore {
  readonly transfer: EncryptedBlobTransfer;
  private readonly namespace: string;
  private closed = false;
  private active = new Set<Promise<unknown>>();
  constructor(private readonly userData: string, scope: { environmentId: string; deploymentId: string; userId: string }, private readonly ports: BlobTransferPorts) {
    this.namespace = scopeDigest(scope); this.transfer = new EncryptedBlobTransfer(ports);
  }
  download(descriptor: EncryptedFileDescriptor, owner: BeginBlobUpload["owner"], progress?: (value: FileProgress) => void, signal?: AbortSignal) {
    if (this.closed) return Promise.reject(new Error("file-transfer-closed"));
    const flight = this.downloadFile(descriptor, owner, progress, signal); this.active.add(flight);
    void flight.finally(() => this.active.delete(flight)).catch(() => undefined); return flight;
  }
  read(descriptor: EncryptedFileDescriptor, owner: BeginBlobUpload["owner"], signal?: AbortSignal) {
    if (this.closed) return Promise.reject(new Error("file-transfer-closed"));
    const flight = this.readFile(descriptor, owner, signal); this.active.add(flight);
    void flight.finally(() => this.active.delete(flight)).catch(() => undefined); return flight;
  }
  private async readFile(descriptor: EncryptedFileDescriptor, owner: BeginBlobUpload["owner"], signal?: AbortSignal) {
    descriptor = encryptedFileDescriptorSchema.parse(descriptor);
    owner = { ...owner };
    await directory(join(this.userData, "cloud-files"));
    const root = join(this.userData, "cloud-files", this.namespace);
    await directory(root);
    const cached = await readVerifiedCache(root, join(root, digest(descriptor.blobId) + ".bin"), descriptor, owner, signal);
    if (this.closed) throw new Error("file-transfer-closed");
    return cached ?? this.download(descriptor, owner, undefined, signal);
  }
  private async downloadFile(descriptor: EncryptedFileDescriptor, owner: BeginBlobUpload["owner"], progress?: (value: FileProgress) => void, signal?: AbortSignal) {
    descriptor = encryptedFileDescriptorSchema.parse(descriptor);
    owner = { ...owner };
    if (descriptor.encryption.owner.kind !== owner.kind || descriptor.encryption.owner.id !== owner.id) throw new Error("file-owner-mismatch");
    const crypto = this.ports.crypto();
    const parent = join(this.userData, "cloud-files"); await directory(parent);
    const root = join(parent, this.namespace); await directory(root);
    const target = join(root, digest(descriptor.blobId) + ".bin"), temporary = join(root, ".part-" + randomUUID());
    const handle = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    let closed = false;
    const close = async () => { if (!closed) { closed = true; await handle.close(); } };
    return this.transfer.readFile(descriptor, crypto, {
      write: async bytes => { let offset = 0; while (offset < bytes.byteLength) { const { bytesWritten } = await handle.write(bytes, offset, bytes.byteLength - offset); if (!bytesWritten) throw new Error("file-cache-write-failed"); offset += bytesWritten; } },
      commit: async descriptor => {
        await handle.sync(); await close(); await directory(root);
        if (this.closed) throw new Error("file-transfer-closed");
        signal?.throwIfAborted(); await rename(temporary, target);
        await retainCacheReceipt(root, target, descriptor, owner);
        const parentHandle = await open(root, constants.O_RDONLY);
        try { await parentHandle.sync(); } finally { await parentHandle.close(); }
        return { path: target, descriptor };
      },
      abort: async () => { await close(); await unlink(temporary).catch(error => { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }); },
    }, progress, signal);
  }
  async close() { this.closed = true; await this.transfer.close(); await Promise.allSettled([...this.active]); }
}
