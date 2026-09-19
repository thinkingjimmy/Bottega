/**
 * [INPUT]: Depends on bounded byte sources and immutable SHA-256 descriptors.
 * [OUTPUT]: Copies and verifies one local recovery file before issuing any renderer lease.
 * [POS]: Shared native/imported/Home recovery byte guard with no network or filesystem authority.
 */
import { MAX_PART_BYTES, hashBytes, type BlobDescriptor, type BlobSource } from "@ai-chat/cloud-protocol";
import { memoryBlobSource } from "../../sync/chats/bodies";
export async function recoveryBytes(source: BlobSource, descriptor: BlobDescriptor, signal: AbortSignal) {
  const bytes = new Uint8Array(descriptor.bytes);
  for (let offset = 0; offset < bytes.length; offset += MAX_PART_BYTES) {
    signal.throwIfAborted(); const length = Math.min(MAX_PART_BYTES, bytes.length - offset), part = await source.read(offset, length);
    if (part.length !== length) throw new Error("RECOVERY_FILE_CHANGED"); bytes.set(part, offset);
  }
  signal.throwIfAborted(); if (hashBytes(bytes) !== descriptor.sha256) throw new Error("RECOVERY_FILE_CHANGED");
  return memoryBlobSource(bytes, descriptor.mime);
}
