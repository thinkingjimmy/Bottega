/**
 * [INPUT]: Depends on Zod, the encryption scalars and purpose limits, the encrypted-space schema, the BaseRef resource contract and the workflow run, binding and recipe contracts.
 * [OUTPUT]: Provides WORKFLOW_PROJECTION_LIMITS, the sealed bodies (run projection, a computer's attention page of NeedsYou items, binding projection), the encrypted records with their plaintext headers, the per-row run header, the R-34 attention push target and the record-free receipt.
 * [POS]: Workflow projection domain model (protocol 13, purposes 12 / 13, §10.2 / §10.2a): what a phone or Web may learn about the owner desktop's workflows. Only the owner desktop writes; nothing here can start, decide or change a run (that is R-24).
 */
import { z } from "zod";
import { digest, id, version } from "../encryption/domains/scalars";
import { PLAINTEXT_LIMITS } from "../encryption/limits";
import { encryptedSpaceSchema } from "../spaces";
import { cloudIdSchema } from "../auth";
import { baseRefSchema } from "../contracts/resources";
import { BINDING_REASONS } from "../contracts/base/binding";
import { BINDING_STATES } from "../contracts/workflow/binding";
import { WORKFLOW_ROLES } from "../contracts/workflow/recipe";
import { attemptSchema, blockedReasonSchema, BUSINESS_OUTCOMES, confirmationSchema, pauseReasonSchema, RUN_STATES, STEP_STATES } from "../contracts/workflow/run";

const packet = (plaintextBytes: number) => {
  const envelopeBytes = Math.ceil(plaintextBytes * 4 / 3) + 8_192;
  return { envelopeBytes, packetChars: Math.ceil(envelopeBytes * 4 / 3) };
};
const run = packet(PLAINTEXT_LIMITS[12]), binding = packet(PLAINTEXT_LIMITS[13]);
export const WORKFLOW_PROJECTION_LIMITS = Object.freeze({
  runPlaintextBytes: PLAINTEXT_LIMITS[12], runEnvelopeBytes: run.envelopeBytes, runPacketChars: run.packetChars,
  bindingPlaintextBytes: PLAINTEXT_LIMITS[13], bindingEnvelopeBytes: binding.envelopeBytes, bindingPacketChars: binding.packetChars,
  /** A report's result on a phone, in UTF-8 bytes (A2-05); the whole text stays in the step's Chat (`chatRef`). */
  resultBytes: 4_096,
  attentionItems: 50, pendingCount: 1_000, rowsPerRead: 50, runsPerProject: 200, bindingsPerProject: 100,
  /** One attention row per desktop: a phone reads them all in one query. */
  attentionRows: 16,
  /** The owner desktop's outbox: one write per run per second, a state change at once. */
  runWriteIntervalMs: 1_000,
});
const role = z.enum(WORKFLOW_ROLES);
const packetSchema = (limits: { envelopeBytes: number; packetChars: number }) => z.object({
  envelope: z.string().min(1).max(limits.packetChars).regex(/^[A-Za-z0-9_-]+$/), ciphertextHash: digest,
  ciphertextBytes: version.positive().max(limits.envelopeBytes) }).strict();
const recordRef = z.object({ base: baseRefSchema, rowId: id }).strict();

/* ---- Run projection (sealed, ≤ 64 KiB): the run contract minus configurations, inputs, process groups and request ids. ---- */
export const projectedEvidenceSchema = z.object({ commit: z.string().max(128).nullable(), changedCount: version,
  diffState: z.enum(["included", "partial", "too-large", "none"]).nullable(), commandsRecorded: version.nullable() }).strict();
/** An agent step's output: the result (cut to 4 KiB of UTF-8 at a code-point boundary, whole in `chatRef`) and, after development, what the host recorded. */
export const utf8Bytes = (value: string) => new TextEncoder().encode(value).byteLength;
export const projectedReportSchema = z.object({ result: z.string().refine(value => utf8Bytes(value) <= WORKFLOW_PROJECTION_LIMITS.resultBytes, "result over its byte budget"), resultTruncated: z.literal(true).optional(),
  chatRef: id.optional(), evidence: projectedEvidenceSchema.optional() }).strict();
