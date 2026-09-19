/**
 * [INPUT]: Immutable encrypted message identities and bounded block/manifest schemas.
 * [OUTPUT]: Original-outbox intent, block and completion records with commit-if-absent custody.
 * [POS]: Message retry detail; domain Stores retain all scheduling and lifecycle authority.
 */
import { z } from "zod";
import { cloudIdSchema as id } from "../../../auth";
import { sha256Schema as hash } from "../../../blobs";
import { encryptedSpaceSchema } from "../../../spaces";
import { messageMembershipSchema } from "../../../encryption/domains/messages";
import { encryptedMessageBlockSchema, encryptedMessageSchema, messagePublicationSchema, MESSAGE_CIPHER_LIMITS } from "./model";
const key = z.string().min(1).max(128);
export const frozenMessageIntentSchema = z.object({ kind: z.literal("encrypted-message-intent"), key, operationId: id, userId: id, encryptedSpace: encryptedSpaceSchema,
  plaintextHash: hash, plaintextBytes: z.number().int().min(1).max(MESSAGE_CIPHER_LIMITS.privateBytes), membership: messageMembershipSchema,
  blockIds: z.array(id).min(1).max(64), publication: messagePublicationSchema }).strict();
export const frozenMessageBlockSchema = z.object({ kind: z.literal("encrypted-message-block"), key, block: encryptedMessageBlockSchema }).strict();
export const frozenMessageCompleteSchema = z.object({ kind: z.literal("encrypted-message-complete"), key, plaintextHash: hash, message: encryptedMessageSchema }).strict();
export const frozenMessageRecords = [frozenMessageIntentSchema, frozenMessageBlockSchema, frozenMessageCompleteSchema] as const;
export const frozenMessageRecordSchema = z.discriminatedUnion("kind", frozenMessageRecords);
export type FrozenMessageRecord = z.infer<typeof frozenMessageRecordSchema>;
export interface MessageCipherJournal {
  read(key: string): Promise<FrozenMessageRecord | null>;
  write(key: string, value: FrozenMessageRecord): Promise<FrozenMessageRecord>;
}
