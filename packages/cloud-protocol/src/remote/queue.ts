/**
 * [INPUT]: Public identities, durable queue sequences and content hashes.
 * [OUTPUT]: Content-free accepted queue projection and bounded atomic queue controls.
 * [POS]: Shared queue contract; message text remains in encrypted command custody.
 */
import { z } from "zod";
import { cloudIdSchema as id } from "../auth";
import { versionSchema as rev } from "../scalars";
import { sha256Schema } from "../blobs";
export const queueItemsSchema = z.array(z.object({ intentId: id, sequence: rev, sourceDeviceId: id.nullable() }).strict()).max(64)
  .refine(items => new Set(items.map(item => item.intentId)).size === items.length);
export const acceptedQueueSchema = z.object({ deviceId: id, executionEpoch: rev, revision: sha256Schema, items: queueItemsSchema }).strict();
export type AcceptedQueue = z.infer<typeof acceptedQueueSchema>;
export const awaitingQueueSchema = z.object({ accepted: acceptedQueueSchema.optional(), revision: sha256Schema, items: z.array(z.object({ intentId: id, sequence: rev,
  sourceDeviceId: id, targetDeviceId: id }).strict()).max(64) }).strict();
export type AwaitingQueue = z.infer<typeof awaitingQueueSchema>;
export const queueOrderSchema = z.array(id).min(1).max(64).refine(ids => new Set(ids).size === ids.length);
export const queueControlSchemas = [
  z.object({ kind: z.literal("withdraw-queued"), expectedRevision: sha256Schema, intentId: id }).strict(),
  z.object({ kind: z.literal("reorder-queue"), expectedRevision: sha256Schema, intentIds: queueOrderSchema }).strict(),
] as const;
export const isQueueControl = (kind: string) => kind === "withdraw-queued" || kind === "reorder-queue";
