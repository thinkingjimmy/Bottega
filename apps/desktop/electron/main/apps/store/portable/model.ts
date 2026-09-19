/**
 * [INPUT]: Depends on logical blob identities, Project portable fields and the existing migration declaration.
 * [OUTPUT]: Provides metadata-first App descriptors, original installed publication baselines, fixed-ID admission and outbound custody.
 * [POS]: The portable half of apps.json; installed AppRecord authority remains separate.
 */
import { z } from "zod";
import { storageHashSchema as hash, storageIdSchema as id, storageRevisionSchema as rev, syncScopeSchema } from "../../../../../shared/local-storage/contracts";
import { appBaseDataMigrationFileSchema } from "../../../../../shared/app-data-migration";
import { appPublicationBaselineSchema, appPublicationSchema } from "./publication-model";
import { appDeletionSchema } from "@ai-chat/cloud-protocol/apps/model";
import { appDeletionRequestSchema } from "./deletion-model";
import { encryptedFileDescriptorSchema } from "@ai-chat/cloud-protocol/blobs/encrypted";
const appId = z.string().regex(/^[a-z0-9]{10}$/);
const descriptorFields = {
  appId, projectId: id, baseId: id, name: z.string().min(1).max(120),
  dataCoverage: z.enum(["base-only", "partial"]),
  cloudRevision: rev, createdAt: rev, updatedAt: rev,
};
export const publishedAppDescriptorSchema = z.object({ ...descriptorFields,
  packageRevision: rev.positive(), manifestDigest: hash, sourcePackageDigest: hash, sourceBlob: encryptedFileDescriptorSchema,
}).strict();
export const appDescriptorSchema = z.union([publishedAppDescriptorSchema, z.object({ ...descriptorFields,
  packageRevision: z.null(), manifestDigest: z.null(), sourcePackageDigest: z.null(), sourceBlob: z.null(),
}).strict()]);
export type AppDescriptor = z.infer<typeof appDescriptorSchema>;
export type PublishedAppDescriptor = z.infer<typeof publishedAppDescriptorSchema>;
export const portableAppEntrySchema = z.object({
  scope: syncScopeSchema.nullable(), descriptor: appDescriptorSchema,
  installation: z.enum(["not-installed", "preparing", "installed", "failed"]),
  installedGenerationId: id.nullable(), installedPackageRevision: rev.nullable(), tombstoned: z.boolean(),
  installedPublication: appPublicationBaselineSchema.nullable().default(null),
  deletion: appDeletionSchema.optional(),
}).strict().refine(entry => !entry.deletion || entry.tombstoned && entry.deletion.appId === entry.descriptor.appId &&
  entry.deletion.projectId === entry.descriptor.projectId && entry.deletion.baseId === entry.descriptor.baseId &&
  entry.deletion.revision === entry.descriptor.cloudRevision);
export const appAdmissionIntentSchema = z.object({
  operationId: id, payloadHash: hash, scope: syncScopeSchema, descriptor: appDescriptorSchema,
  baseExists: z.boolean(), projectExists: z.boolean(),
  completed: z.array(z.enum(["project", "base", "descriptor"])).max(3),
  state: z.enum(["pending", "complete"]),
}).strict();
export const appPackageCandidateSchema = z.object({
  operationId: id, appId, descriptor: publishedAppDescriptorSchema, expectedPackageRevision: rev,
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
  publications: z.array(appPublicationSchema).max(1000).default([]),
  deletions: z.array(appDeletionRequestSchema).max(4096).default([]),
}).strict().superRefine((catalog, ctx) => {
  for (const field of ["appId", "projectId", "baseId"] as const) {
    if (new Set(catalog.entries.map(entry => entry.descriptor[field])).size !== catalog.entries.length) ctx.addIssue({ code: "custom", message: `Duplicate App association: ${field}` });
  }
  if (new Set(catalog.admissions.map(intent => intent.operationId)).size !== catalog.admissions.length) ctx.addIssue({ code: "custom", message: "Duplicate App admission identity" });
  const publications = catalog.publications.filter(item => item.scope).map(item => JSON.stringify([item.scope, item.operation.appId]));
  if (new Set(publications).size !== publications.length) ctx.addIssue({ code: "custom", message: "Duplicate App publication identity" });
  if (new Set(catalog.deletions.map(item => item.operation.operationId)).size !== catalog.deletions.length) ctx.addIssue({ code: "custom", message: "Duplicate App deletion identity" });
});
export type AppPortableCatalog = z.infer<typeof appPortableCatalogSchema>;
export type AppAdmissionIntent = z.infer<typeof appAdmissionIntentSchema>;
export const emptyAppPortableCatalog = (): AppPortableCatalog => ({ version: 1, entries: [], admissions: [], candidates: [], publications: [], deletions: [] });
