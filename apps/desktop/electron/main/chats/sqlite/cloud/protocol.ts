/**
 * [INPUT]: Depends on strict portable storage contracts and the canonical Chat codecs.
 * [OUTPUT]: Provides closed cloud actions and bounded results, including the persisted mirror sequence watermark.
 * [POS]: Local synchronization seam; fake transports are test-owned and never bundled here.
 */
import { z } from "zod";
import { chatFactsSchema, chatRecordSchema, messageSchema, subagentsSchema } from "../../chat-schema";
import {
  classificationSchema, logicalBlobSchema, portableChatSchema, storageHashSchema,
  storageIdSchema, storageRevisionSchema, syncScopeSchema, turnReceiptSchema,
} from "../../../../../shared/local-storage/contracts";

const id = storageIdSchema;
const rev = storageRevisionSchema;
const hash = storageHashSchema;
const outboxId = z.string().min(1).max(384);
const messages = z.array(messageSchema).max(2000);
const attemptEvidence = z.object({ attemptNo: rev.positive(), epoch: rev, requestId: id,
  phase: z.enum(["claimed", "dispatching", "unknown", "dispatched", "result-prepared", "persisted", "failed"]),
  updatedAt: rev, receiptAt: rev.optional() }).strict();
const evidence = z.object({
  phase: z.literal("committed"), chatId: id, incarnationId: id,
  intentId: id, homeDir: z.string().min(1).max(4096), projectId: id.nullable(),
}).strict();
export const cloudActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("capture-initial"), manifestId: id }).strict(),
  z.object({ type: z.literal("put-mirror"), chat: portableChatSchema, messages, subagents: subagentsSchema }).strict(),
  z.object({ type: z.literal("prepare-materialization"), chatId: id, expectedCloudRevision: rev, evidence }).strict(),
  z.object({ type: z.literal("materialize"), expectedCloudRevision: rev, record: chatRecordSchema }).strict(),
  z.object({ type: z.literal("settle-turn"), receipt: turnReceiptSchema, message: messageSchema.nullable(), cursor: id }).strict(),
  z.object({ type: z.literal("propose-classification"), lifecycleOperationId: id, expectedRevision: rev,
    previous: classificationSchema, facts: chatFactsSchema }).strict(),
  z.object({ type: z.literal("confirm-classification"), lifecycleOperationId: id,
    receipt: z.object({ lifecycleOperationId: id, candidateHash: hash, expectedCloudRevision: rev,
      cloudRevision: rev, outcome: z.enum(["applied", "conflicted"]) }).strict() }).strict(),
  z.object({ type: z.literal("commit-classification"), lifecycleOperationId: id }).strict(),
  z.object({ type: z.literal("repair-classification"), chatId: id, deviceId: id, expectedRevision: rev }).strict(),
  z.object({ type: z.literal("archive-deletion"), chatId: id, expectedIncarnationId: id }).strict(),
  z.object({ type: z.literal("handoff-turn"), chatId: id, turnId: id, executionEpoch: rev,
    evidence: z.object({ ledgerIntentId: id, identityHash: hash, dispatch: z.enum(["dispatched", "not-started", "outcome-unknown"]),
      attempt: attemptEvidence, executorNoticeSeq: rev.positive().optional(), noticeSeq: rev.positive().optional(),
      userMessageId: id, userSeq: rev.positive(), userMessage: messageSchema, assistantMessageId: id, assistantSeq: rev.positive(),
      resultKind: z.enum(["message", "empty"]), resultHash: hash, resultMessage: messageSchema.nullable(),
    }).strict() }).strict(),
  z.object({ type: z.literal("attempt-outbox"), id: outboxId, payloadDigest: hash, error: z.string().max(1024).nullable() }).strict(),
  z.object({ type: z.literal("ack-outbox"), id: outboxId, payloadDigest: hash }).strict(),
  z.object({ type: z.literal("cache-blob"), blob: logicalBlobSchema, localPath: z.string().min(1).max(4096) }).strict(),
  z.object({ type: z.literal("cleanup-scope"), retainedChatIds: z.array(id).max(10000) }).strict(),
]);
export type CloudAction = z.infer<typeof cloudActionSchema>;
export const cloudQuerySchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("state") }).strict(),
  z.object({ type: z.literal("mirror"), chatId: id, afterSeq: rev, limit: rev.positive().max(100) }).strict(),
  z.object({ type: z.literal("outbox"), afterId: outboxId.nullable(), limit: rev.positive().max(100) }).strict(),
  z.object({ type: z.literal("source"), sourceId: id }).strict(),
  z.object({ type: z.literal("source-blob"), sourceId: id, sha256: hash, offset: rev, length: rev.positive().max(128 * 1024) }).strict(),
  z.object({ type: z.literal("turn-receipt"), turnId: id }).strict(),
  z.object({ type: z.literal("classification"), lifecycleOperationId: id }).strict(),
  z.object({ type: z.literal("custody"), chatId: id }).strict(),
]);
export type CloudQuery = z.infer<typeof cloudQuerySchema>;
export const cloudMutationSchema = z.object({
  kind: z.literal("cloud-mutate"), operationId: id, requestHash: hash,
  deviceId: id, scope: syncScopeSchema.nullable(), action: cloudActionSchema,
}).strict();
export const cloudReadSchema = z.object({
  kind: z.literal("cloud-read"), deviceId: id, scope: syncScopeSchema.nullable(), query: cloudQuerySchema,
}).strict();
export type CloudMutation = z.infer<typeof cloudMutationSchema>;
export type CloudRead = z.infer<typeof cloudReadSchema>;
const jsonText = z.string().max(4 * 1024 * 1024).refine(value => { try { JSON.parse(value); return true; } catch { return false; } });
const sourceRef = z.object({ sourceId: id, digest: hash }).strict();
const classificationState = z.enum(["pending", "conflicted", "confirmed", "committed"]);
const mirrorValue = z.object({ chat: portableChatSchema, nextSeq: rev.positive(), messages, subagents: subagentsSchema, executable: z.literal(false), preparation: evidence.nullable() }).strict().nullable();
const custodyRow = z.object({ operation_id: z.string().min(1).max(384), chat_id: id, incarnation_id: id,
  classification_json: jsonText, source_ids_json: jsonText, created_at: rev }).strict();
