/**
 * [INPUT]: Authenticated private import descriptors, encrypted file reads and bounded plaintext sinks.
 * [OUTPUT]: Complete UTF-8 field streaming with exact full-field hash and optional bounded text collection.
 * [POS]: Shared client field decoder; search never substitutes preview text for missing field content.
 */
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { canonicalJson } from "../../../encryption/encoding";
import type { BlobSink } from "../../../blobs/transfer";
import { encryptedFileDescriptorSchema, type EncryptedFileDescriptor } from "../../../blobs/encrypted";
import { importFieldSchema } from "../model";
export type ImportFieldReader = { read(file: EncryptedFileDescriptor, sink: BlobSink<void>, signal: AbortSignal): Promise<void> };
export async function streamImportedField(raw: ReturnType<typeof importFieldSchema.parse>, reader: ImportFieldReader,
  write: (text: string) => Promise<void>, signal: AbortSignal) {
  const field = importFieldSchema.parse(raw), digest = sha256.create(), decoder = new TextDecoder("utf-8", { fatal: true }); let bytes = 0;
  for (const raw of field.chunks) {
    signal.throwIfAborted(); const file = encryptedFileDescriptorSchema.parse(raw); let received = 0;
    await reader.read(file, { write: async chunk => {
      signal.throwIfAborted(); received += chunk.byteLength; bytes += chunk.byteLength;
      if (received > file.bytes || bytes > field.bytes) throw new Error("IMPORT_FIELD_SIZE_CHANGED");
      digest.update(chunk);
      for (let offset = 0; offset < chunk.byteLength; offset += 32_768) {
        const text = decoder.decode(chunk.subarray(offset, offset + 32_768), { stream: true }); if (text) await write(text);
      }
    }, commit: async actual => { if (received !== file.bytes || canonicalJson(actual) !== canonicalJson(file)) throw new Error("IMPORT_FIELD_FILE_CHANGED"); }, abort: async () => {} }, signal);
  }
  signal.throwIfAborted();
  if (bytes !== field.bytes || bytesToHex(digest.digest()) !== field.sha256) throw new Error("IMPORT_FIELD_HASH_CHANGED");
  const tail = decoder.decode(); if (tail || !bytes) await write(tail); signal.throwIfAborted();
}
export async function readImportedFieldText(field: ReturnType<typeof importFieldSchema.parse>, reader: ImportFieldReader, signal: AbortSignal, maxBytes = 524_288) {
  if (field.bytes > maxBytes) throw new Error("IMPORT_FIELD_READ_BUDGET");
  const parts: string[] = []; let bytes = 0;
  await streamImportedField(field, reader, async text => {
    bytes += new TextEncoder().encode(text).byteLength;
    if (bytes > maxBytes) throw new Error("IMPORT_FIELD_READ_BUDGET"); parts.push(text);
  }, signal);
  return parts.join("");
}
