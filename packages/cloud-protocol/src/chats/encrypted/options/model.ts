/**
 * [INPUT]: Original option lifecycle identities, encrypted Chat packets and admitted space headers.
 * [OUTPUT]: Closed ciphertext option CAS, exact receipts and original-outbox hash pairs.
 * [POS]: Option synchronization wire contract; option values and original hashes stay private.
 */
import { z } from "zod";
import { cloudIdSchema as id } from "../../../auth";
import { versionSchema as rev } from "../../../scalars";
import { sha256Schema as hash } from "../../../blobs";
import { encryptedSpaceSchema } from "../../../spaces";
import { agentBackendIdSchema } from "../../options";
import { chatOptionsReceiptSchema } from "../../options-sync";
import { chatPacketSchema, encryptedChatHeadSchema } from "../model";
import { messagePacketSchema } from "../messages/model";
export const encryptedOptionsOperationSchema = z.object({ operationId: id, chatId: id, incarnationId: id,
  agentRevision: rev, afterUserSeq: rev, backend: agentBackendIdSchema, sourceDeviceId: id,
  expectedOptionsHash: hash, mode: z.enum(["replace", "keep", "conflict"]), options: chatPacketSchema, proof: messagePacketSchema, ciphertextHash: hash }).strict();
export const encryptedOptionsReceiptSchema = chatOptionsReceiptSchema.omit({ payloadHash: true }).extend({ ciphertextHash: hash,
  commit: encryptedOptionsOperationSchema, head: encryptedChatHeadSchema.nullable() }).strict();
export const frozenOptionsSchema = z.object({ kind: z.literal("encrypted-chat-options"), encryptedSpace: encryptedSpaceSchema,
  plaintextHash: hash, transport: encryptedOptionsOperationSchema }).strict();
export type EncryptedOptionsOperation = z.infer<typeof encryptedOptionsOperationSchema>;
export type EncryptedOptionsReceipt = z.infer<typeof encryptedOptionsReceiptSchema>;
