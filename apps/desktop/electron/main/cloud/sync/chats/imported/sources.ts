/**
 * [INPUT]: Depends on immutable ChatStore sources, bounded retained import blobs and closed portable tool fields.
 * [OUTPUT]: Reconstructs exact imported text and packed ordered process/tool collections without source IDs or scanner metadata.
 * [POS]: Main imported source mapper; mutable scanner state is never consulted during retry.
 */
import { z } from "zod";
import { hashBytes, type BlobSource } from "@ai-chat/cloud-protocol";
import { completionFields } from "@ai-chat/cloud-protocol/chats/content/completion";
import { hashChatContent } from "@ai-chat/cloud-protocol/chats/transcript/body";
import { agentBackendIdSchema } from "@ai-chat/cloud-protocol/chats/options";
import type { SyncScope } from "../../../../../../shared/local-storage/contracts";
import { retainedSourceRefSchema } from "../../../../chats/sqlite/cloud/delivery/contracts";
import { readChatSource, type ChatSyncStore, type SourceRef } from "../sources";
import { memoryBlobSource } from "../bodies";
const hash = z.string().regex(/^[a-f0-9]{64}$/), number = z.number().int().nonnegative();
export const frozenImportSchema = z.object({ generation: z.object({ generation_id: z.string(), content_digest: hash, digest_codec_version: number,
  incomplete_tail: z.boolean(), entry_count: number, source_kind: agentBackendIdSchema }).strict(),
  sources: z.array(retainedSourceRefSchema).max(250000) }).strict();
const entrySource = z.object({ entryVersionId: z.string(), deliverySeq: number.positive(), contentDigest: hash, digestCodecVersion: number,
  role: z.enum(["user", "assistant"]), createdAt: number.nullable(), payload: z.record(z.string(), z.unknown()) }).strict();
const chunkSource = z.object({ entryVersionId: z.string(), chunk: z.object({ field_kind: z.string(), ordinal: number, content: z.string(), byte_size: number, content_digest: hash }).strict() }).strict();
const blobSource = z.object({ entryVersionId: z.string(), fieldKind: z.string(), blob: z.object({ sha256: hash, bytes: number, mime: z.literal("text/plain") }).strict() }).strict();
const toolSchema = z.object({ id: z.string(), name: z.string(), input: z.string().optional(), output: z.string().optional(),
  completion: completionFields.completion, completionReason: completionFields.completionReason }).strip();
const stepSchema = z.object({ text: z.string(), tools: z.array(toolSchema).optional() }).strip();
export type ImportSourceEntry = { metadata: z.infer<typeof entrySource>; fields: Array<{ field: string; encoding: "text" | "json"; source: BlobSource }> };
const textSource = (text: string) => memoryBlobSource(new TextEncoder().encode(text), "text/plain");
const tool = (input: unknown) => { const value = toolSchema.parse(input); return { ...value, id: hashChatContent(["import-tool", value.id]) }; };
export async function* readImportedSources(store: ChatSyncStore, scope: SyncScope, frozen: z.infer<typeof frozenImportSchema>, signal: AbortSignal): AsyncGenerator<ImportSourceEntry> {
  let entry: z.infer<typeof entrySource> | null = null, reference: SourceRef | null = null;
  let chunks: z.infer<typeof chunkSource>["chunk"][] = [], blob: z.infer<typeof blobSource>["blob"] | null = null;
  const finish = (): ImportSourceEntry => {
    if (!entry || !reference) throw new Error("IMPORT_ENTRY_UNAVAILABLE");
    const metadata = entry, fields: ImportSourceEntry["fields"] = [], saved = metadata.payload;
    if (blob) {
      const original = blob, ref = reference;
      fields.push({ field: "content", encoding: "text", source: { bytes: original.bytes, mime: "text/plain", read: async (offset, size) => {
        const bytes = new Uint8Array(size); let read = 0;
        while (read < size) {
          signal.throwIfAborted(); const result = await store.read(scope, { type: "source-blob", sourceId: ref.sourceId, sha256: original.sha256,
            offset: offset + read, length: Math.min(128 * 1024, size - read) });
          if (result.type !== "source-blob" || result.value.bytes !== original.bytes || result.value.offset !== offset + read) throw new Error("IMPORT_BLOB_CHANGED");
          const part = Buffer.from(result.value.data, "base64"); if (!part.length || part.length > size - read) throw new Error("IMPORT_BLOB_CHANGED");
          bytes.set(part, read); read += part.length;
        }
        return bytes;
      } } });
    } else {
      chunks.sort((a, b) => a.ordinal - b.ordinal);
      for (const [ordinal, chunk] of chunks.entries()) if (chunk.ordinal !== ordinal || Buffer.byteLength(chunk.content) !== chunk.byte_size ||
        hashBytes(new TextEncoder().encode(chunk.content)) !== chunk.content_digest) throw new Error("IMPORT_CHUNK_CHANGED");
      if (!chunks.length) throw new Error("IMPORT_CONTENT_UNAVAILABLE");
      fields.push({ field: "content", encoding: "text", source: textSource(chunks.map(chunk => chunk.content).join("")) });
    }
    // A long agent turn can contain hundreds of steps. Pack each ordered collection
    // into logical files instead of spending one file reference on every small step.
    const tools = z.array(z.unknown()).parse(saved.tools ?? []).map(tool);
    const process = z.array(stepSchema).parse(saved.process ?? []).map(input => ({
      text: input.text, ...(input.tools ? { tools: input.tools.map(tool) } : {}),
    }));
    if (tools.length + process.length > 63) {
      if (tools.length) fields.push({ field: "tools", encoding: "json", source: textSource(JSON.stringify(tools)) });
      if (process.length) fields.push({ field: "process", encoding: "json", source: textSource(JSON.stringify(process)) });
    } else {
      for (const [index, value] of tools.entries()) fields.push({ field: `tool-${index}`, encoding: "json", source: textSource(JSON.stringify(value)) });
      for (const [index, value] of process.entries()) fields.push({ field: `process-${index}`, encoding: "json", source: textSource(JSON.stringify(value)) });
    }
    if (saved.parts !== undefined) throw new Error("IMPORT_UNSUPPORTED_SAVED_PARTS");
    return { metadata, fields };
  };
  for (const ref of frozen.sources) {
    signal.throwIfAborted(); const raw = await readChatSource(store, scope, ref), value = entrySource.safeParse(raw);
    if (value.success) {
      if (entry) yield finish(); entry = value.data; reference = ref; chunks = []; blob = null; continue;
    }
    if (!entry) throw new Error("IMPORT_SOURCE_ORDER_INVALID");
    const chunk = chunkSource.safeParse(raw);
    if (chunk.success) {
      if (chunk.data.entryVersionId !== entry.entryVersionId) throw new Error("IMPORT_SOURCE_ORDER_INVALID");
      if (chunk.data.chunk.field_kind === "content") chunks.push(chunk.data.chunk);
      continue;
    }
    const part = blobSource.parse(raw);
    if (part.entryVersionId !== entry.entryVersionId || part.fieldKind !== "content" || blob) throw new Error("IMPORT_SOURCE_ORDER_INVALID");
    blob = part.blob;
  }
  if (entry) yield finish();
}
