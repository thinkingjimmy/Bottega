/**
 * [INPUT]: Encrypted Project/Base initial contracts, opaque file manifests and fixed App identities.
 * [OUTPUT]: Closed ciphertext App operations, catalog heads, packages and immutable receipts.
 * [POS]: Server-safe App transport; names, source facts, MIME and plaintext hashes never enter clear fields.
 */
import { z } from "zod";
import { id, digest, version } from "../../encryption/domains/scalars";
import { encryptedSpaceSchema } from "../../spaces";
import { encryptedProjectOperationSchema, projectPacketSchema } from "../../projects/encrypted";
import { encryptedBaseInitialSchema } from "../../bases/encrypted";
import { ciphertextFileDescriptorSchema } from "../../blobs/encrypted/model";
import { appIdSchema } from "../model";
export const APP_CIPHER_LIMITS = Object.freeze({ operationBytes: 950_272, pageItems: 30, pageBytes: 786_432, pendingPackages: 64 });
export const appCipherIntentSchema = z.object({ kind: z.enum(["create", "rename", "delete", "publish"]), projectId: id, baseId: id,
  sourceDeviceId: id, actorDeviceId: id, expectedRevision: version, expectedProjectRevision: version, expectedBaseRevision: version,
  packageRevision: version.positive().nullable(), baseSchemaRevision: version, createdAt: version,
  retainBase: z.boolean().nullable(), migration: z.enum(["initial", "unchanged", "requires-atomic"]).nullable() }).strict().refine(value =>
    (value.kind === "delete") === (value.retainBase !== null) && (value.kind === "publish") === (value.migration !== null) &&
    (value.kind !== "create" || value.expectedRevision === 0 && value.expectedProjectRevision === 0 && value.expectedBaseRevision === 0 && value.packageRevision === null) &&
    (value.kind !== "publish" || value.packageRevision !== null));
export const encryptedAppOperationSchema = z.object({ appId: appIdSchema, operationId: id, intent: appCipherIntentSchema,
  facts: projectPacketSchema.nullable(), project: encryptedProjectOperationSchema.nullable(), initial: encryptedBaseInitialSchema.nullable(),
  package: projectPacketSchema.nullable(), packageFile: ciphertextFileDescriptorSchema.nullable(), operation: projectPacketSchema, ciphertextHash: digest }).strict()
  .refine(value => (value.intent.kind === "delete") === (value.facts === null) && (value.intent.kind === "create") === (value.initial !== null) &&
    (value.intent.kind === "publish") === (value.package !== null) && (value.intent.kind === "publish") === (value.packageFile !== null) &&
    (value.intent.kind === "create" || value.intent.kind === "rename" || value.intent.kind === "delete" && value.intent.retainBase === true) === (value.project !== null));
export const encryptedAppHeadSchema = z.object({ appId: appIdSchema, projectId: id, baseId: id, operationId: id, encryptedSpace: encryptedSpaceSchema,
  intent: appCipherIntentSchema, facts: projectPacketSchema, revision: version.positive(), activePackageRevision: version.positive().nullable(),
  packageState: z.enum(["pending", "ready", "blocked"]), sourceDeviceId: id, createdAt: version, updatedAt: version }).strict()
  .refine(value => value.intent.kind !== "delete" && value.projectId === value.intent.projectId && value.baseId === value.intent.baseId &&
    value.revision === value.intent.expectedRevision + 1 && value.createdAt === value.intent.createdAt && value.sourceDeviceId === value.intent.sourceDeviceId &&
    value.activePackageRevision === value.intent.packageRevision && value.updatedAt >= value.createdAt);
export const encryptedAppPackageSchema = z.object({ appId: appIdSchema, operationId: id, encryptedSpace: encryptedSpaceSchema,
  intent: appCipherIntentSchema, packet: projectPacketSchema, packageFile: ciphertextFileDescriptorSchema, createdAt: version }).strict()
  .refine(value => value.intent.kind === "publish");
export const encryptedAppReceiptSchema = z.object({ operationId: id, appId: appIdSchema, ciphertextHash: digest,
  kind: z.enum(["create", "rename", "delete", "publish"]), outcome: z.enum(["applied", "converged", "conflicted", "blocked"]),
  reason: z.enum(["revision-conflict", "atomic-migration-unavailable", "base-schema-changed", "deleted"]).nullable(),
  revision: version, packageRevision: version.positive().nullable(), projectId: id, baseId: id, createdAt: version }).strict();
export const encryptedAppCandidateSchema = z.object({ transport: encryptedAppOperationSchema, state: z.enum(["ready", "discarded"]),
  receipt: encryptedAppReceiptSchema.nullable() }).strict();
export const frozenAppOperationSchema = z.object({ encryptedSpace: encryptedSpaceSchema, plaintextHash: digest, transport: encryptedAppOperationSchema }).strict();
export type AppCipherIntent = z.infer<typeof appCipherIntentSchema>;
export type EncryptedAppOperation = z.infer<typeof encryptedAppOperationSchema>;
export type EncryptedAppHead = z.infer<typeof encryptedAppHeadSchema>;
export type EncryptedAppPackage = z.infer<typeof encryptedAppPackageSchema>;
export type EncryptedAppReceipt = z.infer<typeof encryptedAppReceiptSchema>;
export type FrozenAppOperation = z.infer<typeof frozenAppOperationSchema>;
