/**
 * [INPUT]: Depends on account identities, canonical JSON and deterministic hashes.
 * [OUTPUT]: Provides revision-fenced deletion operations, immutable conflict/results and ordered tombstones.
 * [POS]: Shared lifecycle contract; deletion never grants execution or changes classification.
 */
import { z } from "zod";
import { cloudIdSchema as id } from "../auth";
import { canonicalJson } from "../encryption/encoding";
import { versionSchema as rev } from "../scalars";
import { hashBytes } from "../blobs/transfer";
export const tombstoneSchema = z.object({ entityKind: z.enum(["chat", "base", "project", "app"]), entityId: id,
  revision: rev.positive(), deletedAt: rev, byDeviceId: id, incarnationId: id.nullable() }).strict();
export type CloudTombstone = z.infer<typeof tombstoneSchema>;
export const deletionOperationSchema = z.object({ operationId: id, payloadHash: z.string().regex(/^[a-f0-9]{64}$/),
  target: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("chat"), id, incarnationId: id, expectedRevision: rev.positive().nullable() }).strict(),
    z.object({ kind: z.literal("base"), id }).strict(),
  ]) }).strict();
export type DeletionOperation = z.infer<typeof deletionOperationSchema>;
export const deletionReceiptSchema = z.object({ operationId: id, payloadHash: deletionOperationSchema.shape.payloadHash,
  tombstone: tombstoneSchema, status: z.enum(["applied", "converged"]) }).strict();
export const deletionResultSchema = z.union([deletionReceiptSchema,
  z.object({ operationId: id, payloadHash: deletionOperationSchema.shape.payloadHash,
    status: z.literal("conflicted"), currentRevision: rev.positive().nullable() }).strict()]);
export type DeletionResult = z.infer<typeof deletionResultSchema>;
export function hashDeletionOperation(operation: DeletionOperation) {
  const { payloadHash: _hash, ...payload } = deletionOperationSchema.parse(operation);
  return hashBytes(new TextEncoder().encode(canonicalJson(payload)));
}
