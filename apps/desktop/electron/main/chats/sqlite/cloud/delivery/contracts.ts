/**
 * [INPUT]: Depends on closed native/imported content, metadata/options/deletion and paged Home inventory contracts.
 * [OUTPUT]: Defines original-outbox evidence, including incomplete initialization and immutable content recovery results.
 * [POS]: Local outbox detail contract; checkpoints never own scheduling or business mutations.
 */
import { cloudChatHeadSchema } from "@ai-chat/cloud-protocol/chats/model";
import { initialIdentitySchema } from "@ai-chat/cloud-protocol/chats/transcript/functions";
import { frozenInitialManifestSchema, frozenInitialPageSchema } from "@ai-chat/cloud-protocol/chats/encrypted/initial";
import { frozenOptionsSchema } from "@ai-chat/cloud-protocol/chats/encrypted/options";
import { frozenTurnRecords } from "@ai-chat/cloud-protocol/turns/encrypted/journal";
import { frozenRemoteChatInitializationSchema, frozenChatMetadataSchema } from "@ai-chat/cloud-protocol/chats/encrypted";
import { frozenFileIntentSchema, frozenFilePartSchema, frozenFileCompleteSchema } from "@ai-chat/cloud-protocol/blobs/encrypted";
import { frozenMessageRecords } from "@ai-chat/cloud-protocol/chats/encrypted/messages";
import { frozenClassificationSchema } from "@ai-chat/cloud-protocol/chats/encrypted/classification";
import { encryptedImportCheckpoints } from "@ai-chat/cloud-protocol/chats/imported/encrypted";
import { frozenHomeRecords } from "@ai-chat/cloud-protocol/chats/home/encrypted";
import { z } from "zod";
import { cloudIdSchema as id, sha256Schema as hash } from "@ai-chat/cloud-protocol";
import { chatBodySchema, chatBodyStorageSchema } from "@ai-chat/cloud-protocol/chats/transcript/body";
import { chatMetadataOperationSchema, chatMetadataReceiptSchema } from "@ai-chat/cloud-protocol/chats/metadata";
import { chatInitialManifestSchema, chatInitialReceiptSchema } from "@ai-chat/cloud-protocol/chats/transcript/initial";
import { homeCheckpoints } from "./home";
import { importedCheckpoints } from "./imported/model";
import { turnCheckpoints } from "./turns/model";
import { chatOptionsReceiptSchema } from "@ai-chat/cloud-protocol/chats/options-sync";
import { deletionResultSchema } from "@ai-chat/cloud-protocol/lifecycle/model";

export const retainedSourceRefSchema = z.object({ sourceId: id, digest: hash }).strict();
export const chatDeliveryCheckpointSchema = z.discriminatedUnion("kind", [
  frozenInitialManifestSchema, frozenInitialPageSchema, frozenOptionsSchema, frozenRemoteChatInitializationSchema, frozenChatMetadataSchema, frozenFileIntentSchema, frozenFilePartSchema, frozenFileCompleteSchema,
  ...frozenMessageRecords,
  frozenClassificationSchema,
  ...frozenHomeRecords,
  ...encryptedImportCheckpoints,
  ...homeCheckpoints,
  ...importedCheckpoints,
  ...turnCheckpoints,
  ...frozenTurnRecords,
  z.object({ kind: z.literal("deletion-receipt"), receipt: deletionResultSchema }).strict(),
  z.object({ kind: z.literal("options-receipt"), receipt: chatOptionsReceiptSchema }).strict(),
  z.object({ kind: z.literal("metadata-operation"), operation: chatMetadataOperationSchema, basis: chatMetadataReceiptSchema.nullable() }).strict(),
  z.object({ kind: z.literal("metadata-receipt"), receipt: chatMetadataReceiptSchema }).strict(),
  z.object({ kind: z.literal("native-recovery"), head: cloudChatHeadSchema, initialization: z.object({ manifestId: id, ciphertextHash: hash }).strict().nullable() }).strict(),
  z.object({ kind: z.literal("native-recovery-head"), status: z.enum(["claimed", "adopted"]), head: cloudChatHeadSchema, initialization: initialIdentitySchema.nullable() }).strict(),
  z.object({ kind: z.literal("native-body"), bodyHash: hash, body: chatBodySchema }).strict(),
  z.object({ kind: z.literal("body-storage"), bodyHash: hash, storage: chatBodyStorageSchema }).strict(),
  z.object({ kind: z.literal("native-manifest"), manifest: chatInitialManifestSchema }).strict(),
  z.object({ kind: z.literal("native-page"), receipt: chatInitialReceiptSchema }).strict(),
  z.object({ kind: z.literal("native-complete"), manifest: chatInitialManifestSchema }).strict(),
]);
export type ChatDeliveryCheckpoint = z.infer<typeof chatDeliveryCheckpointSchema>;
export const checkpointKey = (value: ChatDeliveryCheckpoint) => {
  switch (value.kind) {
    case "native-recovery-head": return "native-recovery-head";
    case "encrypted-native-page": return `cipher-native-page:${value.transport.operationId}`;
    case "encrypted-chat-options": return `cipher-options:${value.transport.operationId}`;
    case "encrypted-remote-initial": return `cipher-remote-initial:${value.chatId}`;
    case "encrypted-chat-metadata": return `cipher-metadata:${value.transport.operationId}`;
    case "encrypted-file-intent": return `${value.key}:intent`;
    case "encrypted-file-part": return `${value.key}:part:${value.part.partIndex}`;
    case "encrypted-file-complete": return `${value.key}:complete`;
    case "encrypted-message-intent": return `${value.key}:intent`;
    case "encrypted-message-block": return `${value.key}:block:${value.block.blockIndex}`;
    case "encrypted-message-complete": return `${value.key}:complete`;
    case "encrypted-chat-classification": return `cipher-classification:${value.transport.lifecycleOperationId}`;
    case "encrypted-home-entry": return `cipher-home-entry:${value.identity.snapshotId}:${value.entry.ordinal}`;
    case "encrypted-home-manifest": return `cipher-home-manifest:${value.manifest.snapshotId}`;
    case "encrypted-home-page": return `cipher-home-page:${value.operation.operationId}`;
    case "encrypted-import-page": return `cipher-import-page:${value.transport.operationId}`;
    case "native-body": return `body:${value.body.message.seq}`;
    case "body-storage": return `storage:${value.bodyHash}`;
    case "native-page": return `page:${value.receipt.operationId}`;
    case "home-page": return `home-page:${value.receipt.operationId}`;
    case "home-entries": return `home-entries:${value.offset}`;
    case "import-entry": return `import-entry:${value.entry.deliverySeq}`;
    case "import-page": return `import-page:${value.receipt.operationId}`;
    case "turn-chunk": return `turn-chunk:${value.chunk.seq}`;
    case "encrypted-turn-chunk": return `cipher-turn-chunk:${value.chunk.seq}`;
    case "encrypted-turn-canonical-body": return `cipher-turn-body:${value.message.membership.seq}`;
    default: return value.kind;
  }
};
export const checkpointKeySchema = z.string().min(1).max(192);
