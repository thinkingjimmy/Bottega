/**
 * [INPUT]: Depends on closed protocol identities, portable Agent options and canonical content hashing.
 * [OUTPUT]: Provides bounded remote commands (including catalog-backed model, effort and speed choices), execution evidence, target capabilities with each Agent's model catalog, and content-free deleted creation receipts.
 * [POS]: Shared remote control boundary; local sessions, paths, grants and execution recovery have no command representation.
 */
import { queueControlSchemas } from "./queue";
import { z } from "zod";
import { cloudIdSchema as id, deviceNameSchema, devicePlatformSchema, lastSeenReasonSchema } from "../auth";
import { protocolHeaderSchema } from "../config";
import { versionSchema as rev } from "../scalars";
import { sha256Schema } from "../blobs";
import { agentBackendIdSchema, turnOptionsSchema, turnOptionValueSchema } from "../chats/options";
import { cloudChatHeadSchema } from "../chats/model";
import { MESSAGE_BYTE_LIMIT } from "../chats/content/budgets";
import { utf8Length } from "../chats/content/parts";
import { hashChatContent } from "../chats/transcript/body";
import { remoteAttachmentsSchema, remotePermissionModeSchema, remoteFullAccessConsentSchema, remoteComposerCapabilitiesSchema } from "./input/model";
import { remoteReferencesSchema, remoteFileReferenceSchema, remoteWorkspaceOutputSchema } from "./input/references";
import { agentUsageLimitsSchema } from "./quota";
export const REMOTE_LIMITS = Object.freeze({ pageRows: 20, textBytes: MESSAGE_BYTE_LIMIT, startTtlMs: 120_000, actionTtlMs: 60_000, intentTtlMs: 30 * 60_000,
  requestWindowMs: 60_000, workRequestsPerDevice: 60, controlRequestsPerDevice: 120,
  unfinishedWorkPerTarget: 32, unfinishedControlsPerTarget: 16 });
export const remoteReasonSchema = z.enum(["remote-disabled", "protocol-mismatch", "device-offline", "device-revoked", "source-revoked",
  "executor-changed", "chat-incarnation-mismatch", "chat-not-executable", "execution-not-ready", "project-path-unbound", "project-unavailable",
  "chat-home-unavailable", "permission-required", "agent-missing", "agent-outdated", "auth-required", "agent-unavailable", "agent-revision-changed", "fact-revision-changed", "local-facts-pending",
  "request-not-active", "interaction-expired", "command-expired", "connection-changed", "capacity-exceeded", "admission-failed", "execution-failed", "outcome-unknown",
  "target-changed", "agent-changed", "already-dispatched", "body-unavailable", "identity-changed", "attachment-unavailable", "attachment-invalid", "input-unsupported", "fork-failed", "revision-stale", "revision-busy", "reference-target-changed", "workspace-changed", "workspace-file-unavailable", "workspace-text-unavailable", "skill-unavailable", "queue-changed"]);
export type RemoteReason = z.infer<typeof remoteReasonSchema>;
export const remoteApprovalDecisionSchema = z.union([z.enum(["accept", "accept-for-session", "decline"]), z.string().regex(/^choice:(?:0|[1-9][0-9]{0,5})$/)]);
export const remoteTurnOptionsSchema = z.object({ model: turnOptionValueSchema.optional(), reasoningEffort: turnOptionValueSchema.optional(), serviceTier: turnOptionValueSchema.optional() }).strict()
  .refine(value => value.model !== undefined || value.reasoningEffort !== undefined || value.serviceTier !== undefined, "remote-turn-options-empty");
export type RemoteTurnOptions = z.infer<typeof remoteTurnOptionsSchema>;
const remoteModelEffortSchema = z.object({ id: turnOptionValueSchema, displayName: z.string().min(1).max(200) }).strict();
export const remoteModelSchema = z.object({ slug: turnOptionValueSchema, displayName: z.string().min(1).max(200), isDefault: z.boolean(),
  defaultReasoningEffort: turnOptionValueSchema.optional(), supportedReasoningEfforts: z.array(remoteModelEffortSchema).max(16).optional(),
  serviceTiers: z.array(remoteModelEffortSchema).max(16).optional() }).strict();
