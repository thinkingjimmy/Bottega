/**
 * [INPUT]: Closed identity, revision and ciphertext-reference scalars.
 * [OUTPUT]: Chat, Project and App bindings with named allowed-metadata commitments.
 * [POS]: Record-level domain separation; no title, option value, source path or plaintext digest is metadata.
 */
import { z } from "zod";
import { agent, commitment, digest, id, nullableId, referencesSchema, version } from "./scalars";
const classificationMetadataSchema = z.object({ kind: z.enum(["ordinary", "app-use", "app-edit"]), projectId: nullableId, appId: nullableId }).strict()
  .refine(value => (value.kind === "ordinary") === (value.appId === null) && (value.kind !== "app-edit" || value.projectId !== null));
export const chatMetadataSchema = z.object({ incarnationId: id, classification: classificationMetadataSchema, sourceDeviceId: id,
  agent, agentRevision: version, expectedRevision: version, executionEpoch: version, archivedAt: version.nullable(), references: referencesSchema }).strict();
export const projectMetadataSchema = z.object({ role: z.enum(["workspace", "base-custody"]), appId: nullableId, sourceDeviceId: id,
  expectedRevision: version, archivedAt: version.nullable(), order: version, references: referencesSchema }).strict().refine(value => value.role !== "base-custody" || value.appId === null);
export const chatBindingSchema = z.object({ role: z.enum(["title", "facts", "metadata", "options", "classification", "initial"]),
  incarnationId: id, expectedRevision: version, metadataCommitment: digest }).strict();
export const projectBindingSchema = z.object({ role: z.enum(["facts", "operation", "result"]), expectedRevision: version, metadataCommitment: digest }).strict();
export const appBindingSchema = z.object({ role: z.enum(["facts", "operation", "package", "result"]), projectId: id, baseId: id,
  expectedRevision: version, packageRevision: version, metadataCommitment: digest }).strict();
export const hashChatMetadata = (value: z.input<typeof chatMetadataSchema>) => commitment("chat", chatMetadataSchema, value);
export const hashProjectMetadata = (value: z.input<typeof projectMetadataSchema>) => commitment("project", projectMetadataSchema, value);

export const skillHeadBindingSchema = z.object({ expectedRevision: version, slugKey: digest,
  activeGenerationDigest: digest.nullable(), tombstone: z.boolean() }).strict();
export const skillGenerationBindingSchema = z.object({ libraryId: id, generationId: id, blobId: id,
  manifestId: id, chunkIndex: version, chunkCount: version.positive() }).strict().refine(value => value.chunkIndex < value.chunkCount);
