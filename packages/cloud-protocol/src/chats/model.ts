/**
 * [INPUT]: Depends on Zod, public IDs and canonical Agent options.
 * [OUTPUT]: Provides portable Chat facts and server-owned metadata/preparation and deferred handoff heads with exact catalog revision baselines.
 * [POS]: Closed reading contract; local context, paths, sessions and grants have no representation.
 */
import { acceptedQueueSchema } from "../remote/queue";
import { z } from "zod";
import { cloudIdSchema as id } from "../auth";
import { versionSchema as rev } from "../scalars";
import { agentBackendIdSchema, turnOptionsSchema } from "./options";

export const classificationSchema = z.object({ conversationKind: z.enum(["ordinary", "app-use", "app-edit"]),
  appId: id.nullable(), projectId: id.nullable(),
}).strict().refine(value => (value.conversationKind === "ordinary") === (value.appId === null) &&
  (value.conversationKind !== "app-edit" || value.projectId !== null), "Invalid portable Chat classification");
export type ChatClassification = z.infer<typeof classificationSchema>;
/** Manual position in creation-millisecond space; the effective order key is `sortKey ?? createdAt` (descending).
 *  A finite double, not a version: drops write the midpoint of two neighbours. Absent means "never moved"; null never travels on heads. */
export const chatSortKeySchema = z.number().min(0).max(Number.MAX_SAFE_INTEGER);
export const forkLineageFields = { parentChatId: id.nullable().optional(), parentIncarnationId: id.nullable().optional(),
  parentMessageId: id.nullable().optional(), inheritedThroughSeq: rev.positive().nullable().optional() };
export function portableForkLineage(value: { parentChatId?: string | null; parentIncarnationId?: string | null;
  parentMessageId?: string | null; inheritedThroughSeq?: number | null }) {
  return value.parentChatId == null ? {} : { parentChatId: value.parentChatId, parentIncarnationId: value.parentIncarnationId,
    parentMessageId: value.parentMessageId, inheritedThroughSeq: value.inheritedThroughSeq };
}
export const portableChatSchema = z.object({ id, incarnationId: id, title: z.string().trim().min(1).max(200).nullable(),
  agent: agentBackendIdSchema, options: turnOptionsSchema, agentRevision: rev, classification: classificationSchema,
  cloudRevision: rev, createdAt: rev, updatedAt: rev, sortKey: chatSortKeySchema.optional(), ...forkLineageFields,
}).strict().refine(value => value.agent === value.options.backend && value.updatedAt >= value.createdAt, "Invalid portable Chat facts")
  .refine(value => {
    const present = [value.parentChatId, value.parentIncarnationId, value.parentMessageId, value.inheritedThroughSeq].filter(item => item != null).length;
    return present === 0 || present === 4 && value.parentChatId !== value.id;
  }, "Fork lineage must be complete and refer to another Chat");
export type PortableChat = z.infer<typeof portableChatSchema>;
export const executionPreparationReasonSchema = z.enum(["body-unavailable", "home-unavailable", "project-unbound", "identity-changed",
  "project-path-unbound", "project-unavailable", "chat-home-unavailable", "permission-required", "executor-changed", "chat-incarnation-mismatch"]);
export const cloudChatHeadSchema = z.object({ chat: portableChatSchema,
  kind: z.enum(["native", "external-readonly", "external-managed"]), archivedAt: rev.nullable(),
  executorDeviceId: id.nullable(), executionEpoch: rev, lastCommittedExecutorDeviceId: id.nullable(), nativeSessionDeviceId: id.nullable(),
  executionPreparation: z.object({ deviceId: id, executionEpoch: rev, state: z.enum(["pending", "ready", "blocked"]),
    reason: executionPreparationReasonSchema.nullable() }).strict().nullable(),
  pendingExecutor: z.object({ deviceId: id, sourceDeviceId: id, operationId: id, executionEpoch: rev,
    protocolVersion: rev, requestedAt: rev, snapshotRequired: z.boolean(), allowStaleSnapshot: z.boolean() }).strict().nullable().optional(),
  lastExecutorTransition: z.object({ previousDeviceId: id.nullable(), deviceId: id, executionEpoch: rev,
    throughSeq: rev, staleSnapshot: z.boolean() }).strict().nullable().optional(),
  queue: acceptedQueueSchema.optional(),
  activity: z.enum(["idle", "running", "waiting", "unknown", "saving", "done", "failed"]).optional(),
  activityTurn: z.object({ turnId: id, executorDeviceId: id, executionEpoch: rev, sequence: rev, startedAt: rev, settledAt: rev.nullable(),
    terminal: z.enum(["done", "error", "cancelled", "interrupted"]).nullable() }).strict().optional(),
  headSeq: rev, reservedThroughSeq: rev, openTurnId: id.nullable(),
  homeSnapshotId: id.nullable(), homeBytes: rev, homeState: z.enum(["none", "synced", "pending", "partial"]),
  sourceDeviceId: id, catalogRevision: rev, bodyRevision: rev,
}).strict().refine(value => value.reservedThroughSeq >= value.headSeq &&
  (!value.executionPreparation || value.executionPreparation.deviceId === value.executorDeviceId && value.executionPreparation.executionEpoch === value.executionEpoch));
export type CloudChatHead = z.infer<typeof cloudChatHeadSchema>;
