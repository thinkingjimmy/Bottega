/**
 * [INPUT]: Depends on strict plugin manifests, shared remote catalog limits and compiled GUI digest/receipt contracts.
 * [OUTPUT]: Provides at most 64 durable plugin owners, generation history, catalog admission, host-owned source provenance and runtime authority ports.
 * [POS]: Plugin surface runtime model; grants/settings remain host-owned and never come from an artifact.
 */
import { z } from "zod";
import { REMOTE_PLUGIN_CATALOG_LIMITS } from "@ai-chat/cloud-protocol/surfaces/plugin/catalog";
import { pluginGuiManifestSchema, type PluginGuiManifest } from "../../apps/gui-build/source/manifest";
import type { AppGuiBuildReceipt } from "../../../../shared/ipc/apps/apps-ipc";
import type { AppGuiBuildService } from "../../apps/gui-build/service";
import type { CompiledV3DigestSet } from "../../apps/gui-build/pipeline/seal";
const id = z.string().regex(/^[a-z][a-z0-9.-]{0,119}$/);
const generationId = z.string().regex(/^plugin-[a-f0-9-]{36}$/);
const digest = z.string().regex(/^sha256:[a-f0-9]{64}$/).transform(value => value as `sha256:${string}`);
const digests = z.object({manifestDigest:digest,sourcePackageDigest:digest,contentDigest:digest,buildReceiptDigest:digest}).strict();
const file = z.object({path:z.string().min(1).max(1024).refine(path=>!path.startsWith("/") && !path.includes("\\") && path.split("/").every(part=>part && part!=="." && part!=="..")),bytes:z.number().int().nonnegative(),sha256:digest}).strict();
export const generationSchema = z.object({generationId,createdAt:z.number().int().nonnegative(),manifest:pluginGuiManifestSchema,digests,files:z.array(file).max(512),available:z.boolean()}).strict();
export const recordSchema = z.object({pluginId:id,origin:z.enum(["local","official"]).default("local"),ownerChatId:z.string().min(1).max(160),sourceRoot:z.string().min(1).max(32768),enabled:z.boolean(),
 activeGenerationId:generationId.nullable(),previousGenerationId:generationId.nullable(),generations:z.array(generationSchema).max(256),
 error:z.string().max(2048).nullable(),revision:z.number().int().nonnegative()}).strict();
export const runtimeFileSchema = z.object({schemaVersion:z.literal(1),plugins:z.array(recordSchema).max(REMOTE_PLUGIN_CATALOG_LIMITS.entries,`Plugin catalog capacity exceeds ${REMOTE_PLUGIN_CATALOG_LIMITS.entries} entries`),quarantined:z.array(recordSchema).max(128).default([])}).strict().superRefine((value,context)=>{
 if(new Set(value.plugins.map(plugin=>plugin.pluginId)).size!==value.plugins.length) context.addIssue({code:"custom",message:"Duplicate plugin identity"});
 for(const plugin of value.plugins) {
  const generations = new Set(plugin.generations.map(generation=>generation.generationId));
  if(generations.size !== plugin.generations.length || plugin.generations.some(generation=>generation.manifest.id!==plugin.pluginId)) context.addIssue({code:"custom",message:"Invalid generation identity"});
  if(plugin.activeGenerationId && !plugin.generations.some(generation=>generation.generationId===plugin.activeGenerationId && generation.available)) context.addIssue({code:"custom",message:"Active generation is unavailable"});
 }
});
export type PluginGeneration = z.infer<typeof generationSchema>;
export type PluginRuntimeRecord = z.infer<typeof recordSchema>;
export type PluginRuntimeAuthorization = Readonly<{pluginId:string;generationId:string;manifest:PluginGuiManifest;previousManifest:PluginGuiManifest|null;ownerChatId:string;reason:"install"|"rebuild"|"activate"|"serve"}>;
export type PluginRuntimeOptions = Readonly<{
 compiler:Pick<AppGuiBuildService,"prepare">;
 /** Only the main-owned seed composition supplies this canonical source authority. */
 officialSourceRoot?():Promise<string>;
 authorize(input:PluginRuntimeAuthorization):Promise<void>;
 /** Production composition checks the whole prospective directory before any candidate can compile or activate. */
 admit?(manifest:PluginGuiManifest):void;
 watchIntervalMs?:number;
 /** Failure injection for the integration harness; production uses the four-digest verifier. */
 verify?(root:string,expected:CompiledV3DigestSet):Promise<unknown>;
 artifactBudgetBytes?:number;
}>;
export type PluginRuntimeFiles = readonly AppGuiBuildReceipt["files"][number][];
