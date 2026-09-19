/**
 * [INPUT]: Depends on verified private-file URLs, immutable import fields and incremental SHA-256.
 * [OUTPUT]: Verifies complete imported fields, prepares bounded page bodies and exposes UTF-8-safe text windows without clipping stored content.
 * [POS]: Session-scoped imported content; prepared Blobs are reused across virtual row mounts and never stored globally.
 */
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import type { ImportedEntry } from "@ai-chat/cloud-protocol/chats/imported/model";
import type { TranscriptSource } from "../contracts";
export async function readImportedField(chatId: string, field: ImportedEntry["fields"][number], source: Pick<TranscriptSource, "file">, signal: AbortSignal) {
  const hash = sha256.create(), blobs: Blob[] = []; let length = 0;
  for (const descriptor of field.chunks) {
    signal.throwIfAborted(); const file = await source.file(chatId, descriptor, signal);
    try {
      if (!file.url.startsWith("blob:")) throw new Error("PRIVATE_FILE_URL_REQUIRED");
      const response = await fetch(file.url, { signal, credentials: "omit", redirect: "error" });
      if (!response.ok) throw new Error("IMPORT_FIELD_UNAVAILABLE");
      const blob = await response.blob(); if (blob.size !== descriptor.bytes) throw new Error("IMPORT_FIELD_CHANGED");
      for (let offset = 0; offset < blob.size; offset += 1024 * 1024) { signal.throwIfAborted(); hash.update(new Uint8Array(await blob.slice(offset, offset + 1024 * 1024).arrayBuffer())); }
      blobs.push(blob); length += blob.size;
    } finally { file.release(); }
  }
  signal.throwIfAborted(); if (length !== field.bytes || bytesToHex(hash.digest()) !== field.sha256) throw new Error("IMPORT_FIELD_CHANGED");
  return new Blob(blobs, { type: field.encoding === "json" ? "application/json" : "text/plain;charset=utf-8" });
}
export async function importedTextWindow(blob: Blob, offset: number, signal: AbortSignal) {
  signal.throwIfAborted(); const limit = 64 * 1024, bytes = new Uint8Array(await blob.slice(offset, offset + limit + 4).arrayBuffer());
  let end = Math.min(limit, bytes.length);
  while (end < bytes.length && end > 0 && (bytes[end]! & 0xc0) === 0x80) end--;
  signal.throwIfAborted(); const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, end));
  return { text, next: offset + end < blob.size ? offset + end : null };
}

export const AUTOMATIC_FIELD_BYTES = 64 * 1024;
export type PreparedImportedField = { blob: Blob; text: string; next: number | null; error?: false } | { error: true };

export async function prepareImportedBody(chatId: string, entry: ImportedEntry, source: Pick<TranscriptSource, "file">, signal: AbortSignal): Promise<PreparedImportedField | undefined> {
  const field = entry.fields.find(item => item.field === "content")!;
  if (field.bytes > AUTOMATIC_FIELD_BYTES) return;
  try {
    // A complete authenticated preview already contains the body; confirm its digest before reusing it.
    const preview = new TextEncoder().encode(entry.preview);
    const complete = preview.length === field.bytes && bytesToHex(sha256(preview)) === field.sha256;
    const blob = complete ? new Blob([preview], { type: "text/plain;charset=utf-8" }) : await readImportedField(chatId, field, source, signal);
    const page = await importedTextWindow(blob, 0, signal);
    return { blob, ...page };
  } catch {
    signal.throwIfAborted();
    return { error: true };
  }
}
