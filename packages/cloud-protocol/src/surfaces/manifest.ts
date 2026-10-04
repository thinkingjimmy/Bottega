/**
 * [INPUT]: zod, the encrypted file descriptor, the surface frame limits and the protocol canonical encoding.
 * [OUTPUT]: APP_SURFACE_LIMITS, APP_SURFACE_CAPABILITIES, the R-26 manifest and head schemas, appSurfaceTreeDigest and encodeAppSurfaceManifest.
 * [POS]: The App surface manifest contract (TASK-22 S3): what the owner desktop seals per generation and what the Web verifies before mounting.
 */
import { z } from "zod";
import { encryptedFileDescriptorSchema } from "../blobs/encrypted/model";
import { canonicalJson, hashCanonical } from "../encryption/encoding";
import { artifactRelativePathSchema } from "../turns/text/artifact-reference";
import { SURFACE_LIMITS } from "./policy";

export const APP_SURFACE_LIMITS = Object.freeze({ ...SURFACE_LIMITS, manifestBytes: 1_048_576, hostActions: 16 });
/** The desktop's BaseGuiCapability set; the manifest carries what the owner granted, never what the App requested. */
export const APP_SURFACE_CAPABILITIES = ["row-insert", "row-patch", "row-delete", "attachment-read", "workspace-read"] as const;
const TREE_DOMAIN = "bottega.app-gui-runtime/v1";
/** GUI files are sealed as opaque bytes; the manifest carries the type each one is served with. */
export const APP_SURFACE_FILE_MIME = "application/octet-stream";
const encoder = new TextEncoder();
const appId = z.string().regex(/^[a-z0-9]{10}$/);
const generationId = z.string().regex(/^[a-z0-9]{10}-g[1-9]\d{0,8}-[a-f0-9]{12}(?:-[a-z0-9_-]{1,80})?$/);
const digest = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const bytesCompare = (left: string, right: string) => {
  const a = encoder.encode(left), b = encoder.encode(right);
  for (let index = 0; index < Math.min(a.length, b.length); index++) if (a[index] !== b[index]) return a[index]! - b[index]!;
  return a.length - b.length;
};
/** The desktop receipt's runtime tree digest: canonical `{ domain, files }` with files in UTF-8 byte order of their paths. */
export function appSurfaceTreeDigest(files: readonly { path: string; bytes: number; sha256: string }[]): `sha256:${string}` {
  const ordered = [...files].sort((left, right) => bytesCompare(left.path, right.path)).map(({ path, bytes, sha256 }) => ({ path, bytes, sha256 }));
  return `sha256:${hashCanonical({ domain: TREE_DOMAIN, files: ordered })}`;
}
const file = z.object({
  path: artifactRelativePathSchema, mime: z.string().min(1).max(128), bytes: z.number().int().min(0).max(APP_SURFACE_LIMITS.fileBytes), sha256: digest,
  file: encryptedFileDescriptorSchema,
}).strict();
export const appSurfaceManifestSchema = z.object({
  schema: z.literal("bottega.app-surface/v1"), appId, generationId, artifactDigest: digest, entry: artifactRelativePathSchema, layout: z.literal("compiled-v3"),
  sdkSlice: z.object({ data: z.boolean(), preferences: z.boolean(), workspace: z.boolean() }).strict(),
  grantedCapabilities: z.array(z.enum(APP_SURFACE_CAPABILITIES)).max(APP_SURFACE_CAPABILITIES.length),
  hostActions: z.array(z.string().regex(/^[a-z][a-z0-9.-]{0,63}$/)).max(APP_SURFACE_LIMITS.hostActions),
  files: z.array(file).min(1).max(APP_SURFACE_LIMITS.files),
}).strict().superRefine((manifest, context) => {
  const issue = (message: string) => context.addIssue({ code: "custom", message });
  if (!manifest.generationId.startsWith(manifest.appId + "-g")) issue("app-surface-generation-app");
  if (new Set(manifest.grantedCapabilities).size !== manifest.grantedCapabilities.length) issue("app-surface-duplicate-capability");
  if (new Set(manifest.hostActions).size !== manifest.hostActions.length) issue("app-surface-duplicate-host-action");
  const paths = new Set(manifest.files.map(item => item.path));
  if (paths.size !== manifest.files.length) issue("app-surface-duplicate-file");
  if (!paths.has(manifest.entry)) issue("app-surface-entry-missing");
  if (manifest.files.reduce((sum, item) => sum + item.bytes, 0) > APP_SURFACE_LIMITS.totalBytes) issue("app-surface-budget");
  for (const item of manifest.files) {
    const sealed = item.file.encryption;
    if (sealed.domain !== undefined || sealed.owner.kind !== "app" || sealed.owner.id !== manifest.appId || sealed.ownerGeneration !== manifest.generationId ||
      item.file.bytes !== item.bytes || `sha256:${item.file.sha256}` !== item.sha256 || item.file.mime !== APP_SURFACE_FILE_MIME) issue("app-surface-file-binding");
  }
  if (appSurfaceTreeDigest(manifest.files) !== manifest.artifactDigest) issue("app-surface-digest");
});
export type AppSurfaceManifest = z.infer<typeof appSurfaceManifestSchema>;
/** UTF-8 bytes of the canonical manifest; refused above the 1 MiB plaintext bound, the same check the server applies to the sealed size. */
export function encodeAppSurfaceManifest(manifest: AppSurfaceManifest, limit: number = APP_SURFACE_LIMITS.manifestBytes) {
  const bytes = encoder.encode(canonicalJson(appSurfaceManifestSchema.parse(manifest)));
  if (bytes.byteLength > limit) throw new Error("app-surface-manifest-too-large");
  return bytes;
}
const headBase = { appId, ownerDeviceId: z.string().min(1).max(128), revision: z.number().int().min(0), updatedAt: z.number().int().min(0) };
export const appSurfaceHeadSchema = z.discriminatedUnion("state", [
  z.object({ ...headBase, state: z.literal("published"), generationId, artifactDigest: digest, fileCount: z.number().int().min(1).max(APP_SURFACE_LIMITS.files),
    byteSize: z.number().int().min(0).max(APP_SURFACE_LIMITS.totalBytes), layout: z.literal("compiled-v3"), manifest: encryptedFileDescriptorSchema }).strict()
    .refine(head => head.generationId.startsWith(head.appId + "-g") && head.manifest.encryption.domain === "app-surface-generation" &&
      head.manifest.encryption.owner.kind === "app" && head.manifest.encryption.owner.id === head.appId &&
      head.manifest.encryption.ownerGeneration === head.generationId && head.manifest.bytes <= APP_SURFACE_LIMITS.manifestBytes),
  // A static (non-compiled) GUI publishes only this state: the Web shows "open on your computer".
  z.object({ ...headBase, state: z.literal("unsupported"), layout: z.literal("static-v2") }).strict(),
  // App deleted or GUI removed; kept as a tombstone so it never reads as "not found".
  z.object({ ...headBase, state: z.literal("retired") }).strict(),
]);
export type AppSurfaceHead = z.infer<typeof appSurfaceHeadSchema>;
