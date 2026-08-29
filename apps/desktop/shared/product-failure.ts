/**
 * [INPUT]: Depends only on zod and JSON-safe primitive values
 * [OUTPUT]: Provides domain-scoped ProductFailure, strict versioned safe details, IPC Result envelopes, schemas, constructors, and failure guards
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

export const productFailureSafeDetailsSchema = z.discriminatedUnion("kind", [
  noDetailsSchema,
  requirementDetailsSchema,
  limitDetailsSchema,
  refDetailsSchema,
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

export const productFailureSchema = z.discriminatedUnion("domain", [
  skillsRuntimeFailureSchema,
  skillsManagementFailureSchema,
]);

export type ProductFailure = z.infer<typeof productFailureSchema>;

export type ProductResult<T> =
  | Readonly<{ ok: true; value: T }>
  | Readonly<{ ok: false; failure: ProductFailure }>;

export const noFailureDetails = (): ProductFailureSafeDetails => ({
  version: 1,
  kind: "none",
});

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

export const productOk = <T>(value: T): ProductResult<T> => ({ ok: true, value });
export const productFailed = <T = never>(failure: ProductFailure): ProductResult<T> => ({
  ok: false,
  failure: productFailureSchema.parse(failure),
});

export const isProductFailure = (value: unknown): value is ProductFailure =>
  productFailureSchema.safeParse(value).success;

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
