/**
 * [INPUT]: Depends on closed logical identities, file descriptors and immutable hashes.
 * [OUTPUT]: Defines portable App catalogs, fixed-identity operations, deletion disposition, package candidates and receipts.
 * [POS]: Account-scoped App metadata; no local paths, configuration, grants or runtime receipts cross this boundary.
 */
import { z } from "zod";
import { cloudIdSchema as id } from "../auth";
import { sha256Schema } from "../blobs";
import { tombstoneSchema } from "../lifecycle/model";
import { encryptedFileDescriptorSchema } from "../blobs/encrypted/model";
export const appIdSchema = z.string().regex(/^[a-z0-9]{10}$/);
const appRevisionSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const rev = appRevisionSchema;
export const appItemSchema = z.object({ appId: appIdSchema, projectId: id, baseId: id, displayName: z.string().min(1).max(120),
  sourceDeviceId: id, revision: rev, activePackageRevision: rev.nullable(), packageState: z.enum(["pending", "ready", "blocked"]),
  dataCoverage: z.enum(["base-only", "partial"]), createdAt: rev, updatedAt: rev }).strict();
export type CloudApp = z.infer<typeof appItemSchema>;
export const appDeletionSchema = z.object({ appId: appIdSchema, projectId: id, baseId: id, revision: rev.positive(),
  sourceDeviceId: id, createdAt: rev, tombstone: tombstoneSchema.extend({ entityKind: z.literal("app") }), retainBase: z.boolean(),
}).strict().refine(value => value.appId === value.tombstone.entityId);
export type CloudAppDeletion = z.infer<typeof appDeletionSchema>;
export const appOperationSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("create"), operationId: id, appId: appIdSchema, projectId: id, baseId: id,
    displayName: z.string().trim().min(1).max(120), metaJson: z.string().max(131_072) }).strict(),
  z.object({ kind: z.literal("rename"), operationId: id, appId: appIdSchema, expectedRevision: rev,
    displayName: z.string().trim().min(1).max(120) }).strict(),
  z.object({ kind: z.literal("delete"), operationId: id, appId: appIdSchema, expectedRevision: rev, retainBase: z.boolean() }).strict(),
]);
export type AppOperation = z.infer<typeof appOperationSchema>;
export const appReceiptSchema = z.object({ operationId: id, appId: appIdSchema, payloadHash: sha256Schema,
  kind: z.enum(["create", "rename", "delete", "publish"]), outcome: z.enum(["applied", "converged", "conflicted", "blocked"]),
  reason: z.enum(["revision-conflict", "atomic-migration-unavailable", "base-schema-changed", "deleted"]).nullable(),
  revision: rev, packageRevision: rev.nullable(), projectId: id, baseId: id, createdAt: rev }).strict();
export type AppReceipt = z.infer<typeof appReceiptSchema>;
export const packageCandidateInputSchema = z.object({ operationId: id, appId: appIdSchema, expectedRevision: rev,
  packageRevision: rev.positive(), baseSchemaRevision: rev, packageBlob: encryptedFileDescriptorSchema }).strict();
export const verifiedAppSourceSchema = z.object({ manifestDigest: sha256Schema, sourcePackageDigest: sha256Schema,
  originGenerationDigest: sha256Schema.nullable(), minBottegaVersion: z.string().max(256), migrationDigest: sha256Schema.nullable(),
  dataCoverage: z.enum(["base-only", "partial"]) }).strict();
export const appPackageSchema = verifiedAppSourceSchema.extend({ appId: appIdSchema, packageRevision: rev.positive(),
  packageBlob: encryptedFileDescriptorSchema, baseSchemaRevision: rev, createdAt: rev }).strict();
export type CloudAppPackage = z.infer<typeof appPackageSchema>;
