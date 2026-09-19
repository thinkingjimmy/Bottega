/**
 * [INPUT]: Depends on closed account scopes and logical blob descriptors.
 * [OUTPUT]: Defines bounded encrypted uploads, claim-only reuse of ready blobs, receipts and authenticated reads.
 * [POS]: Shared private-file RPC boundary; storage IDs and provider URLs stay inside the backend.
 */
import { z } from "zod";
import { cloudIdSchema as id } from "../auth";
import { encryptedBusinessHeaderSchema as businessHeaderSchema } from "../spaces";
import { blobOwnerSchema, logicalBlobIdSchema, sha256Schema } from "./index";
import { ciphertextFileDescriptorSchema, encryptedFilePartSchema, encryptedFileManifestSchema, MAX_FILE_CHUNKS } from "./encrypted/model";
import { canonicalJson } from "../encryption/encoding";
const integer = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const blobContentKindSchema = z.enum(["gallery", "thumbnail", "chat-attachment", "message-overflow", "history-generation", "home-snapshot", "app-package", "artifact", "skill-file", "skill-generation"]);
export const blobPartSchema = encryptedFilePartSchema;
const uploadStateSchema = z.enum(["uploading", "verifying", "ready", "cancelled", "failed", "expired"]);
export const uploadStatusSchema = z.object({ uploadId: id, blobId: logicalBlobIdSchema, payloadHash: sha256Schema, state: uploadStateSchema,
  received: z.array(blobPartSchema).max(MAX_FILE_CHUNKS), expiresAt: integer, reason: z.string().max(128).nullable(), retryAt: integer.nullable() }).strict();
export type BlobUploadStatus = z.infer<typeof uploadStatusSchema>;
export const beginUploadSchema = businessHeaderSchema.extend({ uploadId: id, owner: blobOwnerSchema, contentKind: blobContentKindSchema,
  claimOnly: z.literal(true).optional(), descriptor: ciphertextFileDescriptorSchema, parts: z.array(blobPartSchema).min(1).max(MAX_FILE_CHUNKS) }).strict().superRefine((value, ctx) => {
  if (value.parts.length !== value.descriptor.encryption.chunkCount || value.parts.some((part, index) => part.partIndex !== index) ||
    value.parts.reduce((sum, part) => sum + part.bytes, 0) !== value.descriptor.bytes ||
    canonicalJson(value.owner) !== canonicalJson(value.descriptor.encryption.owner) ||
    canonicalJson(value.encryptedSpace) !== canonicalJson(value.descriptor.encryption.encryptedSpace)) {
    ctx.addIssue({ code: "custom", message: "invalid-part-manifest" });
  }
});
export type BeginBlobUpload = z.infer<typeof beginUploadSchema>;
const uploadRequest = businessHeaderSchema.extend({ uploadId: id }).strict();
const readRequest = businessHeaderSchema.extend({ blobId: logicalBlobIdSchema, owner: blobOwnerSchema }).strict();
export const blobReadPlanSchema = z.object({ descriptor: ciphertextFileDescriptorSchema, owner: blobOwnerSchema,
  locationId: id, locationRevision: integer.positive(), expiresAt: integer, parts: z.array(blobPartSchema).min(1).max(MAX_FILE_CHUNKS) }).strict();
export type BlobReadPlan = z.infer<typeof blobReadPlanSchema>;
export const uploadPartRequestSchema = uploadRequest.extend({ partIndex: integer.max(MAX_FILE_CHUNKS - 1), sha256: sha256Schema }).strict();
export const readPartRequestSchema = readRequest.extend({ locationId: id, locationRevision: integer.positive(), expiresAt: integer,
  partIndex: integer.max(MAX_FILE_CHUNKS - 1) }).strict();
const referenceRequest = businessHeaderSchema.extend({ owner: blobOwnerSchema, referenceId: z.string().min(1).max(128) }).strict();
export const blobFunctions = {
  "blobs/references:describe": { kind: "query", args: referenceRequest, result: encryptedFileManifestSchema.nullable() },
  "blobs/references:replaceArtifact": { kind: "mutation", args: referenceRequest.extend({ blobs: z.array(ciphertextFileDescriptorSchema).max(1) }).strict(), result: z.null() },
  "blobs/api:begin": { kind: "mutation", args: beginUploadSchema, result: uploadStatusSchema },
  "blobs/api:status": { kind: "query", args: uploadRequest, result: uploadStatusSchema },
  "blobs/api:finalize": { kind: "mutation", args: uploadRequest, result: uploadStatusSchema },
  "blobs/api:cancel": { kind: "mutation", args: uploadRequest, result: uploadStatusSchema },
  "blobs/transfer/reads:plan": { kind: "query", args: readRequest, result: blobReadPlanSchema },
} as const;
