/**
 * [INPUT]: Depends on local turn identities and immutable Home snapshot references.
 * [OUTPUT]: Defines terminal snapshot requests, causal jobs in the original Chat outbox and the skip of a job that was never frozen.
 * [POS]: Main/worker Home capture contract; no network authority or absolute paths cross this boundary.
 */
import { z } from "zod";
import { storageHashSchema as hash, storageIdSchema as id, storageRevisionSchema as rev } from "../../../../../../shared/local-storage/contracts";
export const homeTurnSchema = z.object({ chatId: id, turnId: id, userMessageId: id, userSeq: rev.positive(), assistantSeq: rev.positive() }).strict()
  .refine(value => value.assistantSeq === value.userSeq + 1);
export type HomeTurn = z.infer<typeof homeTurnSchema>;
export const homeJobSchema = z.object({ id, chatId: id, incarnationId: id, turnId: id, sourceDeviceId: id, userMessageId: id,
  userSeq: rev.positive(), throughSeq: rev.positive(), snapshotId: id, expectedSnapshotId: id.nullable() }).strict();
export type HomeJob = z.infer<typeof homeJobSchema>;
export const homeJobActions = [
  z.object({ type: z.literal("capture-home-job"), turn: homeTurnSchema }).strict(),
  z.object({ type: z.literal("skip-home-job"), id: z.string().min(1).max(384), payloadDigest: hash, chatId: id }).strict(),
] as const;
/* The chain position a skipped job hands back: the next job expects exactly what the skipped one expected (F-14). */
export const homeTailSchema = homeJobSchema.extend({ snapshotId: id.nullable() });
