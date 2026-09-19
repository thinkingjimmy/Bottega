/**
 * [INPUT]: Depends on immutable remote command, capability and creation contracts plus scoped protocol headers.
 * [OUTPUT]: Provides typed remote delivery, recovery, device readiness and idempotent Chat creation RPCs.
 * [POS]: Remote function registry consumed through the existing shared CloudTransport.
 */
import { projectQueryFunctions } from "./workspace/model";
import { acceptedQueueSchema, queueOrderSchema, awaitingQueueSchema } from "./queue";
import { z } from "zod";
import { encryptedBusinessHeaderSchema } from "../spaces";
import { cloudIdSchema as id } from "../auth";
import { versionSchema as rev } from "../scalars";
import { sha256Schema } from "../blobs";
import { encryptedChatHeadSchema as cloudChatHeadSchema, frozenRemoteChatInitializationSchema } from "../chats/encrypted/model";
import { REMOTE_LIMITS } from "./model";
import { encryptedRemoteCommandSchema as remoteCommandInputSchema, encryptedRemoteReceiptSchema as remoteReceiptSchema,
  encryptedRemoteReportSchema as remoteReportSchema, encryptedRemoteAgentsSchema as remoteAgentsSchema,
  encryptedRemoteTargetsSchema as remoteTargetsSchema, encryptedRemoteCreationReceiptSchema as remoteCreationReceiptSchema, encryptedRemoteCreationSchema } from "./encrypted/model";
const header = encryptedBusinessHeaderSchema.shape;
const cursor = z.string().max(2048).nullable();
const claim = { ...header, commandId: id, ciphertextHash: sha256Schema, connectionEpoch: id, claimToken: id };
const page = z.object({ items: z.array(remoteReceiptSchema).max(REMOTE_LIMITS.pageRows), cursor: z.string().nullable(), complete: z.boolean(), serverTime: rev }).strict();
export const remoteFunctions = {
  ...projectQueryFunctions,
  "remote/queue:awaiting": { kind: "query", args: z.object({ ...header, chatId: id }).strict(), result: awaitingQueueSchema },
  "remote/queue:publish": { kind: "mutation", args: z.object({ ...header, connectionEpoch: id, chatId: id, incarnationId: id, queue: acceptedQueueSchema }).strict(), result: z.null() },
  "remote/queue:reorderAwaiting": { kind: "mutation", args: z.object({ ...header, chatId: id, incarnationId: id, expectedRevision: sha256Schema, intentIds: queueOrderSchema }).strict(), result: z.null() },
  "remote/commands:submit": { kind: "mutation", args: z.object({ ...header, command: remoteCommandInputSchema }).strict(), result: remoteReceiptSchema },
  "remote/commands:withdraw": { kind: "mutation", args: z.object({ ...header, commandId: id }).strict(), result: remoteReceiptSchema },
  "remote/commands:get": { kind: "query", args: z.object({ ...header, commandId: id }).strict(), result: remoteReceiptSchema.nullable() },
  "remote/commands:page": { kind: "query", args: z.object({ ...header, chatId: id, cursor }).strict(), result: page },
  "remote/commands:inbox": { kind: "query", args: z.object({ ...header, connectionEpoch: id, cursor }).strict(), result: page },
  "remote/commands:claim": { kind: "mutation", args: z.object(claim).strict(), result: remoteReceiptSchema },
  "remote/commands:authorizeEffect": { kind: "mutation", args: z.object(claim).strict(), result: z.null() },
  "remote/commands:report": { kind: "mutation", args: z.object({ ...claim, report: remoteReportSchema }).strict(), result: remoteReceiptSchema },
  "remote/capabilities:publish": { kind: "mutation", args: z.object({ ...header, connectionEpoch: id, unlocked: z.boolean(), agents: remoteAgentsSchema }).strict(), result: z.null() },
  "remote/capabilities:project": { kind: "mutation", args: z.object({ ...header, connectionEpoch: id, projectId: id, bound: z.boolean() }).strict(), result: z.null() },
  "remote/capabilities:targets": { kind: "query", args: z.object({ ...header, chatId: id.nullable(), projectId: id.nullable().optional(), cursor }).strict(), result: remoteTargetsSchema },
  "remote/chats:create": { kind: "mutation", args: z.object({ ...header, creation: encryptedRemoteCreationSchema }).strict(), result: remoteCreationReceiptSchema },
  "remote/chats:created": { kind: "query", args: z.object({ ...header, createOperationId: id }).strict(), result: remoteCreationReceiptSchema.nullable() },
  "remote/chats:initialize": { kind: "mutation", args: z.object({ ...header, initialization: frozenRemoteChatInitializationSchema }).strict(), result: cloudChatHeadSchema },
  "remote/chats:preparations": { kind: "query", args: z.object({ ...header, connectionEpoch: id, cursor, purpose: z.literal("prewarm").optional() }).strict(),
    result: z.object({ items: z.array(cloudChatHeadSchema).max(REMOTE_LIMITS.pageRows), cursor: z.string().nullable(), complete: z.boolean() }).strict() },
  "remote/chats:retryPreparation": { kind: "mutation", args: z.object({ ...header, chatId: id, incarnationId: id, executionEpoch: rev, operationId: id }).strict(), result: cloudChatHeadSchema },
} as const;
