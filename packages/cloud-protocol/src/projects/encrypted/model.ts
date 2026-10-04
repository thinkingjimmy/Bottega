/**
 * [INPUT]: Closed cryptographic identities, encrypted-space scope and original Project domain schemas.
 * [OUTPUT]: Bounded ciphertext Project facts, CAS intent, immutable operations and transport receipts.
 * [POS]: Server-safe Project wire owner; names, appearance and original operation hashes remain encrypted.
 */
import { z } from "zod";
import { id, version, digest } from "../../encryption/domains/scalars";
import { encryptedSpaceSchema } from "../../spaces";
export const PROJECT_CIPHER_LIMITS = Object.freeze({ packetBytes: 16_384, operationBytes: 49_152, pageBytes: 786_432, pageItems: 30 });
export const projectPacketSchema = z.object({ envelope: z.string().min(1).max(21_846).regex(/^[A-Za-z0-9_-]+$/),
  ciphertextHash: digest, ciphertextBytes: version.positive().max(PROJECT_CIPHER_LIMITS.packetBytes) }).strict();
export const projectIntentSchema = z.object({ kind: z.enum(["create", "patch", "delete"]), role: z.enum(["workspace", "base-custody"]),
  appId: id.nullable(), sourceDeviceId: id, actorDeviceId: id, expectedRevision: version, createdAt: version,
  archivedAt: version.nullable(), order: version }).strict().refine(value =>
    (value.role !== "base-custody" || value.appId === null) && (value.kind !== "create" || value.expectedRevision === 0));
export const encryptedProjectOperationSchema = z.object({ projectId: id, operationId: id, intent: projectIntentSchema,
  facts: projectPacketSchema.nullable(), operation: projectPacketSchema, ciphertextHash: digest }).strict()
  .refine(value => (value.intent.kind === "delete") === (value.facts === null));
export const encryptedProjectHeadSchema = z.object({ projectId: id, operationId: id, encryptedSpace: encryptedSpaceSchema,
  intent: projectIntentSchema, facts: projectPacketSchema, revision: version.positive(), createdAt: version, updatedAt: version }).strict()
  .refine(value => value.intent.kind !== "delete" && value.revision === value.intent.expectedRevision + 1 &&
    value.createdAt === value.intent.createdAt && value.updatedAt >= value.createdAt);
export const encryptedProjectReceiptSchema = z.object({ operationId: id, projectId: id, ciphertextHash: digest,
  status: z.enum(["applied", "converged", "conflicted", "deleted"]), project: encryptedProjectHeadSchema.nullable(),
  sourceDeviceId: id, createdAt: version }).strict().refine(value => (value.status === "deleted") === (value.project === null));
export const frozenProjectOperationSchema = z.object({ encryptedSpace: encryptedSpaceSchema, plaintextHash: digest,
  transport: encryptedProjectOperationSchema }).strict();
export type ProjectPacket = z.infer<typeof projectPacketSchema>;
export type ProjectIntent = z.infer<typeof projectIntentSchema>;
export type EncryptedProjectOperation = z.infer<typeof encryptedProjectOperationSchema>;
export type EncryptedProjectHead = z.infer<typeof encryptedProjectHeadSchema>;
export type EncryptedProjectReceipt = z.infer<typeof encryptedProjectReceiptSchema>;
export type FrozenProjectOperation = z.infer<typeof frozenProjectOperationSchema>;
