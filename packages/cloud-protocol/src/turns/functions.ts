/**
 * [INPUT]: Depends on closed turn commands, Chat heads and scoped protocol headers.
 * [OUTPUT]: Provides typed bounded publication batches, successor sealing, catch-up, receipts and the owning desktop's preparation acknowledgement.
 * [POS]: Public turn registry; remote text delivery uses the separate remote registry.
 */
import { z } from "zod";
import { encryptedBusinessHeaderSchema } from "../spaces";
import { cloudIdSchema as id } from "../auth";
import { versionSchema as rev } from "../scalars";
import { executionPreparationReasonSchema } from "../chats/model";
import { encryptedChatHeadSchema } from "../chats/encrypted/model";
import { turnIdentitySchema } from "./model";
import { encryptedTurnStartSchema, encryptedTurnFinalSchema, encryptedTurnChunkSchema, encryptedTurnReceiptSchema,
  encryptedLiveTurnStateSchema, encryptedTurnPageSchema } from "./encrypted/model";
const header = encryptedBusinessHeaderSchema.shape;
const lookup = { ...header, chatId: id, turnId: id };
export const TURN_APPEND_BATCH_CHUNKS = 4;
export const TURN_APPEND_BATCH_BYTES = 262_144;
const appendChunksSchema = z.array(encryptedTurnChunkSchema).min(1).max(TURN_APPEND_BATCH_CHUNKS)
  .refine(chunks => new TextEncoder().encode(JSON.stringify(chunks)).byteLength <= TURN_APPEND_BATCH_BYTES, "turn-chunk-batch-too-large")
  .refine(chunks => chunks.every((chunk, index) => !index || chunk.seq === chunks[index - 1]!.seq + 1), "turn-chunk-batch-order");
export const turnFunctions = {
  "turns/adoption:empty": { kind: "mutation", args: z.object({ ...header, turn: encryptedTurnStartSchema, final: encryptedTurnFinalSchema }).strict(), result: encryptedTurnReceiptSchema.nullable() },
  "turns/api:start": { kind: "mutation", args: z.object({ ...header, turn: encryptedTurnStartSchema }).strict(), result: encryptedTurnReceiptSchema },
  "turns/api:append": { kind: "mutation", args: z.object({ ...header, turn: turnIdentitySchema, chunk: encryptedTurnChunkSchema }).strict(), result: encryptedLiveTurnStateSchema },
  "turns/api:appendBatch": { kind: "mutation", args: z.object({ ...header, turn: turnIdentitySchema, chunks: appendChunksSchema }).strict(), result: encryptedLiveTurnStateSchema },
  "turns/api:finalize": { kind: "mutation", args: z.object({ ...header, final: encryptedTurnFinalSchema }).strict(), result: encryptedTurnReceiptSchema },
  "turns/api:unconfirmed": { kind: "mutation", args: z.object({ ...header, turn: turnIdentitySchema }).strict(), result: encryptedTurnReceiptSchema },
  "turns/api:supersede": { kind: "mutation", args: z.object({ ...header, turn: turnIdentitySchema, replacement: encryptedTurnStartSchema }).strict(), result: encryptedTurnReceiptSchema },
  "turns/reads:receipt": { kind: "query", args: z.object(lookup).strict(), result: encryptedTurnReceiptSchema.nullable() },
  "turns/reads:receipts": { kind: "query", args: z.object({ ...header, chatId: id, afterSeq: rev, throughSeq: rev }).strict(),
    result: z.object({ items: z.array(encryptedTurnReceiptSchema).max(50), cursor: rev.nullable(), complete: z.boolean() }).strict() },
  "turns/reads:state": { kind: "query", args: z.object(lookup).strict(), result: encryptedLiveTurnStateSchema.nullable() },
  "turns/reads:page": { kind: "query", args: z.object({ ...lookup, afterSeq: rev, throughSeq: rev }).strict(),
    result: encryptedTurnPageSchema },
  "turns/owner:prepare": { kind: "mutation", args: z.object({ ...header, chatId: id, incarnationId: id,
    bodyRevision: rev, homeSnapshotId: id.nullable(), state: z.enum(["ready", "blocked"]),
    reason: executionPreparationReasonSchema.nullable() }).strict(), result: encryptedChatHeadSchema },
} as const;