const projectedAttemptSchema = attemptSchema.pick({ outcome: true, intentAt: true, settledAt: true, detail: true, reportDerived: true }).strict();
const projectedStepSchema = z.object({ stepId: id, state: z.enum(STEP_STATES), blockedReason: blockedReasonSchema.nullable(),
  attempts: z.array(projectedAttemptSchema).max(16),
  /** An agent step's projected report; any other step's output as JSON with every string cut to 4 KiB (`outputTruncated`). */
  output: z.json().nullable() }).strict();
export const workflowRunProjectionSchema = z.object({
  runId: id, bindingId: id, record: recordRef,
  recipe: z.object({ recipeId: z.string().min(1).max(64), version: version.positive(),
    steps: z.array(z.object({ id, kind: z.enum(["agent.run", "app.call", "human.confirm"]), role: role.optional(), label: z.string().min(1).max(120) }).strict()).max(32) }).strict(),
  state: z.enum(RUN_STATES), pauseRequested: z.boolean(), pauseReason: pauseReasonSchema.nullable(),
  steps: z.array(projectedStepSchema).max(32), confirmations: z.array(confirmationSchema).max(32),
  businessOutcome: z.enum(BUSINESS_OUTCOMES).nullable(), cancelRequestedAt: version.nullable(), forcedStop: z.boolean(),
  forceStopUnconfirmedAt: version.nullable(), workspaceWait: z.object({ heldByRunId: id, since: version }).strict().nullable(),
  blockedReason: blockedReasonSchema.nullable(), createdAt: version, updatedAt: version, revision: version,
  /** The workflow Chat of each role, opened by id from the run (R-35 keeps them out of every list). */
  chats: z.object({ plan: id.optional(), develop: id.optional(), review: id.optional() }).strict(),
}).strict();
export type WorkflowRunProjection = z.infer<typeof workflowRunProjectionSchema>;
/**
 * The plaintext header: `baseId` is the Base's random ownerInstanceId, `rowId` the record's random id (correction C). `startedAt` is
 * the run's own start time (C2-05), sealed in the body as `createdAt` and fixed for the run's life: it orders a row's runs and a
 * Project's retention, whatever order they reach the server in.
 */
const runHeader = { runId: id, ownerDeviceId: id, projectId: id, baseId: id, rowId: id, revision: version.positive(), state: z.enum(RUN_STATES), startedAt: version };
export const encryptedWorkflowRunSchema = z.object({ ...runHeader, operationId: id, encryptedSpace: encryptedSpaceSchema,
  packet: packetSchema(run) }).strict();
export type EncryptedWorkflowRun = z.infer<typeof encryptedWorkflowRunSchema>;
export const workflowRunHeaderSchema = z.object({ ...runHeader, updatedAt: version, ciphertextHash: digest, plaintextBytes: version }).strict();
export type WorkflowRunHeader = z.infer<typeof workflowRunHeaderSchema>;

/* ---- Attention (sealed page per desktop, ≤ 50 items, newest first). ---- */
export const needsYouItemSchema = z.object({ runId: id, bindingId: id, projectId: id, record: recordRef, recordTitle: z.string().max(200).nullable(),
  kind: z.enum(["confirm-plan", "confirm-result", "paused", "result-unknown", "agent-waiting"]), role: role.optional(), chatId: id.optional(), since: version,
}).strict().refine(value => (value.kind === "agent-waiting") === (value.role !== undefined && value.chatId !== undefined)
  && (value.role === undefined) === (value.chatId === undefined), "agent-waiting-needs-role-and-chat");
