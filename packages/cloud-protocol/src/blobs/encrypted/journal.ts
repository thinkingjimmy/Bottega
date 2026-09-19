/**
 * [INPUT]: Closed opaque file identities, bounded envelope bytes and exact local source descriptors.
 * [OUTPUT]: Immutable intent/part/completion records and an original-outbox compare-and-set persistence port.
 * [POS]: Retry custody only; domain Stores retain consent, scheduling, retention and cleanup authority.
 */
import { z } from "zod";
import { MAX_ENVELOPE_BYTES } from "../../encryption";
import { blobDescriptorSchema, sha256Schema } from "../index";
import { encryptedFileDescriptorSchema, encryptedFileIdentitySchema, encryptedFilePartSchema, MAX_FILE_CHUNKS } from "./model";
const key = z.string().min(1).max(128);
export const frozenFileIntentSchema = z.object({ kind: z.literal("encrypted-file-intent"), key,
  userId: z.string().min(1).max(128), inputHash: sha256Schema, identity: encryptedFileIdentitySchema,
  source: blobDescriptorSchema.omit({ blobId: true }), sourceParts: z.array(sha256Schema).min(1).max(MAX_FILE_CHUNKS),
}).strict().refine(value => value.identity.chunkCount === value.sourceParts.length);
export const frozenFilePartSchema = z.object({ kind: z.literal("encrypted-file-part"), key, blobId: z.uuid(),
  part: encryptedFilePartSchema, envelope: z.string().min(1).max(Math.ceil(MAX_ENVELOPE_BYTES * 4 / 3)).regex(/^[A-Za-z0-9_-]+$/) }).strict();
export const frozenFileCompleteSchema = z.object({ kind: z.literal("encrypted-file-complete"), key, inputHash: sha256Schema,
  descriptor: encryptedFileDescriptorSchema }).strict();
export const frozenFileRecordSchema = z.discriminatedUnion("kind", [frozenFileIntentSchema, frozenFilePartSchema, frozenFileCompleteSchema]);
export type FrozenFileRecord = z.infer<typeof frozenFileRecordSchema>;
export type FrozenFileIntent = z.infer<typeof frozenFileIntentSchema>;
export interface FrozenFileJournal {
  read(key: string): Promise<FrozenFileRecord | null>;
  /** Commit-if-absent in the original owner transaction; return the committed winner. */
  write(key: string, value: FrozenFileRecord): Promise<FrozenFileRecord>;
}
