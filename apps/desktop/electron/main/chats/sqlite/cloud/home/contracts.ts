/**
 * [INPUT]: Depends on local turn identities and immutable Home snapshot references.
 * [OUTPUT]: Defines terminal snapshot requests and causal jobs in the original Chat outbox.
 * [POS]: Main/worker Home capture contract; no network authority or absolute paths cross this boundary.
 */
import { z } from "zod";
import { storageIdSchema as id, storageRevisionSchema as rev } from "../../../../../../shared/local-storage/contracts";
export const homeTurnSchema = z.object({ chatId: id, turnId: id, userMessageId: id, userSeq: rev.positive(), assistantSeq: rev.positive() }).strict()
  .refine(value => value.assistantSeq === value.userSeq + 1);
export type HomeTurn = z.infer<typeof homeTurnSchema>;
export const homeJobSchema = z.object({ id, chatId: id, incarnationId: id, turnId: id, sourceDeviceId: id, userMessageId: id,
  userSeq: rev.positive(), throughSeq: rev.positive(), executionEpoch: rev.positive(), snapshotId: id, expectedSnapshotId: id.nullable() }).strict();
export type HomeJob = z.infer<typeof homeJobSchema>;
export const homeJobActions = [
  z.object({ type: z.literal("capture-home-job"), turn: homeTurnSchema }).strict(),
  z.object({ type: z.literal("archive-home-job"), id, payloadDigest: z.string().length(64) }).strict(),
] as const;