export type ProjectedNeedsYouItem = z.infer<typeof needsYouItemSchema>;
export const workflowAttentionPageSchema = z.object({ items: z.array(needsYouItemSchema).max(WORKFLOW_PROJECTION_LIMITS.attentionItems) }).strict();
export const encryptedWorkflowAttentionSchema = z.object({ ownerDeviceId: id, revision: version.positive(),
  pendingCount: version.max(WORKFLOW_PROJECTION_LIMITS.pendingCount), operationId: id, encryptedSpace: encryptedSpaceSchema, packet: packetSchema(run) }).strict();
export type EncryptedWorkflowAttention = z.infer<typeof encryptedWorkflowAttentionSchema>;
/**
 * R-34: what a new attention item's push opens. Opaque ids and closed enums only (push data is visible to the push service).
 * `itemId` names the item for deduplication; a confirmation pushes once per `reminder`, every other item once.
 */
export const workflowPushTargetSchema = z.discriminatedUnion("targetKind", [
  z.object({ targetKind: z.literal("needs-you") }).strict(),
  z.object({ targetKind: z.literal("confirmation"), runId: cloudIdSchema, stepId: cloudIdSchema }).strict(),
  z.object({ targetKind: z.literal("agent-waiting"), runId: cloudIdSchema, stepId: cloudIdSchema, role, chatId: cloudIdSchema }).strict(),
]);
export type WorkflowPushTarget = z.infer<typeof workflowPushTargetSchema>;
export const workflowAttentionPushSchema = z.object({ itemId: id, reminder: z.enum(["started", "final-hour"]).nullable(), target: workflowPushTargetSchema }).strict();
export type WorkflowAttentionPush = z.infer<typeof workflowAttentionPushSchema>;

/* ---- Binding projection (read-only, sealed ≤ 8 KiB): what a phone needs to start a run on a record. ---- */
/* `baseId` and `suspendedReason` are sealed as well as shown in the header: the frozen AAD does not bind them, so the reader
   compares the two (correction before deploy, §10 implementation notes). */
export const workflowBindingProjectionSchema = z.object({
  baseId: id, suspendedReason: z.enum(BINDING_REASONS).nullable(),
  recipe: z.object({ recipeId: z.string().min(1).max(64), version: version.positive() }).strict(),
  roles: z.object({ plan: z.object({ configId: id, configName: z.string().max(120) }).strict(), develop: z.object({ configId: id, configName: z.string().max(120) }).strict(),
    review: z.object({ configId: id, configName: z.string().max(120) }).strict() }).strict(),
  taskNameColumnId: id, stageColumnId: id, acceptanceCriteriaColumnId: id }).strict();
export type WorkflowBindingProjection = z.infer<typeof workflowBindingProjectionSchema>;
const bindingHeader = { bindingId: id, projectId: id, ownerDeviceId: id, baseId: id, state: z.enum(BINDING_STATES),
  suspendedReason: z.enum(BINDING_REASONS).nullable(), revision: version.positive() };
const suspendedHasReason = (value: { state: string; suspendedReason: string | null }) => (value.state === "suspended") === (value.suspendedReason !== null);
export const workflowBindingIdentitySchema = z.object({ ...bindingHeader, operationId: id }).strict().refine(suspendedHasReason, "suspended-needs-reason");
export const encryptedWorkflowBindingSchema = z.object({ ...bindingHeader, operationId: id, encryptedSpace: encryptedSpaceSchema, packet: packetSchema(binding) })
  .strict().refine(suspendedHasReason, "suspended-needs-reason");
export type EncryptedWorkflowBinding = z.infer<typeof encryptedWorkflowBindingSchema>;

/** Clearing a removed Project: one bounded page per call, repeated until `complete`. */
export const workflowProjectRemovalSchema = z.object({ removed: version, complete: z.boolean() }).strict();
export const workflowProjectionReceiptSchema = z.discriminatedUnion("status", [
  z.object({ operationId: id, status: z.literal("applied"), revision: version.positive() }).strict(),
  z.object({ operationId: id, status: z.literal("conflicted"), current: z.object({ revision: version.positive() }).strict().nullable() }).strict(),
]);
export type WorkflowProjectionReceipt = z.infer<typeof workflowProjectionReceiptSchema>;
