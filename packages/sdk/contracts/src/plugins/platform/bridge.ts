/**
 * [INPUT]: Unified entities, manifest and Zod.
 * [OUTPUT]: Renderer channels, mode snapshots, typed platform actions and exact-activation unified Surface descriptors.
 * [POS]: Stable main/preload/Web boundary; host owns source Projects and immutable activation.
 */
import { z } from "zod";
import type { PluginSurfaceDescriptor } from "../surface/native";
import { pluginDigestSchema, pluginIdentitySchema, pluginModeSelectionSchema } from "./selection/mode";
export { pluginModeSelectionSchema } from "./selection/mode";
import type { UnifiedPluginCatalogItem, UnifiedPluginCatalogPage, UnifiedPluginListQuery, UnifiedPluginRevision } from "./entities";
export { PLUGIN_PLATFORM_CHANNEL } from "./bridge/channels";
export type PluginModeSelection = z.infer<typeof pluginModeSelectionSchema>;
export const unifiedPluginInstallInputSchema = z.object({
  directory: z.string().min(1).max(32768), trust: z.literal(true).optional(), expectedManifestDigest: pluginDigestSchema.optional(),
}).strict();
export const unifiedPluginRestoreInputSchema = z.object({
  pluginId: pluginIdentitySchema, revisionId: pluginDigestSchema, sourceOnly: z.boolean().optional(),
}).strict();
export const pluginPrepareAuthoringInputSchema = z.object({
  operationId: pluginIdentitySchema, kind: z.enum(["new-plugin", "plugin"]), pluginId: pluginIdentitySchema.optional(),
  copy: z.boolean().optional(), instanceId: pluginIdentitySchema.optional(), name: z.string().min(1).max(160).optional(),
}).strict();
export type PluginPrepareAuthoringInput = z.infer<typeof pluginPrepareAuthoringInputSchema>;
export type PluginPrepareAuthoringResult = Readonly<{ pluginId: string; projectId: string; workspacePath: string; workspacePrecondition: { kind: "project"; projectId: string; membershipRevision: number } }>;
export type UnifiedPluginInstallInput = z.infer<typeof unifiedPluginInstallInputSchema>;
export type UnifiedPluginRestoreInput = z.infer<typeof unifiedPluginRestoreInputSchema>;
export type UnifiedPluginMode = PluginModeSelection & { pluginId: string; ready: boolean; unavailableReason?: string };
export type UnifiedPluginHostImpact = Readonly<{ revision: number; digest: string }>;
export type UnifiedPluginSurfaceDescriptor = PluginSurfaceDescriptor & Readonly<{ activationId: string }>;
export type UnifiedPluginBridge = import("./delivery").PluginPackageDeliveryBridge & Readonly<{
  list(query?: UnifiedPluginListQuery): Promise<UnifiedPluginCatalogPage>;
  get(pluginId: string): Promise<UnifiedPluginCatalogItem | null>;
  install(input: UnifiedPluginInstallInput): Promise<UnifiedPluginCatalogItem>;
  inspect(input: { directory: string }): Promise<{ manifest: import("./manifest").UnifiedPluginManifest; requiresTrust: boolean; manifestDigest: string }>;
  openSurface(input: { pluginId: string; contributionId: string; instanceId?: string }): Promise<UnifiedPluginSurfaceDescriptor>;
  call(input: { leaseId: string; method: string; input: unknown }): Promise<unknown>;
  releaseSurface(input: { leaseId: string }): Promise<void>;
  setEnabled(input: { pluginId: string; enabled: boolean; hostImpact?: UnifiedPluginHostImpact }): Promise<UnifiedPluginCatalogItem>;
  revisions(pluginId: string): Promise<UnifiedPluginRevision[]>;
  restore(input: UnifiedPluginRestoreInput): Promise<UnifiedPluginCatalogItem>;
  remove(input: { pluginId: string; deleteData?: boolean; hostImpact?: UnifiedPluginHostImpact }): Promise<void>;
  modes(): Promise<UnifiedPluginMode[]>;
  openFolder(input: { pluginId: string }): Promise<void>;
  prepareAuthoring(input: PluginPrepareAuthoringInput): Promise<PluginPrepareAuthoringResult>;
  onChanged(listener: (event: { revision: number }) => void): () => void;
}>;
