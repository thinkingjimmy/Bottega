/**
 * [INPUT]: Depends on durable file publication and strict logical blob contracts
 * [OUTPUT]: Publishes and verifies owner-scoped versioned blob metadata after validated bytes
 * [POS]: Shared byte-integrity primitive; Chat and Base keep separate directories and authorization
 */
import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import { z } from "zod";
import { logicalBlobSchema, canonicalJson, type LogicalBlob } from "../../../shared/local-storage/contracts";
import { durableReplaceFile, isErrnoCode } from "./durable-json";
export const blobMetadataSchema = z.object({ version: z.literal(1), owner: z.string().min(1).max(384), blob: logicalBlobSchema }).strict();
export function describeBlob(blobId: string, bytes: Uint8Array, mime: string): LogicalBlob {
  return logicalBlobSchema.parse({ blobId, sha256: createHash("sha256").update(bytes).digest("hex"), bytes: bytes.byteLength, mime });
}
export async function readBlobMetadata(path: string, owner: string) {
  const info = await lstat(`${path}.blob.json`);
  if (!info.isFile() || info.isSymbolicLink() || info.size > 4096) throw new Error("BLOB_METADATA_INVALID");
  const metadata = blobMetadataSchema.parse(JSON.parse(await readFile(`${path}.blob.json`, "utf8")));
  if (metadata.owner !== owner) throw new Error("BLOB_OWNER_MISMATCH");
  return metadata.blob;
}
export async function publishBlobMetadata(path: string, owner: string, blob: LogicalBlob) {
  let existing: LogicalBlob | null;
  try { existing = await readBlobMetadata(path, owner); }
  catch (cause) { if (!isErrnoCode(cause, "ENOENT")) throw cause; existing = null; }
  if (existing && canonicalJson(existing) !== canonicalJson(blob)) throw new Error("BLOB_IDENTITY_CONFLICT");
  if (!existing) await durableReplaceFile(`${path}.blob.json`, canonicalJson(blobMetadataSchema.parse({ version: 1, owner, blob })));
}
export function verifyBlob(bytes: Uint8Array, blob: LogicalBlob) {
  const actual = describeBlob(blob.blobId, bytes, blob.mime);
  if (actual.sha256 !== blob.sha256 || actual.bytes !== blob.bytes) throw new Error("BLOB_CONTENT_CORRUPT");
}
