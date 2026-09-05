/**
 * [INPUT]: Depends only on zod and JSON-safe primitive values
 * [OUTPUT]: Provides domain-scoped ProductFailure, Agent and Chat-storage taxonomies, bounded/redacted diagnostics, strict safe details, IPC Result envelopes, constructors, and guards
 * [POS]: Shared failure wire contract; main owns classification, transports return data instead of throwing, and renderer owns localized sentences
 */

import { z } from "zod";

export const SKILLS_RUNTIME_FAILURE_CODES = [
  "ref-invalid",
  "requirement-blocked",
  "file-too-large",
  "changed-during-read",
  "plan-unsupported",
  "invalid-request",
  "staging-rejected",
  "package-invalid",
  "unavailable",
] as const;

export const SKILLS_MANAGEMENT_FAILURE_CODES = [
  "conflict",
  "read-only",
  "failed",
] as const;

export const AGENT_RUNTIME_FAILURE_CODES = [
  "auth-required",
  "rate-limited",
  "quota-exhausted",
  "context-exhausted",
  "connection-lost",
  "request-rejected",
  "service-unavailable",
  "runtime-unavailable",
  "unknown",
] as const;

export const CHAT_STORAGE_FAILURE_CODES = [
  "file-quarantined",
  "backup-failed",
  "recovery-conflict",
  "self-check-failed",
] as const;

export type AgentRuntimeFailureCode =
  (typeof AGENT_RUNTIME_FAILURE_CODES)[number];

export type ChatStorageFailureCode =
  (typeof CHAT_STORAGE_FAILURE_CODES)[number];

export const FAILURE_DIAGNOSTIC_CHAR_LIMIT = 2_048;

const noDetailsSchema = z.object({
  version: z.literal(1),
  kind: z.literal("none"),
}).strict();

const requirementDetailsSchema = z.object({
  version: z.literal(1),
  kind: z.literal("requirement"),
  requirement: z.string().min(1).max(160),
}).strict();

const limitDetailsSchema = z.object({
  version: z.literal(1),
  kind: z.literal("limit"),
  limit: z.number().int().positive().max(1_000_000),
}).strict();

const refDetailsSchema = z.object({
  version: z.literal(1),
  kind: z.literal("ref"),
  ref: z.string().min(1).max(512),
}).strict();

const diagnosticDetailsSchema = z.object({
  version: z.literal(1),
  kind: z.literal("diagnostic"),
  message: z.string().min(1).max(FAILURE_DIAGNOSTIC_CHAR_LIMIT),
}).strict();

export const productFailureSafeDetailsSchema = z.discriminatedUnion("kind", [
  noDetailsSchema,
  requirementDetailsSchema,
  limitDetailsSchema,
  refDetailsSchema,
  diagnosticDetailsSchema,
]);

export type ProductFailureSafeDetails = z.infer<typeof productFailureSafeDetailsSchema>;

const skillsRuntimeFailureSchema = z.object({
  domain: z.literal("skills-runtime"),
  code: z.enum(SKILLS_RUNTIME_FAILURE_CODES),
  safeDetails: productFailureSafeDetailsSchema,
}).strict();

const skillsManagementFailureSchema = z.object({
  domain: z.literal("skills-management"),
  code: z.enum(SKILLS_MANAGEMENT_FAILURE_CODES),
  safeDetails: productFailureSafeDetailsSchema,
}).strict();

const agentRuntimeFailureSchema = z.object({
  domain: z.literal("agent-runtime"),
  code: z.enum(AGENT_RUNTIME_FAILURE_CODES),
  safeDetails: productFailureSafeDetailsSchema,
}).strict();

export const chatStorageFailureSchema = z.object({
  domain: z.literal("chat-storage"),
  code: z.enum(CHAT_STORAGE_FAILURE_CODES),
  safeDetails: productFailureSafeDetailsSchema,
}).strict();

export const productFailureSchema = z.discriminatedUnion("domain", [
  skillsRuntimeFailureSchema,
  skillsManagementFailureSchema,
  agentRuntimeFailureSchema,
  chatStorageFailureSchema,
]);

export type ProductFailure = z.infer<typeof productFailureSchema>;
export type ChatStorageFailure = z.infer<typeof chatStorageFailureSchema>;

export type ProductResult<T> =
  | Readonly<{ ok: true; value: T }>
  | Readonly<{ ok: false; failure: ProductFailure }>;

export const noFailureDetails = (): ProductFailureSafeDetails => ({
  version: 1,
  kind: "none",
});

/* Renderer 可见诊断统一经过这把窄门。ACP transport 还会先按本轮 secret
 * 做精确脱敏；这里负责跨来源的预算与常见凭据/用户目录遮罩。 */
export function diagnosticFailureDetails(
  value: unknown
): ProductFailureSafeDetails {
  const raw = value instanceof Error ? value.message : String(value ?? "");
  const message = raw
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [redacted]")
    .replace(/\b(?:sk|sess|token)-[A-Za-z0-9_-]{8,}\b/gi, "[redacted]")
    .replace(/\b(api[_-]?key|access[_-]?token|refresh[_-]?token)\s*[:=]\s*[^\s,;]+/gi, "$1=[redacted]")
    .replace(/\/Users\/[^/\s]+/g, "/Users/…")
    .replace(/\b[A-Z]:\\Users\\[^\\\s]+/gi, "C:\\Users\\…")
    .trim()
    .slice(0, FAILURE_DIAGNOSTIC_CHAR_LIMIT);
  return message
    ? { version: 1, kind: "diagnostic", message }
    : noFailureDetails();
}

export const skillsRuntimeFailure = (
  code: (typeof SKILLS_RUNTIME_FAILURE_CODES)[number],
  safeDetails: ProductFailureSafeDetails = noFailureDetails()
): ProductFailure => productFailureSchema.parse({
  domain: "skills-runtime",
  code,
  safeDetails,
});

export const skillsManagementFailure = (
  code: (typeof SKILLS_MANAGEMENT_FAILURE_CODES)[number],
  safeDetails: ProductFailureSafeDetails = noFailureDetails()
): ProductFailure => productFailureSchema.parse({
  domain: "skills-management",
  code,
  safeDetails,
});

export const agentRuntimeFailure = (
  code: AgentRuntimeFailureCode,
  safeDetails: ProductFailureSafeDetails = noFailureDetails()
): ProductFailure => productFailureSchema.parse({
  domain: "agent-runtime",
  code,
  safeDetails,
});

export const chatStorageFailure = (
  code: ChatStorageFailureCode,
  safeDetails: ProductFailureSafeDetails = noFailureDetails()
): ChatStorageFailure => chatStorageFailureSchema.parse({
  domain: "chat-storage",
  code,
  safeDetails,
});

export const productOk = <T>(value: T): ProductResult<T> => ({ ok: true, value });
export const productFailed = <T = never>(failure: ProductFailure): ProductResult<T> => ({
  ok: false,
  failure: productFailureSchema.parse(failure),
});

export class ProductFailureError extends Error {
  constructor(readonly failure: ProductFailure) {
    super(`${failure.domain}/${failure.code}`);
    this.name = "ProductFailureError";
  }
}

export function unwrapProductResult<T>(result: ProductResult<T>): T {
  if (result.ok) return result.value;
  throw new ProductFailureError(result.failure);
}
