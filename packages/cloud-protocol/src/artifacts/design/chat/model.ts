/**
 * [INPUT]: Closed design references and exact document/source identities.
 * [OUTPUT]: Original source-save query identity and main-frozen Chat/request edit work set with at most eight explicit documents and 32 targets each.
 * [POS]: Durable manual-turn edit purpose; no filesystem root, window lease or ordinary tool grant is serialized.
 */
import { z } from "zod";
import { designId, artifactIdSchema, digestSchema } from "../reference/identifiers";
import { designReferenceSchema } from "../reference/model";
const work = z.object({ documentId: designId, artifactId: artifactIdSchema, revision: z.number().int().positive(), readSetDigest: digestSchema,
  snapshotRef: digestSchema, references: z.array(designReferenceSchema).min(1).max(32) }).strict().refine(value => value.references.every(reference => reference.documentId === value.documentId && reference.purpose === "edit" && reference.native), "Frozen targets must belong to their explicit work");
export const frozenArtifactEditSchema = z.object({ kind: z.literal("artifact-edit/v1"), chatId: z.string().min(1).max(128), incarnationId: z.string().min(1).max(128),
  requestId: artifactIdSchema, generation: z.string().min(1).max(128), works: z.array(work).min(1).max(8) }).strict()
  .refine(value => new Set(value.works.map(work => work.documentId)).size === value.works.length && value.works.every(work => work.references.every(reference => reference.generation === value.generation)), "Frozen work identities or generations conflict");
export type FrozenArtifactEdit = z.infer<typeof frozenArtifactEditSchema>;

export const pendingArtifactChatSaveSchema = z.object({ artifactId: artifactIdSchema,
  requestId: z.string().regex(/^chat-edit-[a-f0-9]{48}$/) }).strict();
export type PendingArtifactChatSave = z.infer<typeof pendingArtifactChatSaveSchema>;