export const remoteModelsSchema = z.array(remoteModelSchema).max(64).refine(value => new Set(value.map(item => item.slug)).size === value.length, "remote-models-duplicate");
export type RemoteModel = z.infer<typeof remoteModelSchema>;
const text = z.string().refine(value => utf8Length(value) <= REMOTE_LIMITS.textBytes && ![...value].some(char => /\p{Cc}/u.test(char) && !["\t", "\r", "\n"].includes(char)), "remote-text-budget");
const itemId = z.string().min(1).max(256);
export const remotePayloadSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.enum(["start-turn", "edit-message", "retry-authentication"]), text, expectedAgentRevision: rev,
    revision: z.object({ supersedesUserMessageId: id, throughSeqEnd: rev.positive() }).strict().optional(),
    attachments: remoteAttachmentsSchema.optional(), references: remoteReferencesSchema.optional(), permissionMode: remotePermissionModeSchema.optional(), planMode: z.boolean().optional(),
    fullAccessConsent: remoteFullAccessConsentSchema.optional(),
    agentSelection: z.object({ backend: agentBackendIdSchema, expectedFactRevision: rev }).strict().optional(),
    // A model chosen from the executor's published catalog; the executor applies and persists it like a native selection.
    options: remoteTurnOptionsSchema.optional() }).strict(),
  ...queueControlSchemas,
  z.object({ kind: z.literal("list-workspace-files"), query: z.string().max(256) }).strict(),
  z.object({ kind: z.literal("read-workspace-file"), reference: remoteFileReferenceSchema }).strict(),
  z.object({ kind: z.literal("fork-chat"), fromMessageId: id, execution: z.enum(["same-workspace", "managed-worktree"]), checkOnly: z.literal(true).optional() }).strict(),
  z.object({ kind: z.literal("cancel"), requestId: itemId }).strict(),
  z.object({ kind: z.literal("retry-without-session"), requestId: itemId, retryToken: itemId, generation: rev.positive() }).strict(),
  z.object({ kind: z.literal("retry-same-session"), requestId: itemId, retryToken: itemId, generation: rev.positive() }).strict(),
  z.object({ kind: z.literal("abandon-fatal-turn"), requestId: itemId, retryToken: itemId, generation: rev.positive() }).strict(),
  z.object({ kind: z.literal("steer"), requestId: itemId, text, attachments: remoteAttachmentsSchema.optional(), references: remoteReferencesSchema.optional() }).strict(),
  z.object({ kind: z.literal("respond-approval"), requestId: itemId, approvalId: itemId, decision: remoteApprovalDecisionSchema }).strict(),
  z.object({ kind: z.literal("respond-user-input"), requestId: itemId, userInputId: itemId,
    answers: z.record(itemId, z.object({ answers: z.array(z.string().max(MESSAGE_BYTE_LIMIT)).max(50) }).strict())
      .refine(value => Object.keys(value).length <= 20 && utf8Length(JSON.stringify(value)) <= MESSAGE_BYTE_LIMIT, "remote-answer-budget") }).strict(),
]).refine(value => !("revision" in value) && value.kind !== "edit-message" || (value.kind === "edit-message") === Boolean("revision" in value && value.revision), "remote-revision-required")
.refine(value => !("text" in value) || Boolean(value.text.trim() || value.attachments?.length || value.references?.length), "remote-input-empty");
export const remoteCommandInputSchema = z.object({ commandId: id, chatId: id, incarnationId: id, targetDeviceId: id,
  executionEpoch: rev, intent: z.object({ baselineAgent: agentBackendIdSchema }).strict().optional(), payload: remotePayloadSchema }).strict();
export type RemoteCommandInput = z.infer<typeof remoteCommandInputSchema>;
export const isRemoteTurnKind = (kind: string) => ["start-turn", "edit-message", "retry-authentication"].includes(kind);
export function isRemoteTurnPayload(payload: RemoteCommandInput["payload"]): payload is Extract<RemoteCommandInput["payload"], { expectedAgentRevision: number }> {
  return isRemoteTurnKind(payload.kind);
}
export const remoteOriginSchema = z.object({ deviceId: id, name: deviceNameSchema }).strict();
export const remoteCommandSchema = remoteCommandInputSchema.extend({ ...protocolHeaderSchema.shape,
  sourceDeviceId: id, sourceDeviceName: deviceNameSchema, payloadHash: sha256Schema, ciphertextHash: sha256Schema, connectionEpoch: id, createdAt: rev, expiresAt: rev }).strict();
