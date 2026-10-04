/**
 * [INPUT]: Depends on zod, JSON-safe primitive values and the zod-free failure-values leaf (re-exported)
 * [OUTPUT]: Provides domain-scoped ProductFailure, Agent and Chat-storage taxonomies, bounded/redacted diagnostics, strict safe details, IPC Result envelopes, constructors, and guards
 * [POS]: Pure product failure contract shared by desktop storage, cloud transcripts and UI adapters
 */

import { z } from "zod";
import { AGENT_RUNTIME_FAILURE_CODES, FAILURE_DIAGNOSTIC_CHAR_LIMIT, noFailureDetails } from "./failure-values";

/* The zod-free leaf (codes, diagnostic bound, the Agent failure constructor); re-exported so importers keep one path. */
export { AGENT_RUNTIME_FAILURE_CODES, agentRuntimeFailure, diagnosticFailureDetails, FAILURE_DIAGNOSTIC_CHAR_LIMIT, type AgentRuntimeFailureCode } from "./failure-values";

const SKILLS_RUNTIME_FAILURE_CODES = [
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

const SKILLS_MANAGEMENT_FAILURE_CODES = [
  "conflict",
  "read-only",
  "failed",
] as const;

export const CHAT_STORAGE_FAILURE_CODES = [
  "file-quarantined",
  "backup-failed",
  "recovery-conflict",
  "self-check-failed",
] as const;

type ChatStorageFailureCode =
  (typeof CHAT_STORAGE_FAILURE_CODES)[number];

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

const productFailureSafeDetailsSchema = z.discriminatedUnion("kind", [
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

const chatStorageFailureSchema = z.object({
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
