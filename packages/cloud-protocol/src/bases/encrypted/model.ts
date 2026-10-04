/**
 * [INPUT]: Closed Base domain bindings and immutable encrypted-space identities.
 * [OUTPUT]: Bounded typed ciphertext fields, initial states, commits, receipts and read projections.
 * [POS]: Server-safe Base transport; no semantic Base value schema or plaintext hash is accepted here.
 */
import { z } from "zod";
import { baseFieldBindingSchema, baseInitialMetadataSchema, baseOperationMetadataSchema, baseTargetSchema } from "../../encryption/domains/bases";
import { referencesSchema, id, version, digest } from "../../encryption/domains/scalars";
import { encryptedSpaceSchema } from "../../spaces";
export const ENCRYPTED_BASE_LIMITS = Object.freeze({ commitBytes: 786_432, initialBytes: 786_432, pageBytes: 786_432, fields: 192, rowsPerPage: 50, metadataFields: 512 });
const cipherPacketSchema = z.object({ envelope: z.string().min(1).max(131_072).regex(/^[A-Za-z0-9_-]+$/),
  ciphertextHash: digest, ciphertextBytes: version.positive().max(98_304) }).strict();
export const encryptedBaseFieldSchema = z.object({ operationId: id, binding: baseFieldBindingSchema, packet: cipherPacketSchema,
  references: referencesSchema }).strict();
export const encryptedBaseInitialSchema = z.object({ baseId: id, operationId: id, intent: baseInitialMetadataSchema,
  fields: z.array(encryptedBaseFieldSchema).min(4).max(100), operation: cipherPacketSchema, ciphertextHash: digest }).strict();
export const encryptedBaseCommitSchema = z.object({ baseId: id, operationId: id, intent: baseOperationMetadataSchema,
  fields: z.array(encryptedBaseFieldSchema).min(1).max(192), operation: cipherPacketSchema, ciphertextHash: digest }).strict();
const encryptedBaseVersionMapSchema = z.record(z.string().min(1).max(384), version);
export const encryptedBaseHeadSchema = z.object({ baseId: id, encryptedSpace: encryptedSpaceSchema,
  authority: baseInitialMetadataSchema, initial: encryptedBaseInitialSchema,
  fields: z.array(encryptedBaseFieldSchema).max(512), cloudRevision: version, metadataRevision: version, schemaRevision: version, structuralGeneration: version,
  rowsGeneration: version, fieldVersions: encryptedBaseVersionMapSchema, columnSchemaVersions: encryptedBaseVersionMapSchema }).strict();
export const encryptedBaseRowSchema = z.object({ rowId: id, fields: z.array(encryptedBaseFieldSchema).max(65),
  fieldVersions: encryptedBaseVersionMapSchema, lifeVersion: version, revision: version }).strict();
export const encryptedBaseProjectionSchema = z.object({ target: baseTargetSchema, version,
  field: encryptedBaseFieldSchema.nullable(), related: z.array(encryptedBaseFieldSchema).max(192) }).strict();
const encryptedBaseOutcomeSchema = z.object({ index: version.max(63), status: z.enum(["applied", "converged", "conflicted", "rejected"]),
  reason: z.enum(["deleted", "deleted-view", "field-changed", "schema-changed", "structure-changed", "target-missing", "dependency-unresolved", "app-structure-readonly", "blob-not-ready", "identity-conflict", "metadata-fields-required", "duplicate-target", "operation-too-large"]).nullable() }).strict();
export const encryptedBaseReceiptSchema = z.object({ baseId: id, operationId: id, ciphertextHash: digest, cloudRevision: version,
  results: z.array(encryptedBaseOutcomeSchema).min(1).max(64), schemaRevision: version, structuralGeneration: version,
  columnSchemaVersions: encryptedBaseVersionMapSchema, fieldVersions: encryptedBaseVersionMapSchema,
  baseline: z.array(encryptedBaseProjectionSchema).max(4096), commit: encryptedBaseCommitSchema }).strict();
export const encryptedBaseConflictSchema = z.object({ conflictId: id, commit: encryptedBaseCommitSchema, indexes: z.array(version.max(63)).min(1).max(64),
  current: z.array(encryptedBaseProjectionSchema).max(192), currentFieldVersions: encryptedBaseVersionMapSchema,
  sourceDeviceId: id, sourceDeviceName: z.string().min(1).max(40).nullable(), reason: encryptedBaseOutcomeSchema.shape.reason.unwrap(),
  state: z.literal("unresolved"), createdAt: version }).strict();
export const encryptedBaseLookupSchema = z.object({ receipt: encryptedBaseReceiptSchema,
  sourceDeviceId: id, sourceDeviceName: z.string().min(1).max(40).nullable(), createdAt: version,
  candidates: z.array(z.object({ conflictId: id, indexes: z.array(version.max(63)).min(1).max(64),
    state: z.enum(["unresolved", "applied", "discarded", "superseded"]), resolutionOperationId: id.nullable() }).strict()).max(64),
  resolutionReceipt: encryptedBaseReceiptSchema.nullable() }).strict();
export type CipherPacket = z.infer<typeof cipherPacketSchema>;
export type EncryptedBaseField = z.infer<typeof encryptedBaseFieldSchema>;
export type EncryptedBaseInitial = z.infer<typeof encryptedBaseInitialSchema>;
export type EncryptedBaseCommit = z.infer<typeof encryptedBaseCommitSchema>;
export type EncryptedBaseHead = z.infer<typeof encryptedBaseHeadSchema>;
export type EncryptedBaseRow = z.infer<typeof encryptedBaseRowSchema>;
export type EncryptedBaseProjection = z.infer<typeof encryptedBaseProjectionSchema>;
export type EncryptedBaseReceipt = z.infer<typeof encryptedBaseReceiptSchema>;
export type BaseCipherTarget = z.infer<typeof baseTargetSchema>;
export type BaseCipherIntent = z.infer<typeof baseOperationMetadataSchema>;
