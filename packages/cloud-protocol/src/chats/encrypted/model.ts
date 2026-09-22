/**
 * [INPUT]: Closed Chat domain schemas, allowed crypto metadata and immutable encrypted-space identities.
 * [OUTPUT]: Ciphertext facts/options, claimable original creation capsules, metadata commits and immutable encrypted receipts.
 * [POS]: Wire counterpart of local plaintext Chat contracts; private titles/options/hashes never enter clear metadata, the manual sortKey does (like createdAt).
 */
import { z } from "zod";
import { cloudIdSchema as id } from "../../auth";
import { versionSchema as rev } from "../../scalars";
import { sha256Schema as hash } from "../../blobs";
import { chatMetadataSchema } from "../../encryption/domains/records";
import { encryptedSpaceSchema } from "../../spaces";
import { encryptedRemoteCreationSchema } from "../../remote/encrypted/model";
import { chatSortKeySchema, cloudChatHeadSchema, portableChatSchema } from "../model";
export const CHAT_CIPHER_LIMITS = { packetBytes: 32_768, commitBytes: 131_072, pageBytes: 786_432, pageItems: 30 } as const;
export const chatPacketSchema = z.object({ operationId: id, role: z.enum(["facts", "metadata", "options", "classification", "initial", "title"]),
  metadata: chatMetadataSchema, envelope: z.string().min(1).max(43_691).regex(/^[A-Za-z0-9_-]+$/),
  ciphertextHash: hash, ciphertextBytes: rev.positive().max(CHAT_CIPHER_LIMITS.packetBytes) }).strict();
/* sortKey rides in clear next to createdAt so the server can derive navigation order; the client binds it to the
   encrypted facts copy in openChatHead exactly like createdAt. Absent = never moved; null never appears on the wire. */
export const publicChatSchema = z.object({ id, incarnationId: id, agent: portableChatSchema.shape.agent,
  agentRevision: rev, classification: portableChatSchema.shape.classification, cloudRevision: rev, createdAt: rev, updatedAt: rev,
  sortKey: chatSortKeySchema.optional() }).strict();
export const encryptedChatHeadSchema = z.object({ ...cloudChatHeadSchema.shape, chat: publicChatSchema,
  encryptedSpace: encryptedSpaceSchema, facts: chatPacketSchema.nullable(), options: chatPacketSchema.nullable(),
  remoteCreation: encryptedRemoteCreationSchema.nullable().default(null) }).strict().refine(value =>
  value.reservedThroughSeq >= value.headSeq &&
  (value.remoteCreation ? value.facts === null && value.options === null && value.chat.cloudRevision === 1 && value.chat.agentRevision === 0 &&
    value.chat.agent === value.remoteCreation.binding.agent && value.chat.createdAt === value.remoteCreation.createdAt &&
    value.archivedAt === null && value.kind === "native" && value.chat.classification.conversationKind === "ordinary" && value.chat.classification.appId === null &&
    value.chat.classification.projectId === value.remoteCreation.binding.projectId && value.sourceDeviceId === value.remoteCreation.binding.targetDeviceId &&
    value.ownerDeviceId === value.remoteCreation.binding.targetDeviceId &&
      value.executionPreparation !== null && value.executionPreparation.state !== "ready" : value.facts?.role === "facts" && value.options?.role === "options") &&
  (!value.executionPreparation || value.executionPreparation.deviceId === value.ownerDeviceId));
export const frozenRemoteChatInitializationSchema = z.object({ kind: z.literal("encrypted-remote-initial"), encryptedSpace: encryptedSpaceSchema,
  chatId: id, incarnationId: id, creationHash: hash, facts: chatPacketSchema, options: chatPacketSchema }).strict();
export const encryptedChatMetadataOperationSchema = z.object({ operationId: id, chatId: id,
  kind: z.enum(["create", "patch"]), chat: publicChatSchema, archivedAt: rev.nullable(), lifecycleKind: cloudChatHeadSchema.shape.kind,
  expectedRevision: rev, sourceDeviceId: id, facts: chatPacketSchema, options: chatPacketSchema.nullable(),
  operation: chatPacketSchema, ciphertextHash: hash }).strict().refine(value => value.chatId === value.chat.id &&
    (value.kind === "create") === (value.options !== null) && (value.kind !== "create" || value.expectedRevision === 0));
export const encryptedChatMetadataReceiptSchema = z.object({ operationId: id, chatId: id, ciphertextHash: hash,
  status: z.enum(["applied", "converged", "conflicted", "deleted"]), head: encryptedChatHeadSchema.nullable(),
  sourceDeviceId: id, createdAt: rev, commit: encryptedChatMetadataOperationSchema }).strict()
  .refine(value => (value.status === "deleted") === (value.head === null));
export const frozenChatMetadataSchema = z.object({ kind: z.literal("encrypted-chat-metadata"), encryptedSpace: encryptedSpaceSchema,
  plaintextHash: hash, transport: encryptedChatMetadataOperationSchema }).strict();
export type ChatPacket = z.infer<typeof chatPacketSchema>;
export type EncryptedChatHead = z.infer<typeof encryptedChatHeadSchema>;
export type EncryptedChatMetadataOperation = z.infer<typeof encryptedChatMetadataOperationSchema>;
export type EncryptedChatMetadataReceipt = z.infer<typeof encryptedChatMetadataReceiptSchema>;
export type FrozenChatMetadata = z.infer<typeof frozenChatMetadataSchema>;
