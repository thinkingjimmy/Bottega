/**
 * [INPUT]: Current authenticated business headers, the R-26 manifest/head contracts and the ciphertext file descriptor.
 * [OUTPUT]: surfaceFunctions: staged publication, mark, reader heads and owner-only retained-generation receipts for verified rollback.
 * [POS]: Public R-26 function registry shared by the service, the desktop publisher, Cloud Web and contract audits.
 */
import { z } from "zod";
import { encryptedBusinessHeaderSchema as header } from "../spaces";
import { blobDescriptorSchema } from "../blobs";
import { ciphertextFileDescriptorSchema } from "../blobs/encrypted/model";
import { APP_SURFACE_LIMITS, appSurfaceHeadSchema } from "./manifest";

const appId = z.string().regex(/^[a-z0-9]{10}$/);
const generationId = z.string().regex(/^[a-z0-9]{10}-g[1-9]\d{0,8}-[a-f0-9]{12}(?:-[a-z0-9_-]{1,80})?$/);
const revision = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const app = header.extend({ appId }).strict();
const generation = app.extend({ generationId }).strict();
/** What the owner stages before uploading: counts and the manifest's plaintext descriptor (hash and size only; its body stays encrypted). */
export const appSurfaceGenerationSchema = z.object({
  appId, generationId, artifactDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/), layout: z.literal("compiled-v3"),
  fileCount: z.number().int().min(1).max(APP_SURFACE_LIMITS.files), byteSize: z.number().int().min(0).max(APP_SURFACE_LIMITS.totalBytes),
  manifest: blobDescriptorSchema.extend({ mime: z.literal("application/json"), bytes: z.number().int().min(1).max(APP_SURFACE_LIMITS.manifestBytes) }).strict(),
}).strict().refine(value => value.generationId.startsWith(value.appId + "-g"));
export const appSurfaceStagingSchema = z.object({ generationId, attached: z.number().int().min(0), state: z.enum(["preparing", "ready", "deleting"]) }).strict();
import { pluginSurfaceFunctions } from "./plugin/functions";
export const surfaceFunctions = {
  ...pluginSurfaceFunctions,
  "surfaces/generations:prepare": { kind: "mutation", args: header.extend({ generation: appSurfaceGenerationSchema }).strict(), result: appSurfaceStagingSchema },
  "surfaces/generations:attach": { kind: "mutation", args: generation.extend({ ordinal: z.number().int().min(0).max(APP_SURFACE_LIMITS.files),
    file: ciphertextFileDescriptorSchema }).strict(), result: z.null() },
  "surfaces/generations:commit": { kind: "mutation", args: generation.extend({ expectedRevision: revision }).strict(), result: appSurfaceHeadSchema },
  "surfaces/generations:mark": { kind: "mutation", args: app.extend({ expectedRevision: revision, state: z.enum(["unsupported", "retired"]) }).strict(),
    result: appSurfaceHeadSchema },
  "surfaces/generations:head": { kind: "query", args: app, result: appSurfaceHeadSchema.nullable() },
  "surfaces/generations:retained": { kind: "query", args: generation, result: appSurfaceHeadSchema.nullable() },
} as const;
