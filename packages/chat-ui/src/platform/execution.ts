/**
 * [INPUT]: Depends on portable heads, shared remote preparation reasons and closed platform-independent execution status.
 * [OUTPUT]: Defines the validated local continuation view, including the Home snapshot capture state, without credentials or local paths.
 * [POS]: Shared capability projection; only the owning computer's adapter may expose the preparation action.
 */
import { z } from "zod";
import { cloudChatHeadSchema, executionPreparationReasonSchema } from "@ai-chat/cloud-protocol/chats/model";
const executionPhaseSchema = z.enum(["idle", "claiming", "settling", "body", "home", "attachments", "ready", "blocked"]);
const executionReasonSchema = z.union([executionPreparationReasonSchema, z.enum(["offline", "paused", "app", "archived", "deleted", "running", "local-busy", "project-unbound", "home-unavailable", "unavailable"])]);
export const executionViewSchema = z.object({ head: cloudChatHeadSchema.nullable(), localDeviceId: z.string().nullable(), canPrepare: z.boolean(),
  residence: z.enum(["native", "mirror"]).nullable().optional(),
  phase: executionPhaseSchema, reason: executionReasonSchema.nullable(), homeOmitted: z.number().int().nonnegative(),
  // F-14: the owning computer's unfrozen Home snapshot that holds the next send; null when nothing waits.
  homeCapture: z.object({ jobId: z.string().min(1).max(384), reason: z.enum(["pending", "transient", "permanent"]), failures: z.number().int().nonnegative(), retryAt: z.number().nullable() }).strict().nullable().optional(),
  backends: z.array(z.object({ id: z.enum(["codex", "claude", "kimi", "opencode"]), available: z.boolean(), version: z.string().nullable() }).strict()).max(4) }).strict();
export type ExecutionView = z.infer<typeof executionViewSchema>;
export type ExecutionReason = z.infer<typeof executionReasonSchema>;
