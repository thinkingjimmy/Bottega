/**
 * [INPUT]: Depends on portable heads, deletion identities and scoped Store review hashes.
 * [OUTPUT]: Defines durable deletion views and fixed-purpose review/decision IPC payloads.
 * [POS]: Renderer boundary; scope, local content and deletion journals remain main-owned.
 */
import { z } from "zod";
import { cloudIdSchema as id, sha256Schema } from "@ai-chat/cloud-protocol";
import { cloudChatHeadSchema } from "@ai-chat/cloud-protocol/chats/model";
import { deletionOperationSchema, deletionResultSchema } from "@ai-chat/cloud-protocol/lifecycle/model";
export const chatDeletionRequestSchema = z.object({ chatId: id, incarnationId: id, operationId: z.string().uuid(),
  expectedRevision: z.number().int().positive(), expectedReviewHash: sha256Schema }).strict();
export const chatDeletionKeepSchema = z.object({ chatId: id, operationId: z.string().uuid(), expectedReviewHash: sha256Schema }).strict();
export const chatDeletionViewSchema = z.object({ head: cloudChatHeadSchema.nullable(), operation: deletionOperationSchema.nullable(),
  result: deletionResultSchema.nullable(), pending: z.boolean(), reviewHash: sha256Schema }).strict();
export type ChatDeletionRequest = z.infer<typeof chatDeletionRequestSchema>;
export type ChatDeletionKeep = z.infer<typeof chatDeletionKeepSchema>;
export type ChatDeletionView = z.infer<typeof chatDeletionViewSchema>;
