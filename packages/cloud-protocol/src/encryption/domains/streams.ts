/**
 * [INPUT]: Closed file, Home, turn and remote routing identities with ciphertext references.
 * [OUTPUT]: Stream bindings, pre-allocation Chat creation identity and immutable remote result linkage.
 * [POS]: Authenticated transport boundaries; these fields never confer execution or ownership authority.
 */
import { z } from "zod";
import { MAX_CHUNKS } from "../limits";
import { agent, digest, id, nullableId, version } from "./scalars";
export const fileBindingSchema = z.object({ ownerKind: z.enum(["chat", "project", "base", "app", "home", "message", "skill"]), ownerId: id,
  ownerGeneration: nullableId, manifestId: id, chunkIndex: version, chunkCount: version.positive().max(MAX_CHUNKS) }).strict().refine(value => value.chunkIndex < value.chunkCount);
export const homeBindingSchema = z.object({ role: z.enum(["manifest", "page"]), incarnationId: id, snapshotId: id, executionEpoch: version,
  throughSeq: version, expectedSnapshotId: nullableId, pageIndex: version.nullable(), pageCount: version.positive(), metadataCommitment: digest }).strict()
  .refine(value => value.role === "manifest" ? value.pageIndex === null : value.pageIndex !== null && value.pageIndex < value.pageCount);
export const turnBindingSchema = z.object({ incarnationId: id, turnId: id, executionEpoch: version, frameSequence: version,
  frameKind: z.enum(["event", "replacement", "final"]), snapshotId: nullableId, replacementIndex: version.nullable(), replacementCount: version.nullable() }).strict()
  .refine(value => value.frameKind === "replacement" ? value.snapshotId !== null && value.replacementIndex !== null && value.replacementCount !== null &&
    value.replacementCount > 0 && value.replacementCount <= 16_384 && value.replacementIndex < value.replacementCount :
    value.snapshotId === null && value.replacementIndex === null && value.replacementCount === null);
export const remoteCreationBindingSchema = z.object({ sourceDeviceId: id, targetDeviceId: id, connectionEpoch: id, agent,
  expectedAgentRevision: version, projectId: nullableId, protocolVersion: version.positive().max(65535), createdAt: version }).strict();
const remoteFields = { kind: z.enum(["withdraw-queued", "reorder-queue", "list-workspace-files", "read-workspace-file", "start-turn", "edit-message", "retry-authentication", "cancel", "steer", "respond-approval", "respond-user-input", "retry-without-session", "retry-same-session", "abandon-fatal-turn", "fork-chat"]),
  sourceDeviceId: id, targetDeviceId: id, chatId: id, incarnationId: id, executionEpoch: version, connectionEpoch: id,
  attachmentBlobIds: z.array(z.uuid()).max(8).refine(values => new Set(values).size === values.length).optional(),
  requestId: z.string().min(1).max(256).nullable(), protocolVersion: version.positive().max(65535), expectedAgentRevision: version, expectedChatVersion: version, expiresAt: version.positive() };
const requestMatches = (value: { kind: string; requestId: string | null; attachmentBlobIds?: string[] }) =>
  (["withdraw-queued", "reorder-queue", "list-workspace-files", "read-workspace-file", "start-turn", "edit-message", "retry-authentication", "fork-chat"].includes(value.kind)) === (value.requestId === null) &&
  (["start-turn", "edit-message", "retry-authentication", "steer"].includes(value.kind) || !value.attachmentBlobIds?.length);
export const remoteCommandBindingSchema = z.object(remoteFields).strict().refine(requestMatches);
export const remoteResultBindingSchema = z.object({ ...remoteFields, commandCiphertextHash: digest, resultRevision: version,
  state: z.enum(["pending", "claimed", "accepted", "running", "done", "cancelled", "error", "outcome-unknown", "expired", "rejected"]) }).strict().refine(requestMatches);

export const remoteIntentBindingSchema = z.object({ chatId: id, incarnationId: id, sourceDeviceId: id,
  intentId: id, intendedTargetDeviceId: id, intentExpiresAt: version.positive() }).strict();

export const remoteProjectQueryBindingSchema = z.object({ sourceDeviceId: id, targetDeviceId: id, projectId: id,
  connectionEpoch: id, protocolVersion: version.positive().max(65535), expiresAt: version.positive(), requestHash: digest.nullable() }).strict();
