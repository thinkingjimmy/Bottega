/**
 * [INPUT]: Registered Agent identities and bounded provider quota readings.
 * [OUTPUT]: Private quota snapshot schemas with explicit missing, stale and reset semantics; re-exports the zod-free readers and time budgets from quota-view.ts.
 * [POS]: packages/cloud-protocol/src/remote/quota; Shared native/remote quota contract; a reading never authorizes execution.
 */
import { z } from "zod";
import { agentBackendIdSchema } from "../../chats/options";
const time = z.number().int().nonnegative().safe().nullable();
export const quotaWindowSchema = z.object({ id: z.string().min(1).max(256), windowDurationMins: z.number().positive().nullable(), calendarPeriod: z.literal("month").optional(),
  usedPercent: z.number().nonnegative().nullable(), resetsAt: time, receivedAt: time.unwrap(), sourceUpdatedAt: time }).strict();
export const quotaPoolSchema = z.object({ id: z.string().min(1).max(256), isGeneral: z.boolean(), label: z.string().max(256).nullable(), windows: z.array(quotaWindowSchema).max(16) }).strict();
export const agentUsageLimitsSchema = z.object({ backend: agentBackendIdSchema, generation: time.unwrap(), revision: time.unwrap(),
  availability: z.enum(["available", "not-installed", "needs-auth", "unsupported", "unavailable"]),
  source: z.enum(["codex-app-server", "claude-sdk-query", "kimi-local-api", "opencode-go-api"]).nullable(),
  fetchState: z.enum(["idle", "refreshing", "deferred", "error"]), planLabel: z.string().max(256).nullable(), pools: z.array(quotaPoolSchema).max(16),
  receivedAt: time, lastAttemptAt: time, nextRetryAt: time,
  reasonCode: z.enum(["not-installed", "needs-auth", "unsupported", "unavailable", "timeout", "invalid-response", "startup-unavailable", "rate-limited", "busy"]).nullable(),
}).strict();
export type AgentQuotaWindow = z.infer<typeof quotaWindowSchema>;
export type AgentQuotaPool = z.infer<typeof quotaPoolSchema>;
export type AgentUsageLimits = z.infer<typeof agentUsageLimitsSchema>;

export { LIMITS_TIMING, remainingPercent, quotaWindowExpired, quotaStale, currentRemaining, sortQuotaPools, generalQuotaWindows, generalRemaining, emptyAgentLimits } from "./quota-view";
