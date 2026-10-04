/**
 * [INPUT]: Depends on Zod and canonical Agent identifiers
 * [OUTPUT]: Provides strict switch intent and durable notice validators, and parseAgentSwitchIntent (a switch to or from a package Provider refused by its bare code, TASK-11 S3-b)
 * [POS]: Shared switch validation without runtime side effects
 */

import { z } from "zod";
import { agentBackendIdSchema } from "../platform/agent-schema";
import { providerIdSchema } from "@ai-chat/cloud-protocol/contracts/provider-id-schema";
export const agentSwitchIntentSchema = z.object({
  expectedAgent: agentBackendIdSchema,
  expectedAgentRevision: z.number().int().nonnegative(),
  expectedChatRecordRevision: z.number().int().positive(),
  targetAgent: agentBackendIdSchema,
}).strict().refine(value => value.expectedAgent !== value.targetAgent);

/**
 * A switch intent from the renderer or a remote command. Switching to or from a package Provider is refused by its bare code until S5–S7
 * (TASK-11 S3-b): the client reads PROVIDER_UNAVAILABLE as its own unavailable line, never as schema text.
 */
export function parseAgentSwitchIntent(raw: unknown) {
  const intent = raw && typeof raw === "object" ? raw as { expectedAgent?: unknown; targetAgent?: unknown } : {};
  const pinned = (id: unknown) => providerIdSchema.safeParse(id).success && !agentBackendIdSchema.safeParse(id).success;
  if (pinned(intent.expectedAgent) || pinned(intent.targetAgent)) throw new Error("PROVIDER_UNAVAILABLE");
  return agentSwitchIntentSchema.parse(raw);
}

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