export type RemoteCommand = z.infer<typeof remoteCommandSchema>;
export function hashRemoteCommand(value: Omit<RemoteCommand, "payloadHash" | "createdAt" | "expiresAt" | "sourceDeviceName" | "ciphertextHash" | "connectionEpoch">) {
  const { environmentId, deploymentId, protocolVersion, sourceDeviceId } = value;
  return hashChatContent({ ...remoteIntentIdentity(value), environmentId, deploymentId, protocolVersion, sourceDeviceId });
}
export function remoteIntentIdentity(value: RemoteCommandInput) {
  const { commandId, chatId, incarnationId, targetDeviceId, executionEpoch, intent, payload } = value;
  if (!intent || payload.kind !== "start-turn") return { commandId, chatId, incarnationId, targetDeviceId, executionEpoch, payload };
  const { expectedAgentRevision: _revision, agentSelection, fullAccessConsent, ...choice } = payload;
  return { commandId, chatId, incarnationId, targetDeviceId, intent, payload: { ...choice,
    ...(agentSelection ? { agentSelection: { backend: agentSelection.backend } } : {}),
    ...(fullAccessConsent ? { fullAccessConsent: { userId: fullAccessConsent.userId, sourceDeviceId: fullAccessConsent.sourceDeviceId,
      chatId: fullAccessConsent.chatId, incarnationId: fullAccessConsent.incarnationId, intentId: commandId, intendedTargetDeviceId: targetDeviceId, version: 2 as const } } : {}) } };
}
const remoteAdmissionSchema = z.object({ intentId: id, submissionHash: sha256Schema, requestId: itemId, userMessageId: id.nullable() }).strict();
export type RemoteAdmission = z.infer<typeof remoteAdmissionSchema>;
export const remoteStateSchema = z.enum(["awaiting-preparation", "awaiting-executor", "delivered", "pending", "claimed", "accepted", "running", "done", "cancelled", "error", "outcome-unknown", "expired", "rejected"]);
export const remoteBlockedBySchema = z.enum(["relay-queue", "chain-paused", "app-transition"]);
export const remoteOutputSchema = z.discriminatedUnion("kind", [
  remoteWorkspaceOutputSchema,
  z.object({ kind: z.literal("queue-withdrawal"), unpersisted: z.literal(true) }).strict(),
  z.object({ kind: z.literal("fork-chat"), chatId: id, incarnationId: id }).strict(),
  z.object({ kind: z.literal("fork-preflight"), worktree: z.object({ supported: z.boolean(), dirty: z.object({
    staged: z.boolean(), unstaged: z.boolean(), untracked: z.boolean(), ignored: z.boolean() }).strict() }).strict().optional() }).strict(),
  z.object({ kind: z.literal("fork-error"), code: z.enum(["CHAT_FORK_ANCHOR_INELIGIBLE", "CHAT_FORK_PREFIX_HAS_NO_USER", "CHAT_FORK_SOURCE_STALE",
    "CHAT_FORK_SOURCE_INELIGIBLE", "CHAT_FORK_PREFIX_TOO_LARGE", "CHAT_FORK_SOURCE_MISSING", "CHAT_FORK_SOURCE_PROJECT_CHANGED", "PROJECT_UNAVAILABLE",
    "CHAT_FORK_REQUEST_CONFLICT", "CHAT_FORK_CHILD_EXISTS", "CHAT_FORK_HOME_RECOVERY_REQUIRED", "GIT_SANDBOX_UNAVAILABLE", "WORKTREE_NOT_GIT_REPOSITORY",
    "WORKTREE_NOT_GIT_ROOT", "WORKTREE_NO_HEAD", "GIT_BARE_REPOSITORY", "GIT_OPERATION_IN_PROGRESS", "GIT_SUBMODULE_UNSUPPORTED", "GIT_TREE_SCAN_TRUNCATED",
    "GIT_CONFIG_FILTER_DRIVER", "GIT_CONFIG_EXTERNAL_FSMONITOR", "GIT_CONFIG_ALTERNATE_REFS_COMMAND", "WORKTREE_BRANCH_EXISTS", "WORKTREE_PATH_CONFLICT",
    "WORKTREE_IDENTITY_MISMATCH", "GIT_IDENTITY_DRIFT", "CHAT_FORK_FAILED"]) }).strict(),
]);
export type RemoteOutput = z.infer<typeof remoteOutputSchema>;
export const remoteReceiptSchema = z.object({ command: remoteCommandSchema, state: remoteStateSchema,
  admission: remoteAdmissionSchema.nullable(), blockedBy: remoteBlockedBySchema.nullable(), withdrawalRequested: z.boolean().optional(), queueSequence: rev.optional(), reason: remoteReasonSchema.nullable(),
  result: z.enum(["applied", "already-resolved"]).nullable(), output: remoteOutputSchema.optional(), claimedAt: rev.nullable(), acceptedAt: rev.nullable(), updatedAt: rev }).strict();
