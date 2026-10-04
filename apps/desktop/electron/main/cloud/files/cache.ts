/**
 * [INPUT]: Depends on account-scoped paths, authenticated owner receipts and closed encrypted file descriptors.
 * [OUTPUT]: Persists bounded owner receipts with the verified file fingerprint and re-hashes cached bytes only when that fingerprint moved.
 * [POS]: Private file cache verification; receipts are created only by a completed authorized download.
 */
import { createHash, randomUUID } from "node:crypto";
import { constants, type BigIntStats } from "node:fs";
import { open, rename, unlink } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { canonicalJson, type BeginBlobUpload, type BlobDescriptor } from "@ai-chat/cloud-protocol";
import { encryptedFileDescriptorSchema } from "@ai-chat/cloud-protocol/blobs/encrypted";
const receiptPath = (root: string, blobId: string, owner: BeginBlobUpload["owner"]) => join(root, "receipt-" + createHash("sha256").update(canonicalJson({ blobId, owner })).digest("hex") + ".json");
// Identity plus both timestamps: the cached blob is written once by this process and never edited in place.
const fingerprint = (stat: BigIntStats) => [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].join(":");
const receiptSchema = z.object({ descriptor: z.unknown(), fingerprint: z.string().max(192).nullable() }).strict();
const RECEIPT_OVERHEAD = 256;
export async function retainCacheReceipt(root: string, path: string, descriptor: BlobDescriptor, owner: BeginBlobUpload["owner"]) {
  const snapshot = encryptedFileDescriptorSchema.parse(descriptor);
  if (snapshot.encryption.owner.kind !== owner.kind || snapshot.encryption.owner.id !== owner.id) throw new Error("file-owner-mismatch");
  let evidence: string | null = null;
  try {
    const blob = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try { const stat = await blob.stat({ bigint: true }); if (stat.isFile() && Number(stat.size) === snapshot.bytes) evidence = fingerprint(stat); }
    finally { await blob.close(); }
  } catch { evidence = null; }
  const bytes = canonicalJson({ descriptor: snapshot, fingerprint: evidence });
  const target = receiptPath(root, snapshot.blobId, owner), temporary = join(root, ".receipt-" + randomUUID());
  const handle = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { await handle.writeFile(bytes); await handle.sync(); }
  catch (error) { await unlink(temporary).catch(() => {}); throw error; }
  finally { await handle.close(); }
  await rename(temporary, target);
}
export async function readVerifiedCache(root: string, path: string, descriptor: BlobDescriptor, owner: BeginBlobUpload["owner"], signal?: AbortSignal) {
  signal?.throwIfAborted();
  const snapshot = encryptedFileDescriptorSchema.parse(descriptor);
  if (snapshot.encryption.owner.kind !== owner.kind || snapshot.encryption.owner.id !== owner.id) return null;
  const expected = canonicalJson(snapshot), budget = Buffer.byteLength(expected) + RECEIPT_OVERHEAD;
  try {
    let receipt: z.infer<typeof receiptSchema>;
    const handle = await open(receiptPath(root, snapshot.blobId, owner), constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size > budget) return null;
      // The validated descriptor bounds allocation even if the receipt grows after stat.
      const actual = Buffer.alloc(budget + 1); let offset = 0;
      while (offset < actual.byteLength) {
        signal?.throwIfAborted();
        const { bytesRead } = await handle.read(actual, offset, actual.byteLength - offset, offset);
        if (!bytesRead) break; offset += bytesRead;
      }
      if (offset > budget) return null;
      let parsed: unknown;
      try { parsed = JSON.parse(actual.subarray(0, offset).toString("utf8")); } catch { return null; }
      const value = receiptSchema.safeParse(parsed);
      if (!value.success || canonicalJson(value.data.descriptor) !== expected) return null;
      receipt = value.data;
    } finally { await handle.close(); }
    const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const before = await file.stat({ bigint: true });
      if (!before.isFile() || Number(before.size) !== snapshot.bytes) return null;
      // A blob that still carries the fingerprint recorded at download time has not been touched since it was verified.
      if (receipt.fingerprint && receipt.fingerprint === fingerprint(before)) return { path, descriptor: snapshot };
      const hash = createHash("sha256"), buffer = Buffer.alloc(Math.min(1024 * 1024, snapshot.bytes));
      for (let offset = 0; offset < snapshot.bytes;) {
        signal?.throwIfAborted(); const { bytesRead } = await file.read(buffer, 0, Math.min(buffer.length, snapshot.bytes - offset), offset);
        if (!bytesRead) return null; hash.update(buffer.subarray(0, bytesRead)); offset += bytesRead;
      }
      const after = await file.stat({ bigint: true }); signal?.throwIfAborted();
      return before.mtimeNs === after.mtimeNs && before.ctimeNs === after.ctimeNs && hash.digest("hex") === snapshot.sha256 ? { path, descriptor: snapshot } : null;
    } finally { await file.close(); }
  } catch (error) { signal?.throwIfAborted(); if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
}
