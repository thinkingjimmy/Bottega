/**
 * [INPUT]: Depends on scoped business headers, frozen initialization and verified body contracts.
 * [OUTPUT]: Defines ciphertext body RPCs, atomic content recovery claims, initialization identity reads and fenced replacement/transcript reads.
 * [POS]: Typed Chat body RPC partition; no raw database or local record upload endpoint exists.
 */
import { z } from "zod";
import { encryptedBusinessHeaderSchema as businessHeaderSchema } from "../../spaces";
import { encryptedBodyStatusSchema, encryptedMessageProjectionSchema, encryptedMessageFunctions } from "../encrypted/messages";
import { versionSchema as rev } from "../../scalars";
import { cloudIdSchema as id } from "../../auth";
import { sha256Schema } from "../../blobs";
import { encryptedChatHeadSchema } from "../encrypted/model";
import { encryptedInitialManifestSchema as chatInitialManifestSchema, encryptedInitialStatusSchema as chatInitialStatusSchema,
  encryptedInitialPageSchema as chatInitialPageSchema, encryptedInitialReceiptSchema as chatInitialReceiptSchema } from "../encrypted/initial";
const scope = businessHeaderSchema.shape;
const chat = { ...scope, chatId: id };
export const chatMessageProjectionSchema = encryptedMessageProjectionSchema;
export const initialIdentitySchema = z.object({ manifestId: id, ciphertextHash: sha256Schema }).strict();
export const chatTranscriptFunctions = {
  ...encryptedMessageFunctions,
  "chats/body/recovery:claim": { kind: "mutation", args: z.object({ ...chat, incarnationId: id, operationId: id }).strict(),
    result: z.object({ status: z.enum(["claimed", "adopted"]), head: encryptedChatHeadSchema, initialization: initialIdentitySchema.nullable() }).strict() },
  "chats/body/api:status": { kind: "query", args: z.object({ ...chat, bodyHash: sha256Schema }).strict(), result: encryptedBodyStatusSchema.nullable() },
  "chats/body/initial:begin": { kind: "mutation", args: z.object({ ...scope, manifest: chatInitialManifestSchema, replaceIncomplete: z.object({ manifestId: id, ciphertextHash: sha256Schema }).strict().optional() }).strict(), result: chatInitialStatusSchema },
  "chats/body/initial:publish": { kind: "mutation", args: z.object({ ...scope, operation: chatInitialPageSchema }).strict(), result: chatInitialReceiptSchema },
  "chats/body/initial:receipt": { kind: "query", args: z.object({ ...scope, operationId: id }).strict(), result: chatInitialReceiptSchema.nullable() },
  "chats/body/reads:head": { kind: "query", args: z.object(chat).strict(), result: z.object({ state: z.enum(["not-initialized", "initializing", "ready"]),
    incarnationId: id, bodyRevision: rev, headSeq: rev, reservedThroughSeq: rev, initialization: z.object({ manifestId: id, ciphertextHash: sha256Schema }).strict().nullable().optional() }).strict() },
  "chats/body/reads:page": { kind: "query", args: z.object({ ...chat, incarnationId: id, throughRevision: rev,
    beforeSeq: rev.positive().nullable(), afterSeq: rev, limit: rev.positive().max(50) }).strict(),
  result: z.object({ items: z.array(chatMessageProjectionSchema).max(50), cursor: rev.nullable(), complete: z.boolean() }).strict() },
  "chats/body/reads:get": { kind: "query", args: z.object({ ...chat, messageId: id }).strict(), result: chatMessageProjectionSchema.nullable() },
} as const;
