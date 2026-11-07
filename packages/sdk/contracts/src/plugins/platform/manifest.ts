/**
 * [INPUT]: Zod and the contract-owned canonical Provider identity values.
 * [OUTPUT]: Unified manifests/contributions, explicit native Base/Web/Server source formats and privileged host-view declarations.
 * [POS]: Native package identity and declaration boundary; contains no runtime authority.
 */
import { z } from "zod";
import { BUILTIN_PROVIDER_IDS } from "../../model/provider-capabilities";
import { pluginIdentitySchema, pluginDigestSchema, pluginNativeRequirementsSchema, pluginToolSelectionSchema } from "./selection/mode";
export { pluginIdentitySchema, pluginDigestSchema, pluginNativeRequirementsSchema, pluginToolSelectionSchema } from "./selection/mode";

export const UNIFIED_PLUGIN_MANIFEST = "bottega.plugin.json" as const;
export const pluginPackagePathSchema = z.string().min(1).max(1024).refine(value =>
  value === value.normalize("NFC") && !value.includes("\\") && !value.includes("\0") &&
  !value.startsWith("/") && value.split("/").every(part => part && part !== "." && part !== ".."),
  "Package paths must be relative and cannot traverse directories");
const title = z.string().min(1).max(160);
const description = z.string().max(8192);
const jsonSchema = z.record(z.string(), z.unknown());
const contribution = { id: pluginIdentitySchema, name: title, description: description.optional() };
export const pluginPageContributionSchema = z.object({
  ...contribution, kind: z.literal("page"), entry: pluginPackagePathSchema, hostAppId: pluginIdentitySchema.optional(), hostViewId: z.enum(["workflow", "dock-settings"]).optional(),
  route: z.string().regex(/^\/[A-Za-z0-9/_-]*$/).max(256).optional(), slot: z.string().min(1).max(160),
  navigation: z.object({ label: title, icon: z.string().max(64).optional(), order: z.number().int().optional() }).strict().optional(),
}).strict();
export const pluginWidgetContributionSchema = z.object({
  ...contribution, kind: z.literal("widget"), entry: pluginPackagePathSchema, slot: z.string().min(1).max(160).optional(),
  settingsSchema: jsonSchema.optional(), customCard: z.boolean().optional(),
  summary: z.object({ method: z.string().min(1).max(128), refreshMs: z.number().int().min(15_000).max(3_600_000).optional(), timeoutMs: z.number().int().min(1).max(10_000).optional() }).strict().optional(),
}).strict();
export const pluginComposerContributionSchema = z.object({
  ...contribution, kind: z.literal("composer"), entry: pluginPackagePathSchema, hostViewId: z.literal("sketch-composer").optional(), slot: z.string().min(1).max(160),
}).strict();
export const pluginToolContributionSchema = z.object({
  ...contribution, description, kind: z.literal("tool"), inputSchema: jsonSchema, outputSchema: jsonSchema,
  executor: z.object({ kind: z.enum(["host", "process"]), entry: pluginPackagePathSchema, method: z.string().min(1).max(128) }).strict(),
  timeoutMs: z.number().int().min(1).max(600_000).default(30_000),
  access: z.enum(["read", "write"]).optional(), planAllowed: z.boolean().optional(),
  manualTurnOnly: z.boolean().optional(), exactIssued: z.boolean().optional(), workflowAllowed: z.boolean().optional(),
  backendAllowlist: z.array(z.string().min(1).max(128)).max(64).optional(), domain: z.string().min(1).max(128).optional(),
  resultBytes: z.number().int().positive().max(1_048_576).optional(),
  budget: z.object({ rateLimit: z.number().int().positive(), rateWindowMs: z.number().int().positive() }).strict().optional(),
}).strict();
export const pluginServiceContributionSchema = z.object({
  ...contribution, kind: z.literal("service"), entry: pluginPackagePathSchema, hostAppId: pluginIdentitySchema.optional(), hostPackageId: z.string().min(1).max(256).optional(),
  parallelSafe: z.boolean().default(false),
}).strict();
export const pluginModeContributionSchema = z.object({
  ...contribution, kind: z.literal("mode"), prompt: z.string().max(65_536),
  tools: pluginToolSelectionSchema, nativeRequirements: pluginNativeRequirementsSchema.optional(),
  strategy: jsonSchema.optional(), extends: z.string().min(1).max(256).optional(),
}).strict();
export const pluginContributionSchema = z.discriminatedUnion("kind", [
  pluginPageContributionSchema, pluginWidgetContributionSchema, pluginComposerContributionSchema,
  pluginToolContributionSchema, pluginServiceContributionSchema, pluginModeContributionSchema,
]);
export const pluginSourceSchema = z.object({
  kind: z.enum(["official", "authored", "external", "copy"]),
  format: z.enum(["bottega", BUILTIN_PROVIDER_IDS.claude, "mcp", "skill", "base-app", "web-app", "server-app", "host-package"]),
  editable: z.boolean(), url: z.string().url().max(4096).optional(),
  pluginId: pluginIdentitySchema.optional(), revision: pluginDigestSchema.optional(),
  installIdentity: z.string().min(1).max(256).optional(), externalVersion: z.string().min(1).max(128).optional(),
}).strict().superRefine((source, context) => {
  if (source.format !== "host-package" && (source.installIdentity || source.externalVersion)) context.addIssue({ code: "custom", message: "Installed package metadata requires the host-package adapter format" });
  if (source.format !== "bottega" && source.editable) context.addIssue({ code: "custom", message: "External formats cannot be edited through Chat" });
  if (source.kind === "copy" && !source.pluginId) context.addIssue({ code: "custom", message: "A personal copy requires its source plugin identity" });
});
export const pluginRuntimeRequirementsSchema = z.object({
  sdkVersion: z.literal(1).default(1), features: z.array(z.enum(["worker", "wasm"])).max(2).default([]),
  platforms: z.array(z.enum(["darwin"])).min(1).default(["darwin"]),
  runtimes: z.array(z.enum(["desktop", "web"])).min(1).default(["desktop"]),
  nodeMajor: z.number().int().min(24).optional(), hostContract: z.string().max(32).optional(),
}).strict();
export const pluginSlotDeclarationsSchema = z.object({
  declares: z.array(z.string().min(1).max(160)).max(256).default([]),
  injects: z.array(z.object({ slot: z.string().min(1).max(160), ownerPluginId: pluginIdentitySchema }).strict()).max(256).default([]),
}).strict();
export const unifiedPluginManifestSchema = z.object({
  schemaVersion: z.literal(1), id: pluginIdentitySchema, name: title,
  version: z.string().regex(/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/),
  description: description.optional(), providerAlias: z.string().regex(/^[a-z][a-z0-9_]{0,19}$/).optional(),
  source: pluginSourceSchema, requirements: pluginRuntimeRequirementsSchema.default({ sdkVersion: 1, features: [], platforms: ["darwin"], runtimes: ["desktop"] }),
  dependencies: z.array(z.object({ pluginId: pluginIdentitySchema, version: z.string().max(64).optional(),
    contributions: z.array(pluginIdentitySchema).max(256).optional() }).strict()).max(256).default([]),
  slots: pluginSlotDeclarationsSchema.default({ declares: [], injects: [] }),
  contributions: z.array(pluginContributionSchema).max(1024),
  dataContract: z.string().min(1).max(160).default("1"), essential: z.boolean().default(false),
}).strict().superRefine((manifest, context) => {
  for (const [label, values] of [
    ["contribution", manifest.contributions.map(value => value.id)],
    ["dependency", manifest.dependencies.map(value => value.pluginId)],
    ["slot", manifest.slots.declares],
  ] as const) {
    if (new Set(values).size !== values.length) context.addIssue({ code: "custom", message: "Duplicate " + label + " identity" });
  }
  if (manifest.dependencies.some(value => value.pluginId === manifest.id)) context.addIssue({ code: "custom", message: "A plugin cannot depend on itself" });
});
export type UnifiedPluginManifest = z.infer<typeof unifiedPluginManifestSchema>;
export type PluginContribution = z.infer<typeof pluginContributionSchema>;
export type PluginToolContribution = z.infer<typeof pluginToolContributionSchema>;
export type PluginServiceContribution = z.infer<typeof pluginServiceContributionSchema>;
export type PluginModeContribution = z.infer<typeof pluginModeContributionSchema>;
export type PluginPageContribution = z.infer<typeof pluginPageContributionSchema>;
export type PluginWidgetContribution = z.infer<typeof pluginWidgetContributionSchema>;
export type PluginNativeRequirements = z.infer<typeof pluginNativeRequirementsSchema>;
export type PluginToolSelection = z.infer<typeof pluginToolSelectionSchema>;
