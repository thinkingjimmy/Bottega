/**
 * [INPUT]: Zod, immutable encrypted files and shared Surface digests and budgets.
 * [OUTPUT]: Plugin subject, manifest/head validation, operation declarations and owner identity.
 * [POS]: Plugin Surface identity boundary; plugins receive no App ID or App grant.
 */
import { z } from "zod";
import { PLUGIN_SURFACE_OPERATIONS } from "@bottega/contracts/plugins/surface/contract";
import { encryptedFileDescriptorSchema } from "../../blobs/encrypted/model";
import { hashCanonical, canonicalJson } from "../../encryption/encoding";
import { artifactRelativePathSchema } from "../../turns/text/artifact-reference";
import { APP_SURFACE_LIMITS, APP_SURFACE_FILE_MIME, appSurfaceTreeDigest } from "../manifest";
const id = z.string().regex(/^[a-zA-Z0-9_.:-]{1,128}$/);
const digest = z.string().regex(/^sha256:[a-f0-9]{64}$/);
export const pluginSurfaceSubjectSchema = z.object({ kind: z.literal("plugin"), id, ownerDeviceId: id }).strict();
export type PluginSurfaceSubject = z.infer<typeof pluginSurfaceSubjectSchema>;
export const pluginSurfaceOwnerId = (subject: PluginSurfaceSubject) => hashCanonical(pluginSurfaceSubjectSchema.parse(subject));
export const PLUGIN_OPERATIONS = PLUGIN_SURFACE_OPERATIONS;
export const pluginSurfaceDefinitionSchema = z.object({ operations: z.array(z.enum(PLUGIN_OPERATIONS)).max(PLUGIN_OPERATIONS.length),
  sourceFormat: z.object({ id, version: z.number().int().positive(), readableVersions: z.array(z.number().int().positive()).min(1).max(64) }).strict() }).strict();
export type PluginSurfaceDefinition = z.infer<typeof pluginSurfaceDefinitionSchema>;
export const pluginSurfaceManifestSchema = z.object({ schema: z.literal("bottega.plugin-surface/v1"), subject: pluginSurfaceSubjectSchema,
  generationId: id, artifactDigest: digest, entry: artifactRelativePathSchema, layout: z.literal("compiled-v3"), plugin: pluginSurfaceDefinitionSchema,
  files: z.array(z.object({ path: artifactRelativePathSchema, mime: z.string().min(1).max(128), bytes: z.number().int().nonnegative().max(APP_SURFACE_LIMITS.fileBytes), sha256: digest,
    file: encryptedFileDescriptorSchema }).strict()).min(1).max(APP_SURFACE_LIMITS.files),
}).strict().superRefine((manifest, ctx) => {
  const fail = (message: string) => ctx.addIssue({ code: "custom", message });
  if (new Set(manifest.files.map(file => file.path)).size !== manifest.files.length || !manifest.files.some(file => file.path === manifest.entry)) fail("surface-path-invalid");
  if (new Set(manifest.plugin.operations).size !== manifest.plugin.operations.length) fail("surface-duplicate-operation");
  if (manifest.files.reduce((sum, file) => sum + file.bytes, 0) > APP_SURFACE_LIMITS.totalBytes) fail("surface-budget");
  for (const file of manifest.files) if (file.file.encryption.owner.kind !== "plugin" || file.file.encryption.owner.id !== pluginSurfaceOwnerId(manifest.subject) ||
    file.file.encryption.ownerGeneration !== manifest.generationId || file.file.encryption.domain !== undefined || file.file.bytes !== file.bytes ||
    `sha256:${file.file.sha256}` !== file.sha256 || file.file.mime !== APP_SURFACE_FILE_MIME) fail("surface-file-binding");
  if (appSurfaceTreeDigest(manifest.files) !== manifest.artifactDigest) fail("surface-digest");
});
export type PluginSurfaceManifest = z.infer<typeof pluginSurfaceManifestSchema>;
const base = { subject: pluginSurfaceSubjectSchema, revision: z.number().int().nonnegative(), updatedAt: z.number().int().nonnegative() };
export const pluginSurfaceHeadSchema = z.discriminatedUnion("state", [
  z.object({ ...base, state: z.literal("published"), generationId: id, artifactDigest: digest, fileCount: z.number().int().positive().max(APP_SURFACE_LIMITS.files),
    byteSize: z.number().int().nonnegative().max(APP_SURFACE_LIMITS.totalBytes), layout: z.literal("compiled-v3"), manifest: encryptedFileDescriptorSchema }).strict().refine(head =>
    head.manifest.encryption.domain === "plugin-surface-generation" && head.manifest.encryption.owner.kind === "plugin" && head.manifest.encryption.owner.id === pluginSurfaceOwnerId(head.subject) &&
    head.manifest.encryption.ownerGeneration === head.generationId && head.manifest.bytes <= APP_SURFACE_LIMITS.manifestBytes),
  z.object({ ...base, state: z.literal("retired") }).strict(),
]);
export type PluginSurfaceHead = z.infer<typeof pluginSurfaceHeadSchema>;
export function encodePluginSurfaceManifest(manifest: PluginSurfaceManifest) {
  const bytes = new TextEncoder().encode(canonicalJson(pluginSurfaceManifestSchema.parse(manifest)));
  if (bytes.byteLength > APP_SURFACE_LIMITS.manifestBytes) throw new Error("surface-manifest-too-large");
  return bytes;
}
export function checkPluginSurfaceManifest(head: Extract<PluginSurfaceHead, { state: "published" }>, bytes: Uint8Array) {
  const manifest = pluginSurfaceManifestSchema.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
  if (canonicalJson(manifest.subject) !== canonicalJson(head.subject) || manifest.generationId !== head.generationId || manifest.artifactDigest !== head.artifactDigest ||
    manifest.files.length !== head.fileCount || manifest.files.reduce((sum, file) => sum + file.bytes, 0) !== head.byteSize) throw new Error("surface-head-mismatch");
  return manifest;
}
