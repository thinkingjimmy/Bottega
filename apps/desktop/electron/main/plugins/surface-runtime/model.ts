/**
 * [INPUT]: Depends on strict plugin manifests, shared remote catalog limits and compiled GUI digest/receipt contracts.
 * [OUTPUT]: Provides at most 64 authored plugin owners, manual Dock candidates, bounded generation retention pins with optional account custody, source provenance and runtime authority ports.
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
export const generationCustodyScopeSchema = z.object({accountId:z.string().min(1).max(256),installationId:z.string().min(1).max(256)}).strict();
export type GenerationCustodyScope = z.infer<typeof generationCustodyScopeSchema>;
const digests = z.object({manifestDigest:digest,sourcePackageDigest:digest,contentDigest:digest,buildReceiptDigest:digest}).strict();
const file = z.object({path:z.string().min(1).max(1024).refine(path=>!path.startsWith("/") && !path.includes("\\") && path.split("/").every(part=>part && part!=="." && part!=="..")),bytes:z.number().int().nonnegative(),sha256:digest}).strict();
export const generationSchema = z.object({generationId,createdAt:z.number().int().nonnegative(),manifest:pluginGuiManifestSchema,digests,files:z.array(file).max(512),available:z.boolean()}).strict();
export const recordSchema = z.object({pluginId:id,origin:z.enum(["local","official"]).default("local"),ownerChatId:z.string().min(1).max(160),sourceRoot:z.string().min(1).max(32768),enabled:z.boolean(),authoringManifest:pluginGuiManifestSchema.nullable().default(null),
 activeGenerationId:generationId.nullable(),candidateGenerationId:generationId.nullable().default(null),previousGenerationId:generationId.nullable(),generations:z.array(generationSchema).max(256),
 retentionPins:z.array(z.object({id:z.string().regex(/^[A-Za-z0-9_-]{8,128}$/),generationId,scope:generationCustodyScopeSchema.optional()}).strict()).max(128).default([]),
 lastActivation:z.object({operationId:z.string().regex(/^[A-Za-z0-9_-]{8,128}$/),generationId,expectedPrevious:generationId.nullable()}).strict().nullable().default(null),
 error:z.string().max(2048).nullable(),revision:z.number().int().nonnegative()}).strict();
export const runtimeFileSchema = z.object({schemaVersion:z.literal(1),plugins:z.array(recordSchema).max(REMOTE_PLUGIN_CATALOG_LIMITS.entries,`Plugin catalog capacity exceeds ${REMOTE_PLUGIN_CATALOG_LIMITS.entries} entries`),quarantined:z.array(recordSchema).max(128).default([])}).strict().superRefine((value,context)=>{
 if(new Set(value.plugins.map(plugin=>plugin.pluginId)).size!==value.plugins.length) context.addIssue({code:"custom",message:"Duplicate plugin identity"});
 for(const plugin of value.plugins) {
  const generations = new Set(plugin.generations.map(generation=>generation.generationId));
  if(generations.size !== plugin.generations.length || plugin.generations.some(generation=>generation.manifest.id!==plugin.pluginId)) context.addIssue({code:"custom",message:"Invalid generation identity"});
  if(plugin.activeGenerationId && !plugin.generations.some(generation=>generation.generationId===plugin.activeGenerationId && generation.available)) context.addIssue({code:"custom",message:"Active generation is unavailable"});
  if(plugin.candidateGenerationId && !plugin.generations.some(generation=>generation.generationId===plugin.candidateGenerationId && generation.available && 'dock' in generation.manifest)) context.addIssue({code:'custom',message:'Dock candidate is unavailable'});
  if(new Set(plugin.retentionPins.map(pin=>pin.id)).size!==plugin.retentionPins.length||plugin.retentionPins.some(pin=>!plugin.generations.some(generation=>generation.generationId===pin.generationId&&generation.available)))context.addIssue({code:'custom',message:'Invalid retained generation pin'});
  if(plugin.lastActivation&&plugin.lastActivation.generationId!==plugin.activeGenerationId)context.addIssue({code:'custom',message:'Activation receipt does not match the selected generation'});
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
