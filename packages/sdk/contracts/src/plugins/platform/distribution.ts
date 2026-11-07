/**
 * [INPUT]: Zod, canonical hashing and unified manifests.
 * [OUTPUT]: Full immutable plugin distribution validation and content-derived revision identity.
 * [POS]: Shared sender/receiver contract; accepted packages never depend on a source computer's node_modules.
 */
import { z } from "zod";
import { hashCanonical } from "../../core/canonical-json";
import { pluginDigestSchema, pluginIdentitySchema, pluginPackagePathSchema, unifiedPluginManifestSchema } from "./manifest";
export const UNIFIED_PLUGIN_PACKAGE_LIMITS = Object.freeze({
  files: 4096, fileBytes: 32 * 1024 * 1024, totalBytes: 256 * 1024 * 1024,
  catalogPageEntries: 100, catalogPageBytes: 256 * 1024,
});
export const unifiedPluginPackageFileSchema = z.object({
  path: pluginPackagePathSchema, bytes: z.number().int().nonnegative().max(UNIFIED_PLUGIN_PACKAGE_LIMITS.fileBytes),
  sha256: pluginDigestSchema, role: z.enum(["runtime", "dependency", "source", "metadata"]),
}).strict();
export const unifiedPluginTargetSchema = z.object({
  platform: z.literal("darwin"), arch: z.enum(["arm64", "x64"]), nodeMajor: z.number().int().min(24), sdkVersion: z.literal(1),
}).strict();
export const unifiedPluginDistributionSchema = z.object({
  format: z.literal("bottega-plugin/v1"), schemaVersion: z.literal(1),
  pluginId: pluginIdentitySchema, revisionId: pluginDigestSchema, manifest: unifiedPluginManifestSchema,
  sourceDigest: pluginDigestSchema, manifestDigest: pluginDigestSchema, lockDigest: pluginDigestSchema,
  dependencyDigest: pluginDigestSchema, toolchainDigest: pluginDigestSchema, contentDigest: pluginDigestSchema,
  target: unifiedPluginTargetSchema, dataContract: z.string().min(1).max(160),
  files: z.array(unifiedPluginPackageFileSchema).max(UNIFIED_PLUGIN_PACKAGE_LIMITS.files),
}).strict().superRefine((value, context) => {
  if (value.pluginId !== value.manifest.id) context.addIssue({ code: "custom", message: "Distribution plugin identity differs from manifest" });
  const paths = new Set<string>();
  let bytes = 0;
  for (const file of value.files) {
    const path = file.path.toLowerCase();
    if (paths.has(path)) context.addIssue({ code: "custom", message: "Duplicate package path" });
    paths.add(path); bytes += file.bytes;
  }
  if (bytes > UNIFIED_PLUGIN_PACKAGE_LIMITS.totalBytes) context.addIssue({ code: "custom", message: "Plugin package exceeds byte budget" });
  for (const contribution of value.manifest.contributions) {
    if ("hostViewId" in contribution && contribution.hostViewId || "hostAppId" in contribution && contribution.hostAppId || "hostPackageId" in contribution && contribution.hostPackageId) continue;
    const entry = contribution.kind === "tool" ? contribution.executor.kind === "process" ? contribution.executor.entry : undefined
      : "entry" in contribution ? contribution.entry : undefined;
    if (entry && !paths.has(entry.toLowerCase())) context.addIssue({ code: "custom", message: "Missing runtime entry: " + entry });
  }
});
export type UnifiedPluginDistribution = z.infer<typeof unifiedPluginDistributionSchema>;
export type UnifiedPluginPackageFile = z.infer<typeof unifiedPluginPackageFileSchema>;
export type UnifiedPluginTarget = z.infer<typeof unifiedPluginTargetSchema>;
export function unifiedPluginRevisionId(input: Pick<UnifiedPluginDistribution,
  "pluginId" | "sourceDigest" | "manifestDigest" | "lockDigest" | "dependencyDigest" | "toolchainDigest" | "contentDigest" | "target" | "dataContract">): string {
  const { pluginId, sourceDigest, manifestDigest, lockDigest, dependencyDigest, toolchainDigest, contentDigest, target, dataContract } = input;
  return "sha256:" + hashCanonical({ pluginId, sourceDigest, manifestDigest, lockDigest, dependencyDigest, toolchainDigest, contentDigest, target, dataContract });
}
