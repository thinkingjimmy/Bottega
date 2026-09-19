/**
 * [INPUT]: Depends on closed protocol headers, random request IDs and authenticated account/device identifiers.
 * [OUTPUT]: Provides fresh time samples and identity-bound prior-session continuity, including verified desktop login replacement.
 * [POS]: Account-scoped prerequisites for remembered Desktop/Web unlock within the same device kind and monotonic client clocks.
 */
import { z } from "zod";
import { protocolHeaderSchema } from "../config";
import { cloudIdSchema } from "../auth/index";
export const CONTINUITY_LIMITS = Object.freeze({ requestWindowMs: 60_000, requestsPerDevice: 60, replacementHops: 32 });

export const restoreGenerationSchema = z.string().min(1).max(128).regex(/^[a-zA-Z0-9_-]+$/);
export const continuityIdentitySchema = z.object({
  environmentId: protocolHeaderSchema.shape.environmentId,
  deploymentId: protocolHeaderSchema.shape.deploymentId,
  userId: cloudIdSchema, sessionId: cloudIdSchema, deviceId: cloudIdSchema,
  restoreGeneration: restoreGenerationSchema,
}).strict();
export type ContinuityIdentity = z.infer<typeof continuityIdentitySchema>;
const previousSessionSchema = z.object({
  sessionId: cloudIdSchema, deviceId: cloudIdSchema, restoreGeneration: restoreGenerationSchema,
}).strict();
const continuityStateSchema = z.enum(["active", "expired", "replaced", "revoked", "unknown"]);
export const checkUnlockContinuityResultSchema = z.object({
  checkId: z.uuid(), previous: previousSessionSchema, current: continuityIdentitySchema,
  state: continuityStateSchema,
}).strict();
export type UnlockContinuity = z.infer<typeof checkUnlockContinuityResultSchema>;
export const sampleTimeResultSchema = z.object({
  sampleId: z.uuid(), current: continuityIdentitySchema, serverTime: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
}).strict();
export type TimeSample = z.infer<typeof sampleTimeResultSchema>;
const scope = { ...protocolHeaderSchema.shape,
  expectedUserId: cloudIdSchema, expectedSessionId: cloudIdSchema, expectedDeviceId: cloudIdSchema };
export const continuityFunctions = {
  "account:checkUnlockContinuity": { kind: "mutation", args: z.object({
    ...scope, checkId: z.uuid(), previous: previousSessionSchema,
  }).strict(), result: checkUnlockContinuityResultSchema },
  "account:sampleTime": { kind: "mutation", args: z.object({
    ...scope, sampleId: z.uuid(),
  }).strict(), result: sampleTimeResultSchema },
} as const;
