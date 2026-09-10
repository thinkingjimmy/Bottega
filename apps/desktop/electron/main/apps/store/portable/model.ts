/**
 * [INPUT]: Depends on logical blob identities, Project portable fields and the existing migration declaration.
 * [OUTPUT]: Provides App descriptors, fixed-ID admission intents and safely blocked package candidates.
 * [POS]: The portable half of apps.json; installed AppRecord authority remains separate.
 */
import { z } from "zod";
import { logicalBlobSchema, storageHashSchema as hash, storageIdSchema as id, storageRevisionSchema as rev, syncScopeSchema } from "../../../../../shared/local-storage/contracts";
import { appBaseDataMigrationFileSchema } from "../../../../../shared/app-data-migration";
const appId = z.string().regex(/^[a-z0-9]{10}$/);
export const appDescriptorSchema = z.object({
  appId, projectId: id, baseId: id, name: z.string().min(1).max(100),
  packageRevision: rev, manifestDigest: hash, sourcePackageDigest: hash, sourceBlob: logicalBlobSchema,
  cloudRevision: rev, createdAt: rev, updatedAt: rev,
}).strict();
export type AppDescriptor = z.infer<typeof appDescriptorSchema>;
export const portableAppEntrySchema = z.object({
  scope: syncScopeSchema.nullable(), descriptor: appDescriptorSchema,
  installation: z.enum(["not-installed", "preparing", "installed", "failed"]),
  installedGenerationId: id.nullable(), tombstoned: z.boolean(),
}).strict();
export const appAdmissionIntentSchema = z.object({
  operationId: id, payloadHash: hash, scope: syncScopeSchema, descriptor: appDescriptorSchema,
  baseExists: z.boolean(), projectExists: z.boolean(),
  completed: z.array(z.enum(["project", "base", "descriptor"])).max(3),
  state: z.enum(["pending", "complete"]),
}).strict();
export const appPackageCandidateSchema = z.object({
  operationId: id, appId, descriptor: appDescriptorSchema, expectedPackageRevision: rev,
  migration: appBaseDataMigrationFileSchema.nullable(),
  planHash: hash.nullable(), baselineHash: hash.nullable(),
  state: z.enum(["pending", "blocked", "confirmed", "committed"]),
  reason: z.enum(["atomic-migration-unavailable", "awaiting-receipt"]).nullable(),
  receipt: z.object({ operationId: id, appId, expectedPackageRevision: rev, packageRevision: rev,
    manifestDigest: hash, sourcePackageDigest: hash, cloudRevision: rev }).strict().nullable(),
}).strict();
export const appPortableCatalogSchema = z.object({
  version: z.literal(1), entries: z.array(portableAppEntrySchema).max(1000),
  admissions: z.array(appAdmissionIntentSchema).max(4096), candidates: z.array(appPackageCandidateSchema).max(4096),
}).strict().superRefine((catalog, ctx) => {
  for (const field of ["appId", "projectId", "baseId"] as const) {
    if (new Set(catalog.entries.map(entry => entry.descriptor[field])).size !== catalog.entries.length) ctx.addIssue({ code: "custom", message: `Duplicate App association: ${field}` });
  }
  if (new Set(catalog.admissions.map(intent => intent.operationId)).size !== catalog.admissions.length) ctx.addIssue({ code: "custom", message: "Duplicate App admission identity" });
});
export type AppPortableCatalog = z.infer<typeof appPortableCatalogSchema>;
export type AppAdmissionIntent = z.infer<typeof appAdmissionIntentSchema>;
export const emptyAppPortableCatalog = (): AppPortableCatalog => ({ version: 1, entries: [], admissions: [], candidates: [] });
