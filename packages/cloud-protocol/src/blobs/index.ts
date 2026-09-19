/**
 * [INPUT]: Depends on Zod, public identities and application file limits.
 * [OUTPUT]: Provides account-scoped content-stable logical blob identities, exact descriptors and bounded part sizes.
 * [POS]: Provider-independent private-file boundary; physical locators are never exposed.
 */
import { z } from "zod";
import { cloudIdSchema } from "../auth";
import { MAX_BLOB_BYTES, MAX_PART_BYTES, MAX_PARTS } from "../config";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
export const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
export const logicalBlobIdSchema = z.string().regex(/^[A-Za-z0-9_.-]{1,192}$/);
export const blobDescriptorSchema = z.object({
  blobId: logicalBlobIdSchema, sha256: sha256Schema, bytes: z.number().int().min(0).max(MAX_BLOB_BYTES), mime: z.string().min(1).max(128),
}).strict();
export type BlobDescriptor = z.infer<typeof blobDescriptorSchema>;
export function contentBlobId(descriptor: Pick<BlobDescriptor, "sha256" | "mime">, userId: string) {
  sha256Schema.parse(descriptor.sha256);
  const extension = ({ "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif" } as Record<string, string>)[descriptor.mime];
  return extension ? `att_${descriptor.sha256}.${extension}` :
    `blob_${descriptor.sha256}_${bytesToHex(sha256(new TextEncoder().encode(JSON.stringify([userId, descriptor.mime])))).slice(0, 16)}`;
}
export const blobOwnerSchema = z.object({ kind: z.enum(["chat", "base", "app", "skill"]), id: cloudIdSchema }).strict();
export function partSizes(bytes: number): number[] {
  z.number().int().min(0).max(MAX_BLOB_BYTES).parse(bytes);
  const sizes = Array.from({ length: Math.ceil(bytes / MAX_PART_BYTES) }, (_, i) => Math.min(MAX_PART_BYTES, bytes - i * MAX_PART_BYTES));
  if (sizes.length > MAX_PARTS) throw new Error("blob-too-large");
  return sizes;
}
