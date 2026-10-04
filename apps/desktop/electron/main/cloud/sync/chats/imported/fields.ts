/**
 * [INPUT]: Retained immutable UTF-8 sources, admitted crypto and the original Chat file journal.
 * [OUTPUT]: Private imported entries whose bounded files have frozen authenticated ciphertext manifests, folding trailing tool outputs away when one entry exceeds the chunk budget.
 * [POS]: Import field encoder; logical file boundaries preserve UTF-8 and original whole-field hashes.
 */
import { createHash } from "node:crypto";
import { MAX_BLOB_BYTES, type BlobDescriptor, type BlobSource } from "@ai-chat/cloud-protocol";
import { prepareEncryptedFile } from "@ai-chat/cloud-protocol/blobs/encrypted/client";
import { FILE_CHUNK_BYTES, type FrozenFileJournal, type FileCipherPort } from "@ai-chat/cloud-protocol/blobs/encrypted";
import { IMPORT_ENTRY_CHUNK_BUDGET, importedEntrySchema, importedEntryHash, type ImportedEntry } from "@ai-chat/cloud-protocol/chats/imported/model";
import { hashChatContent } from "@ai-chat/cloud-protocol/chats/transcript/body";
import { completionMetadataSchema } from "@ai-chat/cloud-protocol/chats/content/completion";
import type { ImportSourceEntry } from "./sources";
export const sliceSource = (source: BlobSource, offset: number, bytes: number): BlobSource => ({ bytes, mime: source.mime,
  read: (start, length) => { if (start < 0 || length < 0 || start + length > bytes) throw new Error("IMPORT_FILE_RANGE_INVALID"); return source.read(offset + start, length); } });
async function fileLength(source: BlobSource, offset: number, signal: AbortSignal) {
  let length = Math.min(MAX_BLOB_BYTES, source.bytes - offset);
  if (offset + length === source.bytes) return length;
  for (let count = 0; count < 4; count++, length--) {
    signal.throwIfAborted(); const next = await source.read(offset + length, 1);
    if (next.byteLength !== 1) throw new Error("IMPORT_CONTENT_CHANGED");
    if ((next[0]! & 0xc0) !== 0x80) return length;
  }
  throw new Error("IMPORT_UTF8_BOUNDARY_INVALID");
}
export async function encodeImportedEntry(input: ImportSourceEntry, identity: { chatId: string; generationId: string; outboxId: string },
  crypto: FileCipherPort, journal: FrozenFileJournal, signal: AbortSignal) {
  return encodeImportedContent(input, (source, descriptor, field, offset) => {
    const key = hashChatContent(["import-file", identity.outboxId, identity.generationId, input.metadata.deliverySeq, field, offset]);
    return prepareEncryptedFile({ key, operationId: key, owner: { kind: "chat", id: identity.chatId }, ownerGeneration: identity.generationId, source: descriptor }, source, crypto, journal, signal);
  }, signal);
}
/* Nothing is written until the whole entry fits: the plan is the exact file split every field would produce,
   so an over-budget entry drops its trailing tools instead of leaving prepared ciphertext nobody references. */
async function filePlan(source: BlobSource, signal: AbortSignal) {
  const lengths: number[] = []; let offset = 0;
  do { const length = await fileLength(source, offset, signal); lengths.push(length); offset += length; } while (offset < source.bytes);
  return lengths;
}
const isTool = (field: string) => field.startsWith("tool-");
async function foldToBudget(input: ImportSourceEntry, signal: AbortSignal) {
  const plans = new Map<string, number[]>();
  for (const field of input.fields) plans.set(field.field, await filePlan(field.source, signal));
  // The message itself and its process steps are never dropped; tools are kept in source order while the budget lasts.
  let budget = IMPORT_ENTRY_CHUNK_BUDGET - input.fields.filter(field => !isTool(field.field)).reduce((sum, field) => sum + plans.get(field.field)!.length, 0);
  if (budget < 0) throw new Error("IMPORT_ENTRY_FILE_BUDGET");
  const tools = input.fields.filter(field => isTool(field.field));
  let carried = 0;
  while (carried < tools.length) { const need = plans.get(tools[carried]!.field)!.length; if (need > budget) break; budget -= need; carried++; }
  const dropped = new Set(tools.slice(carried).map(field => field.field));
  return { plans, dropped, fields: input.fields.filter(field => !dropped.has(field.field)) };
}
export async function encodeImportedContent(input: ImportSourceEntry,
  write: (source: BlobSource, descriptor: Omit<BlobDescriptor, "blobId">, field: string, offset: number) => Promise<BlobDescriptor>, signal: AbortSignal) {
  const plan = await foldToBudget(input, signal), fields: ImportedEntry["fields"] = [];
  for (const field of plan.fields) {
    const whole = createHash("sha256"), chunks: ImportedEntry["fields"][number]["chunks"] = [];
    let offset = 0;
    for (const length of plan.plans.get(field.field)!) {
      const hash = createHash("sha256");
      for (let read = 0; read < length;) {
        signal.throwIfAborted(); const size = Math.min(FILE_CHUNK_BYTES, length - read), bytes = new Uint8Array(await field.source.read(offset + read, size));
        try { if (bytes.length !== size) throw new Error("IMPORT_CONTENT_CHANGED"); hash.update(bytes); whole.update(bytes); read += size; }
        finally { bytes.fill(0); }
      }
      const source = { sha256: hash.digest("hex"), bytes: length, mime: "text/plain" };
      chunks.push(await write(sliceSource(field.source, offset, length), source, field.field, offset)); offset += length;
    }
    fields.push({ field: field.field, encoding: field.encoding, bytes: field.source.bytes, sha256: whole.digest("hex"), chunks });
  }
  const { metadata } = input, payload = metadata.payload, completion = completionMetadataSchema.parse(payload);
  const entry = importedEntrySchema.parse({ entryVersionId: "0".repeat(64), deliverySeq: metadata.deliverySeq, role: metadata.role, createdAt: metadata.createdAt,
    ...(completion.completion ? { completion: completion.completion } : {}), ...(completion.completionReason ? { completionReason: completion.completionReason } : {}),
    preview: typeof payload.preview === "string" ? payload.preview.slice(0, 500) : "", workedForMs: payload.workedForMs ?? null, plan: payload.plan === true, fields,
    ...(plan.dropped.size ? { omitted: { tools: plan.dropped.size } } : {}) });
  return { ...entry, entryVersionId: importedEntryHash(entry) };
}
