/**
 * [INPUT]: Zod and unified manifest identity schemas.
 * [OUTPUT]: Directory, installation, source/Chat links, instance, revision and activation records, including official Widget archive receipts; bounded catalog summaries and exact full-detail live activation/readiness and source writer waits remain derived state.
 * [POS]: Serializable ownership model; uninstall and data deletion are separate operations.
 */
import { z } from "zod";
import { pluginDigestSchema, pluginIdentitySchema, pluginSourceSchema, unifiedPluginManifestSchema } from "./manifest";
const absolutePath = z.string().min(1).max(32768).refine(value => value.startsWith("/") && !value.includes("\0"));
const time = z.number().int().nonnegative();
export const unifiedPluginDirectoryRecordSchema = z.object({
  pluginId: pluginIdentitySchema, packageDirectory: absolutePath, sourceDirectory: absolutePath.optional(),
  registeredAt: time, missing: z.boolean().default(false),
}).strict();
export const unifiedPluginInstallationSchema = z.object({
  pluginId: pluginIdentitySchema, installedAt: time, enabled: z.boolean(),
  origin: z.enum(["official", "authored", "external", "copy"]), trustAcceptedAt: time.optional(),
  acceptedRevision: pluginDigestSchema.optional(), availableRevision: pluginDigestSchema.optional(),
  ownerDeviceId: z.string().min(1).max(256).optional(),
}).strict();
export const unifiedPluginSourceProjectSchema = z.object({
  pluginId: pluginIdentitySchema, sourceDirectory: absolutePath, projectId: pluginIdentitySchema.optional(),
  chatIds: z.array(pluginIdentitySchema).default([]), createdAt: time,
}).strict().superRefine((value, context) => {
  if (new Set(value.chatIds).size !== value.chatIds.length) context.addIssue({ code: "custom", message: "Duplicate authoring Chat link" });
});
export const unifiedPluginInstanceSchema = z.object({
  id: pluginIdentitySchema, pluginId: pluginIdentitySchema, contributionId: pluginIdentitySchema,
  scope: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("plugin") }).strict(),
    z.object({ kind: z.literal("project"), projectId: pluginIdentitySchema }).strict(),
    z.object({ kind: z.literal("instance"), instanceId: pluginIdentitySchema }).strict(),
  ]),
  configuration: z.record(z.string(), z.unknown()), createdAt: time,
}).strict();
export const unifiedPluginRevisionSchema = z.object({
  pluginId: pluginIdentitySchema, revisionId: pluginDigestSchema, sourceVersion: z.number().int().nonnegative(),
  createdAt: time, rootDirectory: absolutePath, manifest: unifiedPluginManifestSchema,
  packageDigest: pluginDigestSchema, dataContract: z.string().min(1).max(160), valid: z.boolean(),
  incompatibleReason: z.string().max(2048).optional(),
  officialWidget: z.union([
    z.object({ publisherId: z.literal("bottega"), archiveSha256: pluginDigestSchema }).strict(),
    z.object({ publisherId: z.literal("bottega"), bundleDigest: pluginDigestSchema }).strict(),
  ]).optional(),
}).strict().superRefine((value, context) => {
  if (value.manifest.id !== value.pluginId) context.addIssue({ code: "custom", message: "Revision plugin identity differs from manifest" });
});
export const pluginReadinessSchema = z.object({
  contributionId: pluginIdentitySchema, kind: z.enum(["page", "widget", "composer", "tool", "service", "mode"]),
  ready: z.boolean(), error: z.string().max(2048).optional(),
}).strict();
export const unifiedPluginActivationRecordSchema = z.object({
  pluginId: pluginIdentitySchema, activationId: pluginIdentitySchema, revisionId: pluginDigestSchema,
  previousRevision: pluginDigestSchema.nullable(), sourceVersion: z.number().int().nonnegative(),
  activatedAt: time, sequence: z.number().int().positive(),
  readiness: z.array(pluginReadinessSchema).max(1024),
}).strict();
export const unifiedPluginStatusSchema = z.enum([
  "installed", "building", "preparing", "ready", "disabled", "failed", "draining", "cleanup-failed", "missing-source", "unavailable",
]);
export const pluginSafeModeSchema = z.object({
  pluginId: pluginIdentitySchema, revisionId: pluginDigestSchema.optional(), reason: z.string().min(1).max(2048),
  detectedAt: time, repair: z.object({ pluginId: pluginIdentitySchema, action: z.literal("edit-or-restore") }).strict(),
}).strict();
export const unifiedPluginCatalogItemSchema = z.object({
  manifest: unifiedPluginManifestSchema, installation: unifiedPluginInstallationSchema,
  directory: unifiedPluginDirectoryRecordSchema, sourceProject: unifiedPluginSourceProjectSchema.optional(),
  status: unifiedPluginStatusSchema, runtimeReady: z.boolean().default(false), activationId: pluginIdentitySchema.optional(), activeRevision: pluginDigestSchema.optional(),
  availableRevision: pluginDigestSchema.optional(), acceptedRevision: pluginDigestSchema.optional(),
  instanceCount: z.number().int().nonnegative(), error: z.string().max(2048).optional(), warnings: z.array(z.string().max(2048)).max(32).default([]),
  authoringWaiters: z.array(z.string().min(1).max(128)).max(1024).optional(),
}).strict();
export const unifiedPluginCatalogSummarySchema = unifiedPluginCatalogItemSchema.pick({
  installation: true, status: true, runtimeReady: true, activeRevision: true, availableRevision: true,
  acceptedRevision: true, instanceCount: true, error: true,
}).extend({
  manifest: z.object({
    id: pluginIdentitySchema, name: z.string().min(1).max(160), version: z.string().min(1).max(128),
    description: z.string().max(1024).optional(), essential: z.boolean(),
    source: z.object({
      kind: pluginSourceSchema.shape.kind, format: pluginSourceSchema.shape.format, editable: z.boolean(), canCopy: z.boolean(),
      installIdentity: pluginSourceSchema.shape.installIdentity, externalVersion: pluginSourceSchema.shape.externalVersion,
    }).strict(),
    dependencies: z.array(z.object({ pluginId: pluginIdentitySchema }).strict()).max(256),
    contributionKinds: z.array(pluginReadinessSchema.shape.kind).max(6), contributionCount: z.number().int().min(0).max(1024),
  }).strict(),
  directory: unifiedPluginDirectoryRecordSchema.pick({ missing: true }),
  sourceProject: z.object({ projectId: pluginIdentitySchema.optional() }).strict().optional(),
});
export const unifiedPluginListQuerySchema = z.object({
  cursor: z.string().regex(/^\d+:\d+$/).max(64).optional(),
  limit: z.number().int().min(1).max(100).default(50), search: z.string().max(256).optional(),
  scope: z.literal("settings").optional(),
}).strict();
export const unifiedPluginCatalogPageSchema = z.object({
  items: z.array(unifiedPluginCatalogSummarySchema).max(100), total: z.number().int().nonnegative(),
  nextCursor: z.string().regex(/^\d+:\d+$/).optional(), revision: z.number().int().nonnegative(),
  safeMode: pluginSafeModeSchema.optional(),
}).strict();
export type UnifiedPluginDirectoryRecord = z.infer<typeof unifiedPluginDirectoryRecordSchema>;
export type UnifiedPluginInstallation = z.infer<typeof unifiedPluginInstallationSchema>;
export type UnifiedPluginSourceProject = z.infer<typeof unifiedPluginSourceProjectSchema>;
export type UnifiedPluginInstance = z.infer<typeof unifiedPluginInstanceSchema>;
export type UnifiedPluginRevision = z.infer<typeof unifiedPluginRevisionSchema>;
export type UnifiedPluginActivationRecord = z.infer<typeof unifiedPluginActivationRecordSchema>;
export type UnifiedPluginStatus = z.infer<typeof unifiedPluginStatusSchema>;
export type UnifiedPluginCatalogItem = z.infer<typeof unifiedPluginCatalogItemSchema>;
export type UnifiedPluginCatalogSummary = z.infer<typeof unifiedPluginCatalogSummarySchema>;
export type UnifiedPluginCatalogPage = z.infer<typeof unifiedPluginCatalogPageSchema>;
export type UnifiedPluginListQuery = z.input<typeof unifiedPluginListQuerySchema>;
export type PluginReadiness = z.infer<typeof pluginReadinessSchema>;
export type PluginSafeMode = z.infer<typeof pluginSafeModeSchema>;
