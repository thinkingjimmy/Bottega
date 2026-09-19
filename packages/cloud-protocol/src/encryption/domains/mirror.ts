/**
 * [INPUT]: Closed local cache identities, revisions and ordered ciphertext references.
 * [OUTPUT]: Purpose-six mirror bindings and authenticated checkpoint commitments.
 * [POS]: Browser-only encrypted read cache domain; never an RPC payload or server store.
 */
import { z } from "zod";
import { commitment, digest, id, version } from "./scalars";
export const mirrorBindingSchema = z.object({ role: z.enum(["checkpoint", "catalog", "body"]),
  origin: z.string().url().max(512).refine(value => new URL(value).origin === value), installationId: z.uuid(),
  formatVersion: z.literal(1), invalidation: version, revision: version, cacheKey: digest,
  chatId: id.nullable(), incarnationId: id.nullable(), sourceRevision: version,
  partIndex: version, partCount: version.positive().max(16), metadataCommitment: digest,
}).strict().refine(value => value.partIndex < value.partCount);
export const mirrorPartRefSchema = z.object({ hash: digest, bytes: version.positive().max(1_405_952) }).strict();
export const mirrorEntryRefSchema = z.object({ key: digest, role: z.enum(["catalog", "body"]), chatId: id.nullable(),
  incarnationId: id.nullable(), sourceRevision: version, operationId: z.uuid(), revision: version, invalidation: version,
  parts: z.array(mirrorPartRefSchema).min(1).max(16) }).strict();
export const mirrorCheckpointSchema = z.object({ version: z.literal(1), entries: z.array(mirrorEntryRefSchema).max(128) }).strict()
  .refine(value => new Set(value.entries.map(entry => entry.key)).size === value.entries.length);
export const hashMirrorMetadata = (value: z.input<typeof mirrorCheckpointSchema>) => commitment("mirror", mirrorCheckpointSchema, value);
