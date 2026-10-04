/**
 * [INPUT]: Authenticated business headers, plugin identities and immutable file descriptors.
 * [OUTPUT]: Atomic plugin prepare/attach/commit/retire, reader heads and owner-only retained-generation receipts.
 * [POS]: Plugin publication registry over the shared encrypted blob channel.
 */
import { z } from "zod";
import { encryptedBusinessHeaderSchema } from "../../spaces";
import { blobDescriptorSchema } from "../../blobs";
import { ciphertextFileDescriptorSchema } from "../../blobs/encrypted/model";
import { APP_SURFACE_LIMITS } from "../manifest";
import { pluginSurfaceHeadSchema, pluginSurfaceSubjectSchema } from "./model";
const base = encryptedBusinessHeaderSchema.extend({ subject: pluginSurfaceSubjectSchema }).strict();
const generationId = z.string().regex(/^[a-zA-Z0-9_.:-]{1,128}$/);
const generation = base.extend({ generationId }).strict();
const revision = z.number().int().nonnegative();
export const pluginSurfaceGenerationSchema = z.object({ generationId, artifactDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  fileCount: z.number().int().positive().max(APP_SURFACE_LIMITS.files), byteSize: z.number().int().nonnegative().max(APP_SURFACE_LIMITS.totalBytes),
  manifest: blobDescriptorSchema.extend({ mime: z.literal("application/json"), bytes: z.number().int().positive().max(APP_SURFACE_LIMITS.manifestBytes) }).strict() }).strict();
export const pluginSurfaceFunctions = {
  "surfaces/plugins:prepare": { kind: "mutation", args: base.extend({ generation: pluginSurfaceGenerationSchema }).strict(), result: z.null() },
  "surfaces/plugins:attach": { kind: "mutation", args: generation.extend({ ordinal: z.number().int().nonnegative().max(APP_SURFACE_LIMITS.files), file: ciphertextFileDescriptorSchema }).strict(), result: z.null() },
  "surfaces/plugins:commit": { kind: "mutation", args: generation.extend({ expectedRevision: revision }).strict(), result: pluginSurfaceHeadSchema },
  "surfaces/plugins:mark": { kind: "mutation", args: base.extend({ expectedRevision: revision, state: z.literal("retired") }).strict(), result: pluginSurfaceHeadSchema },
  "surfaces/plugins:head": { kind: "query", args: base, result: pluginSurfaceHeadSchema.nullable() },
  "surfaces/plugins:retained": { kind: "query", args: generation, result: pluginSurfaceHeadSchema.nullable() },
} as const;
