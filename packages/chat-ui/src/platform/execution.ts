/**
 * [INPUT]: Depends on portable heads, shared remote preparation reasons and closed platform-independent execution status.
 * [OUTPUT]: Defines the validated local continuation view without credentials or local paths.
 * [POS]: Shared capability projection; only a desktop adapter may expose the self-claim action.
 */
import { z } from "zod";
import { cloudChatHeadSchema, executionPreparationReasonSchema } from "@ai-chat/cloud-protocol/chats/model";
const executionPhaseSchema = z.enum(["idle", "claiming", "settling", "body", "home", "attachments", "ready", "blocked"]);
const executionReasonSchema = z.union([executionPreparationReasonSchema, z.enum(["offline", "paused", "app", "archived", "deleted", "running", "local-busy", "project-unbound", "home-unavailable", "unavailable"])]);
export const executionViewSchema = z.object({ head: cloudChatHeadSchema.nullable(), localDeviceId: z.string().nullable(), canClaim: z.boolean(), canPrepare: z.boolean(),
  residence: z.enum(["native", "mirror"]).nullable().optional(),
  phase: executionPhaseSchema, reason: executionReasonSchema.nullable(), homeOmitted: z.number().int().nonnegative(),
  backends: z.array(z.object({ id: z.enum(["codex", "claude", "kimi", "opencode"]), available: z.boolean(), version: z.string().nullable() }).strict()).max(4) }).strict();
export type ExecutionView = z.infer<typeof executionViewSchema>;
export type ExecutionReason = z.infer<typeof executionReasonSchema>;
