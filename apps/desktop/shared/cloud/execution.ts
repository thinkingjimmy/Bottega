/**
 * [INPUT]: Depends on bounded Chat identity and the canonical UTF-8 message budget.
 * [OUTPUT]: Defines credential-free local continuation draft reads and revision-fenced writes.
 * [POS]: Main/preload boundary; drafts stay on this computer and never enter cloud mutations.
 */
import { z } from "zod";
import { cloudIdSchema } from "@ai-chat/cloud-protocol";
import { MESSAGE_BYTE_LIMIT } from "@ai-chat/cloud-protocol/chats/content/budgets";
export const executionDraftIdSchema = z.object({ chatId: cloudIdSchema, incarnationId: cloudIdSchema }).strict();
const executionDraftTextSchema = z.string().refine(text => new TextEncoder().encode(text).byteLength <= MESSAGE_BYTE_LIMIT, "Draft is too large");
export const executionDraftSchema = z.object({ revision: z.number().int().nonnegative().safe(), text: executionDraftTextSchema }).strict();
export const executionDraftWriteSchema = executionDraftIdSchema.extend({ expectedRevision: z.number().int().nonnegative().safe(), text: executionDraftTextSchema }).strict();
export type ExecutionDraft = z.infer<typeof executionDraftSchema>;
