/**
 * [INPUT]: Depends on immutable remote command, capability and creation contracts plus scoped protocol headers.
 * [OUTPUT]: Provides typed remote delivery, recovery (including a bounded receipts-by-id read for one Chat), device readiness and idempotent Chat creation RPCs.
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
  encryptedRemoteTargetsSchema as remoteTargetsSchema, encryptedRemoteCreationReceiptSchema as remoteCreationReceiptSchema, encryptedRemoteCreationSchema, encryptedRemoteMemorySchema, encryptedRemotePluginsSchema, remotePacketSchema } from "./encrypted/model";
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
  /* One watch over a Chat's unsettled commands instead of one per stored command (C-24); terminal receipts never change. */
  "remote/commands:receipts": { kind: "query", args: z.object({ ...header, chatId: id,
    commandIds: z.array(id).min(1).max(REMOTE_LIMITS.pageRows).refine(ids => new Set(ids).size === ids.length, "remote-duplicate-command") }).strict(),
    result: z.object({ items: z.array(remoteReceiptSchema).max(REMOTE_LIMITS.pageRows), serverTime: rev }).strict() },
  "remote/commands:inbox": { kind: "query", args: z.object({ ...header, connectionEpoch: id, cursor }).strict(), result: page },
  "remote/commands:claim": { kind: "mutation", args: z.object(claim).strict(), result: remoteReceiptSchema },
  "remote/commands:authorizeEffect": { kind: "mutation", args: z.object(claim).strict(), result: z.null() },
  "remote/commands:report": { kind: "mutation", args: z.object({ ...claim, report: remoteReportSchema }).strict(), result: remoteReceiptSchema },
  /* R-33: `memory` is the computer-level Memory status packet; null turns it off, absent leaves the last one in place. */
  "remote/capabilities:publish": { kind: "mutation", args: z.object({ ...header, connectionEpoch: id, unlocked: z.boolean(), agents: remoteAgentsSchema,
    plugins: encryptedRemotePluginsSchema.nullable().optional(), memory: encryptedRemoteMemorySchema.nullable().optional() }).strict(), result: z.null() },
  /* Project folder facts in one transaction per page (OPT-10 / B-05); a Project the server refuses is named, the rest still land. */
  "remote/capabilities:projects": { kind: "mutation", args: z.object({ ...header, connectionEpoch: id,
    projects: z.array(z.object({ projectId: id, bound: z.boolean() }).strict()).min(1).max(REMOTE_LIMITS.pageRows)
      .refine(items => new Set(items.map(item => item.projectId)).size === items.length, "remote-duplicate-project") }).strict(),
    result: z.object({ rejected: z.array(id).max(REMOTE_LIMITS.pageRows) }).strict() },
  "remote/capabilities:targets": { kind: "query", args: z.object({ ...header, chatId: id.nullable(), projectId: id.nullable().optional(), cursor }).strict(), result: remoteTargetsSchema },
  "remote/chats:create": { kind: "mutation", args: z.object({ ...header, creation: encryptedRemoteCreationSchema }).strict(), result: remoteCreationReceiptSchema },
  "remote/chats:created": { kind: "query", args: z.object({ ...header, createOperationId: id }).strict(), result: remoteCreationReceiptSchema.nullable() },
  "remote/chats:initialize": { kind: "mutation", args: z.object({ ...header, initialization: frozenRemoteChatInitializationSchema }).strict(), result: cloudChatHeadSchema },
  "remote/chats:preparations": { kind: "query", args: z.object({ ...header, connectionEpoch: id, cursor }).strict(),
    result: z.object({ items: z.array(cloudChatHeadSchema).max(REMOTE_LIMITS.pageRows), cursor: z.string().nullable(), complete: z.boolean() }).strict() },
  "remote/chats:retryPreparation": { kind: "mutation", args: z.object({ ...header, chatId: id, incarnationId: id, operationId: id }).strict(), result: cloudChatHeadSchema },
  /* U06 Q7: the reserved computer's live reservations (reserved, or admitting with the first message that claimed them), and its sealed settlement of one. */
  "remote/chats:reservations": { kind: "query", args: z.object({ ...header, connectionEpoch: id, cursor }).strict(),
    result: z.object({ items: z.array(z.object({ receipt: remoteCreationReceiptSchema, first: remoteReceiptSchema.nullable() }).strict()).max(REMOTE_LIMITS.pageRows),
      cursor: z.string().nullable(), complete: z.boolean() }).strict() },
  "remote/chats:settleReservation": { kind: "mutation", args: z.object({ ...header, createOperationId: z.uuid(), outcome: z.enum(["filled", "refused"]), settlement: remotePacketSchema }).strict(),
    result: remoteCreationReceiptSchema },
} as const;
