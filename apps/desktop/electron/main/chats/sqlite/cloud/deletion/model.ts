/**
 * [INPUT]: Depends on immutable Chat deletion sources and the closed permanent removal contract.
 * [OUTPUT]: Derives original revision-CAS deletion operations and validates native removal scope, accepted results and conflicts.
 * [POS]: Shared deletion identity guard for the sole SQLite writer and main transport.
 */
import { z } from "zod";
import { cloudIdSchema as id } from "@ai-chat/cloud-protocol";
import { classificationSchema } from "@ai-chat/cloud-protocol/chats/model";
import { hashChatContent } from "@ai-chat/cloud-protocol/chats/transcript/body";
import { hashDeletionOperation, tombstoneSchema, type DeletionResult } from "@ai-chat/cloud-protocol/lifecycle/model";
import { syncScopeSchema } from "../../../../../../shared/local-storage/contracts";
export const chatRemovalStateSchema = z.object({ incarnationId: id, scope: syncScopeSchema.nullable() }).strict().nullable();
const sourceSchema = z.object({ chatId: id, incarnationId: id, classification: classificationSchema,
  expectedRevision: z.number().int().positive().nullable() }).strict();
export const deletionTargetSchema = z.object({ id, incarnationId: id, projectId: id.nullable(), residence: z.enum(["native", "mirror"]),
  revision: z.number().int().nonnegative(), messageRevision: z.number().int().nonnegative(), outboxHash: z.string().regex(/^[a-f0-9]{64}$/),
  deletion: tombstoneSchema.nullable() }).strict().nullable();
export function chatDeletionOperation(outboxId: string, chatId: string, source: unknown) {
  const payload = sourceSchema.parse(source);
  if (payload.chatId !== chatId) throw new Error("DELETION_SOURCE_IDENTITY_MISMATCH");
  const operation = { operationId: hashChatContent(["delete-chat", outboxId]), payloadHash: "0".repeat(64),
    target: { kind: "chat" as const, id: chatId, incarnationId: payload.incarnationId, expectedRevision: payload.expectedRevision } };
  return { ...operation, payloadHash: hashDeletionOperation(operation) };
}
export function assertDeletionReceipt(operation: ReturnType<typeof chatDeletionOperation>, receipt: DeletionResult) {
  if (receipt.operationId !== operation.operationId || receipt.payloadHash !== operation.payloadHash ||
    receipt.status !== "conflicted" && (receipt.tombstone.entityKind !== "chat" || receipt.tombstone.entityId !== operation.target.id ||
    receipt.tombstone.incarnationId !== operation.target.incarnationId)) throw new Error("DELETION_RECEIPT_IDENTITY_MISMATCH");
}
