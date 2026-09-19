/**
 * [INPUT]: Required encrypted business headers and closed ciphertext Chat heads/receipts.
 * [OUTPUT]: Metadata and catalog RPC schemas with no plaintext content argument or result.
 * [POS]: Wire registry slice; local domain operations remain separate client contracts.
 */
import { z } from "zod";
import { cloudIdSchema as id } from "../../auth";
import { versionSchema as rev } from "../../scalars";
import { encryptedBusinessHeaderSchema as header } from "../../spaces";
import { encryptedChatMetadataOperationSchema, encryptedChatMetadataReceiptSchema, encryptedChatHeadSchema, CHAT_CIPHER_LIMITS } from "./model";
export const encryptedChatFunctions = {
  "chats/metadata:apply": { kind: "mutation", args: header.extend({ operation: encryptedChatMetadataOperationSchema }).strict(), result: encryptedChatMetadataReceiptSchema },
  "chats/metadata:receipt": { kind: "query", args: header.extend({ operationId: id }).strict(), result: encryptedChatMetadataReceiptSchema.nullable() },
  "chats/metadata:head": { kind: "query", args: header.extend({ chatId: id }).strict(), result: encryptedChatHeadSchema.nullable() },
  "chats/metadata:catalog": { kind: "query", args: header, result: z.object({ revision: rev }).strict() },
  "chats/metadata:page": { kind: "query", args: header.extend({ afterRevision: rev, throughRevision: rev }).strict(),
    result: z.object({ items: z.array(encryptedChatHeadSchema).max(CHAT_CIPHER_LIMITS.pageItems), cursor: rev.nullable(), complete: z.boolean() }).strict() },
  "chats/catalog:sidebar": { kind: "query", args: header.extend({ projectId: id.nullable(), rootOnly: z.boolean(),
    cursor: z.string().max(4096).nullable() }).strict(),
    result: z.object({ items: z.array(encryptedChatHeadSchema).max(CHAT_CIPHER_LIMITS.pageItems),
      cursor: z.string().max(4096).nullable(), complete: z.boolean() }).strict() },
  "chats/catalog:page": { kind: "query", args: header.extend({ projectId: id.nullable(), archived: z.boolean(), rootOnly: z.boolean().optional(),
    cursor: z.string().max(4096).nullable(), revision: rev.nullable() }).strict(),
    result: z.object({ items: z.array(encryptedChatHeadSchema).max(CHAT_CIPHER_LIMITS.pageItems), devices: z.array(z.object({ deviceId: id, name: z.string().max(40) }).strict()).max(50).optional(),
      cursor: z.string().max(4096).nullable(), revision: rev, complete: z.boolean() }).strict() },
} as const;
