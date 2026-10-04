/**
 * [INPUT]: Closed original-time memberships, fixed 64 KiB crypto bounds and ciphertext-only file references.
 * [OUTPUT]: Immutable message blocks, ordered manifest pages and ciphertext body projections.
 * [POS]: Native/imported message wire model; no message text, original content hash or filename is public metadata.
 */
import { z } from "zod";
import { cloudIdSchema as id } from "../../../auth";
import { versionSchema as rev } from "../../../scalars";
import { sha256Schema as hash } from "../../../blobs";
import { ciphertextFileDescriptorSchema } from "../../../blobs/encrypted";
import { messageMembershipSchema, messageManifestMetadataSchema } from "../../../encryption/domains/messages";
import { agentBackendIdSchema } from "../../options";
import { encryptedTurnPrefixSchema } from "../../../turns/encrypted/model";
/* stageBatchBytes bounds one batched staging call: 4 MiB of ciphertext encodes to about 5.6 MiB of base64url
   argument, well inside the 8 MiB request ceiling this deployment already pins as MAX_PART_BYTES. A maximal
   message (64 blocks) is the only shape that crosses it, so it is the only one that costs a second call. */
export const MESSAGE_CIPHER_LIMITS = { blockBytes: 65_536, packetBytes: 98_304, privateBytes: 4_194_304, blocksPerPage: 64,
  pageBytes: 262_144, rangeItems: 16, stageBatchBytes: 4_194_304 } as const;
export const messagePacketSchema = z.object({ envelope: z.string().min(1).max(131_072).regex(/^[A-Za-z0-9_-]+$/),
  ciphertextHash: hash, ciphertextBytes: rev.positive().max(MESSAGE_CIPHER_LIMITS.packetBytes) }).strict();
export const encryptedMessageBlockSchema = messagePacketSchema.extend({ operationId: id, membership: messageMembershipSchema,
  blockId: id, blockIndex: rev.max(63), blockCount: rev.positive().max(64) }).strict().refine(value => value.blockIndex < value.blockCount);
export const messagePublicationSchema = z.object({ backend: agentBackendIdSchema.nullable(), turnId: id.nullable(),
  completion: z.enum(["complete", "interrupted"]).nullable(), references: z.array(ciphertextFileDescriptorSchema).max(64) }).strict();
export const encryptedMessagePageSchema = messagePacketSchema.extend({ operationId: id, metadata: messageManifestMetadataSchema,
  pageIndex: rev.max(0), pageCount: rev.min(1).max(1), publication: messagePublicationSchema }).strict()
  .refine(value => value.metadata.blockCount <= 64 && value.metadata.blockOffset === 0 && value.metadata.blocks.length === value.metadata.blockCount);
export const encryptedMessageSchema = z.object({ bodyHash: hash, operationId: id, membership: messageMembershipSchema,
  pages: z.array(encryptedMessagePageSchema).min(1).max(1) }).strict();
export const encryptedBodyStageSchema = z.object({ chatId: id, incarnationId: id,
  bodyHash: hash, storage: z.object({ kind: z.literal("encrypted"), message: encryptedMessageSchema }).strict() }).strict()
  .refine(value => value.bodyHash === value.storage.message.bodyHash && value.chatId === value.storage.message.membership.chatId && value.incarnationId === value.storage.message.membership.incarnationId);
export const encryptedBodySummarySchema = z.object({ messageId: id, seq: rev.positive(), role: z.enum(["user", "assistant", "notice"]),
  backend: agentBackendIdSchema.nullable(), createdAt: rev.nullable(), timeState: z.enum(["valid", "missing", "invalid"]),
  source: z.enum(["native", "imported"]), generationId: id.nullable(), blobs: z.array(ciphertextFileDescriptorSchema).max(64),
  turnId: id.nullable(), completion: z.enum(["complete", "interrupted"]).nullable(), ciphertextBytes: rev.positive() }).strict();
export const encryptedBodyStatusSchema = z.object({ bodyHash: hash, state: z.enum(["verifying", "ready", "failed"]), reason: z.string().max(128).nullable(),
  summary: encryptedBodySummarySchema.nullable(), published: z.boolean() }).strict();
export const encryptedMessageProjectionSchema = z.object({ bodyHash: hash, summary: encryptedBodySummarySchema,
  storage: z.discriminatedUnion("kind", [z.object({ kind: z.literal("encrypted"), message: encryptedMessageSchema }).strict(),
    z.object({ kind: z.literal("encrypted-turn-prefix"), prefix: encryptedTurnPrefixSchema }).strict()]) }).strict();
export type EncryptedMessageBlock = z.infer<typeof encryptedMessageBlockSchema>;
export type EncryptedMessagePage = z.infer<typeof encryptedMessagePageSchema>;
export type EncryptedMessage = z.infer<typeof encryptedMessageSchema>;
export type MessageMembership = z.infer<typeof messageMembershipSchema>;
export type MessagePublication = z.infer<typeof messagePublicationSchema>;
export type EncryptedMessageProjection = z.infer<typeof encryptedMessageProjectionSchema>;
