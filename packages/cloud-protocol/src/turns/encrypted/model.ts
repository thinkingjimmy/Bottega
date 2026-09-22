/**
 * [INPUT]: Closed local turn identities, allowed Chat option metadata and versioned encrypted-space authority.
 * [OUTPUT]: Ciphertext-only starts, ordered event batches, final commitments, receipts and durable prefix descriptors.
 * [POS]: Public live-turn wire contract; identityHash is the start ciphertext commitment, never a plaintext hash.
 */
import { z } from "zod";
import { versionSchema as rev } from "../../scalars";
import { sha256Schema as hash } from "../../blobs";
import { encryptedSpaceSchema } from "../../spaces";
import { chatPacketSchema } from "../../chats/encrypted/model";
import { turnIdentitySchema, turnStartSchema } from "../model";
import { turnReceiptSchema } from "../../chats/content/completion";
export const TURN_CIPHER_LIMITS = { packetBytes: 98_304, pageBytes: 393_216, pageChunks: 3 } as const;
const turnPacketSchema = z.object({ envelope: z.string().min(1).max(131_072).regex(/^[A-Za-z0-9_-]+$/),
  ciphertextHash: hash, ciphertextBytes: rev.positive().max(TURN_CIPHER_LIMITS.packetBytes) }).strict();
const { options: _options, planRequested: _plan, identityHash: _identity, ...startFields } = turnStartSchema.shape;
const turnStartRoutingSchema = z.object({ ...startFields, optionsPacket: chatPacketSchema }).strict().refine(value => {
  const sequence = [value.noticeSeq, value.userSeq, value.assistantSeq].filter((seq): seq is number => seq !== undefined);
  return value.userMessageId !== value.assistantMessageId && sequence.every((seq, index) => !index || seq === sequence[index - 1]! + 1) &&
    value.noticeBodyHashes.length === sequence.length - 2;
});
export const encryptedTurnStartSchema = turnStartRoutingSchema.safeExtend({ packet: turnPacketSchema, identityHash: hash }).strict()
  .refine(value => value.identityHash === value.packet.ciphertextHash);
const routingId = z.string().min(1).max(256);
export const interactionIdsSchema = z.object({ approvals: z.array(routingId).max(20), inputs: z.array(routingId).max(20) }).strict()
  .refine(value => new Set(value.approvals).size === value.approvals.length && new Set(value.inputs).size === value.inputs.length);
const turnRoutingEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("content") }).strict(),
  z.object({ type: z.enum(["approval-requested", "approval-closed", "user-input-requested", "user-input-closed"]), requestId: routingId }).strict(),
  z.object({ type: z.literal("terminal"), terminal: z.enum(["done", "error", "cancelled"]) }).strict(),
  z.object({ type: z.literal("replacement-begin"), snapshotId: routingId, bytes: rev.positive().max(4_194_304) }).strict(),
  z.object({ type: z.literal("replacement-part"), snapshotId: routingId, index: rev.max(511), bytes: rev.positive().max(16_384) }).strict(),
  z.object({ type: z.literal("replacement-commit"), snapshotId: routingId, interactions: interactionIdsSchema }).strict(),
  z.object({ type: z.literal("replacement-abort"), snapshotId: routingId }).strict(),
]);
export const encryptedTurnChunkSchema = z.object({ seq: rev.positive(), previousCiphertextHash: hash,
  routing: z.array(turnRoutingEventSchema).min(1).max(32), packet: turnPacketSchema }).strict();
export const encryptedTurnFinalSchema = turnIdentitySchema.extend({ expectedHighSeq: rev, previousCiphertextHash: hash,
  result: z.discriminatedUnion("kind", [z.object({ kind: z.literal("message"), bodyHash: hash }).strict(), z.object({ kind: z.literal("empty") }).strict()]),
  terminal: z.enum(["done", "error", "cancelled"]), packet: turnPacketSchema }).strict();
export const encryptedTurnPrefixSchema = z.object({ kind: z.literal("turn-prefix-v1"), encryptedSpace: encryptedSpaceSchema,
  start: encryptedTurnStartSchema, highSeq: rev, lastCiphertextHash: hash, ciphertextBytes: rev.positive(),
  sealedAt: rev, reason: turnReceiptSchema.shape.sealReason.unwrap(), terminal: z.enum(["done", "error", "cancelled"]).nullable(), bodyHash: hash }).strict();
const { resultKind: _result, resultHash: _resultHash, ...receiptFields } = turnReceiptSchema.shape;
export const encryptedTurnReceiptSchema = z.object({ ...receiptFields, start: encryptedTurnStartSchema,
  resultKind: z.enum(["message", "empty", "prefix"]).optional(),
  result: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("final"), final: encryptedTurnFinalSchema }).strict(),
    z.object({ kind: z.literal("adopted"), bodyHash: hash }).strict(),
    z.object({ kind: z.literal("prefix"), prefix: encryptedTurnPrefixSchema }).strict(),
  ]).optional() }).strict().refine(value => value.assistantSeq === value.userSeq + 1 &&
    value.chatId === value.start.chatId && value.incarnationId === value.start.incarnationId && value.turnId === value.start.turnId &&
    value.ownerDeviceId === value.start.ownerDeviceId && value.identityHash === value.start.identityHash &&
    value.userMessageId === value.start.userMessageId && value.userSeq === value.start.userSeq && value.assistantMessageId === value.start.assistantMessageId && value.assistantSeq === value.start.assistantSeq &&
    (value.settlementState !== "settled" ? value.result === undefined && value.resultKind === undefined :
      value.settledAt !== undefined && value.result !== undefined && value.resultKind !== undefined &&
      (value.result.kind === "prefix" ? value.resultKind === "prefix" : value.result.kind === "adopted" ? value.resultKind === "message" : value.resultKind === value.result.final.result.kind)) &&
    (value.resultKind === "message" || value.resultKind === "prefix" ? value.finalMessageId === value.assistantMessageId : value.finalMessageId === undefined));
export const encryptedLiveTurnStateSchema = z.object({ receipt: encryptedTurnReceiptSchema,
  state: z.enum(["running", "unknown", "done", "error", "cancelled", "interrupted"]), chunkHighSeq: rev, lastCiphertextHash: hash,
  unknownSince: rev.nullable(), terminalSeenAt: rev.nullable(), contentReady: z.boolean(), chunksAvailable: z.boolean(),
  backend: turnStartSchema.shape.backend, createdAt: rev }).strict();
export const encryptedTurnPageSchema = z.object({ state: encryptedLiveTurnStateSchema.nullable(), chunks: z.array(encryptedTurnChunkSchema).max(TURN_CIPHER_LIMITS.pageChunks), complete: z.boolean() }).strict();
export type EncryptedTurnStart = z.infer<typeof encryptedTurnStartSchema>;
export type EncryptedTurnChunk = z.infer<typeof encryptedTurnChunkSchema>;
export type EncryptedTurnFinal = z.infer<typeof encryptedTurnFinalSchema>;
export type EncryptedTurnPrefix = z.infer<typeof encryptedTurnPrefixSchema>;
export type EncryptedTurnReceipt = z.infer<typeof encryptedTurnReceiptSchema>;
export type EncryptedLiveTurnState = z.infer<typeof encryptedLiveTurnStateSchema>;
export type EncryptedTurnPage = z.infer<typeof encryptedTurnPageSchema>;
export type TurnRoutingEvent = z.infer<typeof turnRoutingEventSchema>;
export type TurnPacket = z.infer<typeof turnPacketSchema>;