const candidateRow = z.object({ operation_id: id, chat_id: id, environment: id.nullable(), user_id: id.nullable(), expected_revision: rev,
  old_classification_json: jsonText, candidate_json: jsonText, candidate_hash: hash, receipt_json: jsonText.nullable(), state: classificationState }).strict();
const outboxRow = z.object({ id: z.string().min(1).max(384), environment: id, user_id: id,
  entity_kind: z.enum(["chat", "message", "turn", "attachment", "generation", "home-snapshot", "tombstone"]), entity_id: id,
  kind: z.string().min(1).max(128), seq_or_revision: rev, execution_epoch: rev.nullable(), payload_json: jsonText,
  payload_digest: hash, created_at: rev, attempts: rev, last_error: z.string().max(1024).nullable() }).strict();
const result = <T extends string, V extends z.ZodType>(type: T, value: V) => z.object({ type: z.literal(type), value }).strict();
export const cloudResultSchema = z.discriminatedUnion("type", [
  result("capture-initial", z.object({ version: z.literal(1), manifestId: id, scope: syncScopeSchema, capturedAt: rev, state: z.literal("captured"),
    entries: z.array(sourceRef.extend({ chatId: id, revision: rev })).max(10000) }).strict()),
  result("put-mirror", z.object({ chatId: id, cloudRevision: rev, count: rev }).strict()),
  result("prepare-materialization", z.object({ chatId: id, prepared: z.literal(true) }).strict()),
  result("materialize", z.object({ chatId: id, materialized: z.literal(true) }).strict()),
  result("settle-turn", z.object({ chatId: id, settled: z.boolean() }).strict()),
  result("propose-classification", z.object({ lifecycleOperationId: id, candidateHash: hash, state: classificationState }).strict()),
  result("confirm-classification", z.object({ state: classificationState }).strict()),
  result("commit-classification", z.object({ chatId: id, state: z.literal("committed") }).strict()),
  result("repair-classification", z.object({ chatId: id, repaired: z.literal(true) }).strict()),
  result("archive-deletion", z.object({ chatId: id, sourceIds: z.array(id).min(1) }).strict()),
  result("handoff-turn", sourceRef),
  result("attempt-outbox", z.object({ id: z.string().min(1).max(384) }).strict()),
  result("ack-outbox", z.object({ id: z.string().min(1).max(384) }).strict()),
  result("cache-blob", z.object({ blobId: logicalBlobSchema.shape.blobId }).strict()),
  result("cleanup-scope", z.object({ cleaned: z.literal(true), retainedChatIds: z.array(id) }).strict()),
  result("state", z.union([z.object({ scopes: rev, outbox: rev, receipts: rev }).strict(), z.object({ environment: id, user_id: id,
    initial_manifest_json: jsonText.nullable(), meta_cursor: z.string().nullable(), body_backfill_cursor: z.string().nullable(),
    paused: z.union([z.literal(0), z.literal(1)]), updated_at: rev }).strict(), z.null()])),
  result("mirror", mirrorValue), result("outbox", z.array(outboxRow).max(100)),
  result("source", sourceRef.extend({ payload: z.json() }).strict().nullable()), result("turn-receipt", turnReceiptSchema.nullable()),
  result("source-blob", z.object({ sha256: hash, bytes: rev, offset: rev, data: z.string().max(180000), eof: z.boolean() }).strict()),
  result("classification", candidateRow.nullable()), result("custody", z.array(custodyRow)),
]);
export type CloudResult = z.infer<typeof cloudResultSchema>;
export function handoffIdentity(action: Extract<CloudAction, { type: "handoff-turn" }>) {
  const evidence = action.evidence;
  return { chatId: action.chatId, turnId: action.turnId, executionEpoch: action.executionEpoch,
    userMessageId: evidence.userMessageId, assistantMessageId: evidence.assistantMessageId,
    executorNoticeSeq: evidence.executorNoticeSeq, noticeSeq: evidence.noticeSeq, userSeq: evidence.userSeq, assistantSeq: evidence.assistantSeq };
}
export function boundedCloudValue<T>(value: T): T {
  if (Buffer.byteLength(JSON.stringify(value), "utf8") > 4 * 1024 * 1024) {
    throw new Error("Local synchronization command exceeds 4 MiB");
  }
  return value;
}