export type RemoteCommandReceipt = z.infer<typeof remoteReceiptSchema>;
export const remoteReportSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("claimed"), noAdmission: z.literal(true) }).strict(),
  z.object({ state: z.literal("accepted"), admission: remoteAdmissionSchema, blockedBy: remoteBlockedBySchema.nullable() }).strict(),
  z.object({ state: z.literal("running"), admission: remoteAdmissionSchema }).strict(),
  z.object({ state: z.enum(["done", "cancelled", "error"]), admission: remoteAdmissionSchema,
    result: z.enum(["applied", "already-resolved"]).nullable(), output: remoteOutputSchema.optional(), reason: remoteReasonSchema.nullable() }).strict(),
  z.object({ state: z.literal("outcome-unknown"), admission: remoteAdmissionSchema.nullable(), reason: remoteReasonSchema }).strict(),
  z.object({ state: z.enum(["expired", "rejected"]), noAdmission: z.literal(true), reason: remoteReasonSchema }).strict(),
]);
export type RemoteCommandReport = z.infer<typeof remoteReportSchema>;
const remoteAgentCapabilitySchema = z.object({ backend: agentBackendIdSchema, available: z.boolean(), reason: remoteReasonSchema.nullable(),
  options: turnOptionsSchema.nullable(), capabilities: remoteComposerCapabilitiesSchema.optional(), models: remoteModelsSchema.optional(), quota: agentUsageLimitsSchema.optional() }).strict().refine(value => (!value.available || value.options !== null) &&
  (value.options === null || value.backend === value.options.backend), "remote-agent-options-invalid");
export const remoteAgentsSchema = z.array(remoteAgentCapabilitySchema).max(4).refine(value => new Set(value.map(item => item.backend)).size === value.length);
export type RemoteAgentCapability = z.infer<typeof remoteAgentCapabilitySchema>;
// A null Project binding means either no Project or pending local facts; reason distinguishes the pending state.
export const remoteTargetSchema = z.object({ deviceId: id, name: deviceNameSchema, platform: devicePlatformSchema,
  connectionEpoch: id.nullable().optional(),
  protocolVersion: rev, current: z.boolean(), online: z.boolean(), offlineAt: rev.nullable(), lastSeenReason: lastSeenReasonSchema.optional(), reason: remoteReasonSchema.nullable(),
  agents: remoteAgentsSchema, projectBound: z.boolean().nullable(), sessionContinuity: z.enum(["original-device", "new-session"]),
  homeBytes: rev, homeState: cloudChatHeadSchema.shape.homeState }).strict();
export type RemoteTarget = z.infer<typeof remoteTargetSchema>;
export const remoteTargetsSchema = z.object({ items: z.array(remoteTargetSchema).max(REMOTE_LIMITS.pageRows), cursor: z.string().nullable(), complete: z.boolean(),
  sourceDeviceId: id, sourceProtocolVersion: rev, remoteControlEnabled: z.boolean(), preferredDeviceId: id.nullable(), serverTime: rev }).strict();
export type RemoteTargets = z.infer<typeof remoteTargetsSchema>;
export const remoteCreationReceiptSchema = z.object({ createOperationId: id, payloadHash: sha256Schema.nullable(), chatId: id, incarnationId: id,
  executorDeviceId: id, executionEpoch: rev, createdAt: rev, deleted: z.boolean() }).strict()
  .refine(value => value.deleted === (value.payloadHash === null));
export type RemoteCreationReceipt = z.infer<typeof remoteCreationReceiptSchema>;
