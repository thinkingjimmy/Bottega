/**
 * [INPUT]: Depends on zod, crypto and the new version of Memory Space's instance/stream/rebuild attempt data constraints
 * [OUTPUT]: Provides the following Delivery v4 schema, type, status, stable digest and instance constructor
 * [POS]: The definition of the main/memory/delivery durable structure; store.ts only retains status conversions and I/O
 */

import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";

export const id = z.string().min(1).max(512);
const integer = z.number().int().nonnegative();
const digestSchema = z.string().regex(/^[a-f0-9]{64}$/);

const streamSchema = z.object({
  key: id,
  grantId: id.nullable().default(null),
  memorySpaceId: id,
  sourceSessionKey: id,
  cursor: integer,
  pending: integer,
  delivered: integer,
  gap: integer,
  lastPayloadId: id.nullable(),
}).strict();

const targetSchema = z.object({
  id,
  memorySpaceId: id,
  sourceSessionKey: id,
  expectedPeerId: digestSchema,
  remoteSessionId: id,
  registeredAt: integer,
}).strict();

const reservationSchema = z.object({
  id,
  attemptId: id,
  runtimeEpoch: id,
  targetId: id,
  memorySpaceId: id,
  sourceSessionKey: id,
  grantId: id.nullable().default(null),
  assistantSeq: integer.default(0),
  policyRevision: integer,
  revocationRevision: integer,
  state: z.enum([
    "active",
    "completed",
    "rejected",
    "cancelled",
    "abandoned-uncertain",
  ]),
  createdAt: integer,
  finishedAt: integer.nullable(),
}).strict();

const cleanupSchema = z.object({
  id,
  operationId: id,
  memorySpaceId: id,
  targetIds: z.array(id).max(4_000),
  reason: z.enum([
    "tombstone",
    "new-generation",
    "rebuild",
    "runtime-orphan",
    "uninstall",
  ]),
  state: z.enum(["pending", "running", "completed", "failed"]),
  attempt: integer.default(0),
  error: z.string().max(2_000).nullable().default(null),
  createdAt: integer,
  completedAt: integer.nullable(),
}).strict();

const rebuildSchema = z.object({
  operationId: id,
  instanceId: id,
  attempt: z.number().int().positive().default(1),
  state: z.enum(["prepared", "purging", "backfilling", "completed", "failed"]),
  quiesced: z.boolean(),
  frozenSpaceIds: z.array(id).max(4_000),
  cursor: integer,
  deliveryGeneration: integer,
  frozenCleanupRequestIds: z.array(id).max(8_000).nullable().default(null),
  replacementInstanceId: id.nullable(),
  rebuildEpochId: id.nullable().default(null),
  backfillTotal: integer.default(0),
  backfillCompleted: integer.default(0),
  startedAt: integer,
  errorKind: z.enum(["provider", "stale-capability"]).nullable(),
}).strict();

const attentionSchema = z.object({
  id,
  kind: z.enum([
    "capture-gap",
    "cleanup-failed",
    "rebuild-failed",
    "capacity-pressure",
  ]),
  subjectRef: id,
  sessionKey: id.nullable(),
  detail: z.string().min(1).max(2_000),
  at: integer,
  resolvedAt: integer.nullable(),
}).strict();

const receiptSchema = z.object({
  operationId: id,
  owner: z.literal("delivery"),
  effectKind: id,
  subjectRef: id,
  spaceId: id,
  beforeRevision: integer,
  afterRevision: integer,
  committedAt: integer,
  receiptDigest: digestSchema,
  inputDigest: digestSchema,
}).strict();

const instanceSchema = z.object({
  id,
  providerId: id,
  revision: integer,
  deliveryGeneration: integer,
  captureAttemptSequence: integer.default(0),
  quiesced: z.boolean(),
  streams: z.record(id, streamSchema),
  remoteTargets: z.record(id, targetSchema),
  reservations: z.record(id, reservationSchema),
  cleanupRequests: z.record(id, cleanupSchema),
  rebuildJobs: z.record(id, rebuildSchema),
  effects: z.record(id, receiptSchema),
  attentions: z.record(id, attentionSchema).default({}),
}).strict();

export const stateSchema = z.object({
  schemaVersion: z.literal(4),
  revision: integer,
  runtimeEpoch: id,
  providerInstances: z.record(id, instanceSchema),
}).strict();

export type DeliveryOwnerEffectReceipt = z.infer<typeof receiptSchema>;
export type DeliveryV4State = z.infer<typeof stateSchema>;
/** 内部兼容别名只避免无意义的机械重命名；磁盘 schema 已明确断代为 v4。 */
export type DeliveryV3State = DeliveryV4State;
export type DeliveryInstance = z.infer<typeof instanceSchema>;
export type CaptureReservation = z.infer<typeof reservationSchema>;

export function emptyState(): DeliveryV3State {
  return {
    schemaVersion: 4,
    revision: 0,
    runtimeEpoch: `runtime_${randomUUID().replaceAll("-", "")}`,
    providerInstances: {},
  };
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonical(entry)])
  );
}

export function digest(value: unknown) {
  return createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");
}

export function instanceOf(
  state: DeliveryV3State,
  instanceId: string,
  providerId: string
) {
  const current = state.providerInstances[instanceId];
  if (current) {
    if (current.providerId !== providerId) {
      throw new Error("ProviderDataInstanceId 与 provider 不一致");
    }
    return current;
  }
  const created: DeliveryInstance = {
    id: instanceId,
    providerId,
    revision: 0,
    deliveryGeneration: 0,
    captureAttemptSequence: 0,
    quiesced: false,
    streams: {},
    remoteTargets: {},
    reservations: {},
    cleanupRequests: {},
    rebuildJobs: {},
    effects: {},
    attentions: {},
  };
  state.providerInstances[instanceId] = created;
  return created;
}
