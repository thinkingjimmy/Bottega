/**
 * [INPUT]: Depends on Zod and canonical Agent identifiers
 * [OUTPUT]: Provides strict switch intent and durable notice validators
 * [POS]: Shared switch validation without runtime side effects
 */

import { z } from "zod";
import { agentBackendIdSchema } from "../agent-schema";
export const agentSwitchIntentSchema = z.object({
  expectedAgent: agentBackendIdSchema,
  expectedAgentRevision: z.number().int().nonnegative(),
  expectedChatRecordRevision: z.number().int().positive(),
  targetAgent: agentBackendIdSchema,
}).strict().refine(value => value.expectedAgent !== value.targetAgent);
export { agentSwitchedNoticeSchema } from "@ai-chat/cloud-protocol/chats/content/notices";

export const chatOptionsPatchSchema = z.object({
  chatId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
  expectedAgent: agentBackendIdSchema,
  expectedAgentRevision: z.number().int().nonnegative(),
  expectedChatRecordRevision: z.number().int().positive(),
  patch: z.object({
    model: z.string().min(1).max(200).optional(),
    reasoningEffort: z.string().min(1).max(200).optional(),
    serviceTier: z.string().min(1).max(200).optional(),
    permissionMode: z.enum(["ask-for-approval", "approve-for-me", "full-access"]).optional(),
  }).strict(),
}).strict();
