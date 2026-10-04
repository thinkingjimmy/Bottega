/**
 * [INPUT]: Depends on closed portable heads, title/archive patches and immutable local operation identities.
 * [OUTPUT]: Defines path-free durable Chat fact views and fixed-purpose edit/recovery requests.
 * [POS]: Main-owned metadata boundary; no classification or execution fields can be submitted.
 */
import { z } from "zod";
import { cloudIdSchema as id, sha256Schema } from "@ai-chat/cloud-protocol";
import { cloudChatHeadSchema } from "@ai-chat/cloud-protocol/chats/model";
import { chatMetadataPatchSchema } from "@ai-chat/cloud-protocol/chats/metadata";
const identity = z.object({ chatId: id, incarnationId: id, operationId: z.string().uuid(), expectedRevision: z.number().int().positive(), expectedQueueHash: sha256Schema }).strict();
export const chatFactsEditSchema = identity.extend({ changes: chatMetadataPatchSchema });
export const chatFactsDecisionSchema = identity.extend({ decision: z.enum(["retry", "discard"]) });
export const chatFactsViewSchema = z.object({ head: cloudChatHeadSchema.nullable(),
  status: z.enum(["idle", "pending", "conflicted", "deleted"]), candidate: chatMetadataPatchSchema.nullable(),
  queueHash: sha256Schema, pendingCount: z.number().int().nonnegative(), conflictCount: z.number().int().nonnegative() }).strict();
export type ChatFactsEdit = z.infer<typeof chatFactsEditSchema>;
export type ChatFactsDecision = z.infer<typeof chatFactsDecisionSchema>;
export type ChatFactsView = z.infer<typeof chatFactsViewSchema>;
