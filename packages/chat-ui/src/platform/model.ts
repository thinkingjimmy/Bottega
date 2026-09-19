/**
 * [INPUT]: Depends on public portable Chat/body/live schemas and bounded identifiers.
 * [OUTPUT]: Defines authority-free catalog (title/archive/sortKey facts), transcript models with verified imported source Agent and live read models shared by desktop and Web.
 * [POS]: Chat presentation contract; a portable classification never creates context, grants or an App role.
 */
import { z } from "zod";
import { cloudIdSchema as id } from "@ai-chat/cloud-protocol";
import { cloudChatHeadSchema } from "@ai-chat/cloud-protocol/chats/model";
import { chatBodySchema } from "@ai-chat/cloud-protocol/chats/transcript/body";
import { liveProjectionSchema } from "@ai-chat/cloud-protocol/turns/live";
import { liveTurnStateSchema } from "@ai-chat/cloud-protocol/turns/model";
import { importedEntrySchema } from "@ai-chat/cloud-protocol/chats/imported/model";
import { agentBackendIdSchema } from "@ai-chat/cloud-protocol/chats/options";
const seq = z.number().int().nonnegative().safe();
export const transcriptRequestSchema = z.object({ chatId: id, segment: z.enum(["native", "imported"]), beforeSeq: seq.nullable(),
  revision: seq.nullable(), generationId: id.nullable(), limit: seq.positive().max(50) }).strict();
export const transcriptPageSchema = z.object({ chatId: id, incarnationId: id, segment: z.enum(["native", "imported"]), revision: seq,
  generationId: id.nullable(), state: z.enum(["pending", "ready", "partial", "unavailable"]), messages: z.array(chatBodySchema).max(50),
  importedBackend: agentBackendIdSchema.optional(), imported: z.array(importedEntrySchema).max(50).default([]), cursor: seq.positive().nullable(), complete: z.boolean() }).strict();
export const chatCatalogFactsSchema = z.object({ chatId: id, residence: z.enum(["native", "mirror"]).optional(), title: z.string().max(200).nullable(), archivedAt: seq.nullable(),
  sortKey: z.number().min(0).max(Number.MAX_SAFE_INTEGER).nullable().optional(), state: z.enum(["idle", "pending", "conflicted", "deleted"]) }).strict();
export type ChatCatalogFacts = z.infer<typeof chatCatalogFactsSchema>;
export const chatCatalogPageSchema = z.object({ items: z.array(cloudChatHeadSchema).max(50), facts: z.array(chatCatalogFactsSchema).max(50).optional(), cursor: seq.nullable(), revision: seq, complete: z.boolean() }).strict();
export const chatLiveViewSchema = z.object({ state: liveTurnStateSchema.nullable(), projection: liveProjectionSchema.nullable(),
  contentReady: z.boolean(), replayComplete: z.boolean() }).strict();
export type TranscriptRequest = z.infer<typeof transcriptRequestSchema>;
export type TranscriptPage = z.infer<typeof transcriptPageSchema>;
export type ChatCatalogPage = z.infer<typeof chatCatalogPageSchema>;
export type ChatLiveView = z.infer<typeof chatLiveViewSchema>;
