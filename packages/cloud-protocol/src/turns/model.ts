/**
 * [INPUT]: Depends on Chat sequence, option, body, receipt and live event contracts.
 * [OUTPUT]: Provides frozen turn identities, start/final commands and durable state projections.
 * [POS]: Shared publication model; local allocation precedes every cloud request.
 */
import { z } from "zod";
import { cloudIdSchema as id } from "../auth";
import { versionSchema as rev } from "../scalars";
import { sha256Schema } from "../blobs";
import { agentBackendIdSchema, turnOptionsSchema } from "../chats/options";
import { hashChatContent } from "../chats/transcript/body";
import { turnReceiptSchema } from "../chats/content/completion";
export const turnIdentitySchema = z.object({ chatId: id, incarnationId: id, turnId: id, ownerDeviceId: id, identityHash: sha256Schema }).strict();
export const turnStartSchema = turnIdentitySchema.extend({ backend: agentBackendIdSchema, options: turnOptionsSchema,
  expectedAgentRevision: rev, planRequested: z.boolean(), createdAt: rev,
  userMessageId: id, userSeq: rev.positive(), assistantMessageId: id, assistantSeq: rev.positive(), userBodyHash: sha256Schema,
  noticeBodyHashes: z.array(sha256Schema).max(1), noticeSeq: rev.positive().optional(),
}).strict().refine(value => {
  const slots = [value.noticeSeq, value.userSeq, value.assistantSeq].filter((seq): seq is number => seq !== undefined);
  return value.backend === value.options.backend && value.userMessageId !== value.assistantMessageId &&
    slots.every((seq, index) => !index || seq === slots[index - 1]! + 1) && value.noticeBodyHashes.length === slots.length - 2;
}, "Invalid turn sequence or backend");
export const hashTurnIdentity = (input: Omit<z.infer<typeof turnStartSchema>, "identityHash"> | z.infer<typeof turnStartSchema>) => {
  const { identityHash: _ignored, ...value } = input as z.infer<typeof turnStartSchema>; return hashChatContent(value);
};
export const turnFinalSchema = turnIdentitySchema.extend({ expectedHighSeq: rev, resultHash: sha256Schema,
  result: z.discriminatedUnion("kind", [z.object({ kind: z.literal("message"), bodyHash: sha256Schema }).strict(), z.object({ kind: z.literal("empty") }).strict()]),
  terminal: z.enum(["done", "error", "cancelled"]),
}).strict();
export const liveTurnStateSchema = z.object({ receipt: turnReceiptSchema, state: z.enum(["running", "unknown", "done", "error", "cancelled", "interrupted"]),
  chunkHighSeq: rev, unknownSince: rev.nullable(), terminalSeenAt: rev.nullable(), contentReady: z.boolean(),
  chunksAvailable: z.boolean(), backend: agentBackendIdSchema, createdAt: rev }).strict();
export type TurnIdentity = z.infer<typeof turnIdentitySchema>;
export type TurnStart = z.infer<typeof turnStartSchema>;
export type TurnFinal = z.infer<typeof turnFinalSchema>;
export type LiveTurnState = z.infer<typeof liveTurnStateSchema>;
