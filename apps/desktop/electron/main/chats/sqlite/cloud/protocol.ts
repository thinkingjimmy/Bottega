/**
 * [INPUT]: Depends on strict portable storage contracts, canonical Chat codecs and outbox checkpoint identities.
 * [OUTPUT]: Defines scoped synchronization/removal commands, exact remote admission fact reads and bounded recovery queries.
 * [POS]: Local synchronization seam; fake transports are test-owned and never bundled here.
 */
import { z } from "zod";
import { chatClassificationReceiptSchema } from "@ai-chat/cloud-protocol/chats/classification";
import { basePromotionSchema } from "@ai-chat/cloud-protocol/apps/promotion";
import { chatDeletionViewSchema, chatDeletionRequestSchema, chatDeletionKeepSchema } from "../../../../../shared/cloud/deletion";
import { tombstoneSchema } from "@ai-chat/cloud-protocol/lifecycle/model";
import { deletionTargetSchema, chatRemovalStateSchema } from "./deletion/model";
import { chatCatalogPageSchema } from "@ai-chat/chat-ui/model";
import { recoveryArchiveSchema, recoveryArchivePageSchema } from "./recovery/contracts";
import { retainedCatalogSchema, retainedMetadataSchema } from "../../../../../shared/cloud/recovery";
import { chatInventorySchema } from "../../../../../shared/cloud/sync";
import { chatDeliveryCheckpointSchema, checkpointKeySchema, retainedSourceRefSchema } from "./delivery/contracts";
import { executionArchiveSchema, executionInstallSchema, executionInstallResultSchema } from "./execution/contracts";
import { prepareConvergenceSchema, commitConvergenceSchema, convergenceResultSchema } from "./convergence/contracts";
import { localExecutionStateSchema } from "./execution/state";
import { frozenRemoteChatInitializationSchema } from "@ai-chat/cloud-protocol/chats/encrypted";
import { remoteAdmissionStateSchema } from "./execution/remote";
import { chatMetadataLocalStateSchema, chatMetadataStatusSchema } from "./delivery/metadata-contracts";
import { chatFactsEditSchema, chatFactsDecisionSchema, chatFactsViewSchema } from "../../../../../shared/cloud/facts";
import { cloudChatHeadSchema } from "@ai-chat/cloud-protocol/chats/model";
import { chatBodySchema } from "@ai-chat/cloud-protocol/chats/transcript/body";
import { localTurnAdmissionSchema } from "./delivery/turns/model";
import { mirrorDeliveryActions, mirrorDownloadSchema, catalogCursorsSchema, mirrorFilesSchema } from "./mirror/contracts";
import { importDeliveryActions, importDownloadSchema, importPageSchema } from "./imported/contracts";
import { homeJobActions, homeJobSchema } from "./home/contracts";
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
  z.object({ type: z.literal("freeze-remote-initial"), initialization: frozenRemoteChatInitializationSchema }).strict(),
  chatDeletionRequestSchema.extend({ type: z.literal("request-chat-deletion") }),
  chatDeletionKeepSchema.extend({ type: z.literal("keep-chat-deletion") }),
  z.object({ type: z.literal("remove-cloud-mirror"), tombstone: tombstoneSchema }).strict(),
  z.object({ type: z.literal("retain-deleted-chat"), tombstone: tombstoneSchema, expectedRevision: rev, expectedMessageRevision: rev, expectedOutboxHash: hash,
    recovery: z.object({ archiveId: id.nullable(), childId: id.nullable() }).strict().optional() }).strict(),
  z.object({ type: z.literal("prepare-deleted-chat"), tombstone: tombstoneSchema, expectedRevision: rev, expectedMessageRevision: rev, expectedOutboxHash: hash }).strict(),
  ...mirrorDeliveryActions, ...importDeliveryActions, ...homeJobActions, executionInstallSchema, prepareConvergenceSchema, commitConvergenceSchema,
  z.object({ type: z.literal("capture-initial"), manifestId: id }).strict(),
  z.object({ type: z.literal("capture-live-turn"), sourceId: outboxId, payloadDigest: hash, admission: localTurnAdmissionSchema }).strict(),
  z.object({ type: z.literal("complete-initial-chat"), id: outboxId, payloadDigest: hash }).strict(),
  z.object({ type: z.literal("save-outbox-checkpoint"), id: outboxId, payloadDigest: hash, checkpoint: chatDeliveryCheckpointSchema }).strict(),
  z.object({ type: z.literal("accept-chat-head"), head: cloudChatHeadSchema }).strict(),
  chatFactsEditSchema.extend({ type: z.literal("edit-chat-metadata") }),
  chatFactsDecisionSchema.extend({ type: z.literal("resolve-chat-facts") }),
  z.object({ type: z.literal("resolve-chat-metadata"), decision: z.enum(["retry", "discard"]), head: cloudChatHeadSchema, expectedQueueHash: hash }).strict(),
  z.object({ type: z.literal("put-mirror"), chat: portableChatSchema, messages, subagents: subagentsSchema }).strict(),
  z.object({ type: z.literal("prepare-materialization"), chatId: id, expectedCloudRevision: rev, evidence }).strict(),
  z.object({ type: z.literal("materialize"), expectedCloudRevision: rev, record: chatRecordSchema }).strict(),
  z.object({ type: z.literal("settle-turn"), receipt: turnReceiptSchema, message: messageSchema.nullable(), subagents: subagentsSchema.optional(), files: mirrorFilesSchema.optional(), expectedMessageRevision: rev.optional(), expectedOutboxDigest: hash.optional(), deferReplacement: z.boolean().optional(), cursor: id }).strict(),
  z.object({ type: z.literal("propose-classification"), lifecycleOperationId: id, expectedRevision: rev,
    previous: classificationSchema, facts: chatFactsSchema, basePromotion: basePromotionSchema.optional(),
    projectRescue: z.object({ projectId: id }).strict().optional() }).strict(),
  z.object({ type: z.literal("confirm-classification"), lifecycleOperationId: id,
    receipt: chatClassificationReceiptSchema }).strict(),
  z.object({ type: z.literal("commit-classification"), lifecycleOperationId: id }).strict(),
  z.object({ type: z.literal("discard-classification"), lifecycleOperationId: id, candidateHash: hash }).strict(),
  z.object({ type: z.literal("repair-classification"), chatId: id, deviceId: id, expectedRevision: rev }).strict(),
  z.object({ type: z.literal("archive-deletion"), chatId: id, expectedIncarnationId: id }).strict(),
  z.object({ type: z.literal("handoff-turn"), chatId: id, turnId: id, executionEpoch: rev,
    evidence: z.object({ ledgerIntentId: id, identityHash: hash, dispatch: z.enum(["dispatched", "not-started", "outcome-unknown"]),
      attempt: attemptEvidence.nullable(), executorNoticeSeq: rev.positive().optional(), noticeSeq: rev.positive().optional(),
      userMessageId: id, userSeq: rev.positive(), userMessage: messageSchema, assistantMessageId: id, assistantSeq: rev.positive(),
      resultKind: z.enum(["message", "empty", "pending"]), resultHash: hash.nullable(), resultMessage: messageSchema.nullable(),
      terminal: z.enum(["done", "error", "cancelled"]).optional(), subagents: subagentsSchema.optional(),
    }).strict() }).strict(),
  z.object({ type: z.literal("attempt-outbox"), id: outboxId, payloadDigest: hash, error: z.string().max(1024).nullable() }).strict(),
  z.object({ type: z.literal("ack-outbox"), id: outboxId, payloadDigest: hash }).strict(),
  z.object({ type: z.literal("retire-covered-commit"), id: outboxId, payloadDigest: hash }).strict(),
  z.object({ type: z.literal("cache-blob"), blob: logicalBlobSchema, localPath: z.string().min(1).max(4096) }).strict(),
  z.object({ type: z.literal("cleanup-scope"), retainedChatIds: z.array(id).max(10000) }).strict(),
]);
export type CloudAction = z.infer<typeof cloudActionSchema>;
export const cloudQuerySchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("chat-deletion"), chatId: id }).strict(),
  z.object({ type: z.literal("removal-state"), chatId: id }).strict(),
  z.object({ type: z.literal("deletion-target"), chatId: id }).strict(),
  z.object({ type: z.literal("recovery-page"), chatId: id, afterId: id.nullable(), limit: rev.positive().max(20) }).strict(),
  z.object({ type: z.literal("retained-catalog"), afterId: id.nullable() }).strict(),
  z.object({ type: z.literal("retained-metadata"), chatId: id, archiveId: id, before: rev.nullable() }).strict(),
  z.object({ type: z.literal("recovery-archive"), chatId: id, archiveId: id }).strict(),
  z.object({ type: z.literal("recovery-home-retained"), chatId: id, jobId: id }).strict(),
  z.object({ type: z.literal("recovery-related-home"), chatId: id, archiveId: id }).strict(),
  z.object({ type: z.literal("import-download"), chatId: id }).strict(),
  z.object({ type: z.literal("confirmed-import-page"), chatId: id, generationId: id.nullable(), revision: rev.nullable(), beforeSeq: rev.positive().nullable(), limit: rev.positive().max(50) }).strict(),
  z.object({ type: z.literal("confirmed-catalog"), afterRevision: rev, throughRevision: rev.nullable() }).strict(),
  z.object({ type: z.literal("confirmed-body-page"), chatId: id, revision: rev, beforeSeq: rev.positive().nullable(), limit: rev.positive().max(50) }).strict(),
  z.object({ type: z.literal("confirmed-chat-page"), afterId: id.nullable(), limit: rev.positive().max(50) }).strict(),
  z.object({ type: z.literal("execution-archive-page"), chatId: id, afterId: id.nullable(), limit: rev.positive().max(50) }).strict(),
  z.object({ type: z.literal("archived-turn-page"), chatId: id, afterId: id.nullable(), limit: rev.positive().max(50) }).strict(),
  z.object({ type: z.literal("catalog-cursors") }).strict(),
  z.object({ type: z.literal("mirror-download"), chatId: id }).strict(),
  z.object({ type: z.literal("mirror-files"), chatId: id, messageId: id }).strict(),
  z.object({ type: z.literal("local-inventory") }).strict(),
  z.object({ type: z.literal("local-execution"), chatId: id }).strict(),
  z.object({ type: z.literal("remote-admission"), chatId: id }).strict(),
  z.object({ type: z.literal("remote-initial"), chatId: id }).strict(),
  z.object({ type: z.literal("canonical-start"), chatId: id }).strict(),
  z.object({ type: z.literal("state") }).strict(),
  z.object({ type: z.literal("outbox-checkpoint"), id: outboxId, key: checkpointKeySchema }).strict(),
  z.object({ type: z.literal("turn-delivery"), id: outboxId }).strict(),
  z.object({ type: z.literal("turn-target"), chatId: id }).strict(),
  z.object({ type: z.literal("chat-metadata"), chatId: id }).strict(),
  z.object({ type: z.literal("chat-facts"), chatId: id }).strict(),
  z.object({ type: z.literal("metadata-outbox"), chatId: id, limit: rev.positive().max(100) }).strict(),
  z.object({ type: z.literal("mirror-catalog"), afterId: id.nullable(), limit: rev.positive().max(100) }).strict(),
  z.object({ type: z.literal("mirror"), chatId: id, afterSeq: rev, limit: rev.positive().max(100) }).strict(),
  z.object({ type: z.literal("outbox"), afterId: outboxId.nullable(), limit: rev.positive().max(100), entityKind: z.enum(["home-snapshot", "tombstone", "turn"]).optional(), id: outboxId.optional(), chatId: id.optional() }).strict(),
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
const classificationState = z.enum(["pending", "conflicted", "confirmed", "committed", "discarded", "detached"]);
const mirrorValue = z.object({ chat: portableChatSchema, nextSeq: rev.positive(), trimmedThroughSeq: rev, messages, subagents: subagentsSchema, executable: z.literal(false), bodyReady: z.boolean(),
  cursor: rev.positive().nullable(), complete: z.boolean(), preparation: evidence.nullable() }).strict().nullable();
const custodyRow = z.object({ operation_id: z.string().min(1).max(384), chat_id: id, incarnation_id: id,
  classification_json: jsonText, source_ids_json: jsonText, created_at: rev }).strict();
const candidateRow = z.object({ operation_id: id, chat_id: id, environment: id.nullable(), user_id: id.nullable(), expected_revision: rev,
  old_classification_json: jsonText, previous_json: jsonText, candidate_json: jsonText, candidate_hash: hash, operation_json: jsonText.nullable(), receipt_json: jsonText.nullable(), state: classificationState }).strict();
const outboxRow = z.object({ id: z.string().min(1).max(384), environment: id, user_id: id,
  entity_kind: z.enum(["chat", "message", "turn", "attachment", "generation", "home-snapshot", "tombstone"]), entity_id: id,
  kind: z.string().min(1).max(128), seq_or_revision: rev, execution_epoch: rev.nullable(), payload_json: jsonText,
  payload_digest: hash, created_at: rev, attempts: rev, last_error: z.string().max(1024).nullable(),
  metadata_intent_json: jsonText.nullable(), metadata_status: chatMetadataStatusSchema.nullable() }).strict();
const result = <T extends string, V extends z.ZodType>(type: T, value: V) => z.object({ type: z.literal(type), value }).strict();
export const cloudResultSchema = z.discriminatedUnion("type", [
  result("chat-deletion", chatDeletionViewSchema), result("request-chat-deletion", chatDeletionViewSchema), result("keep-chat-deletion", chatDeletionViewSchema),
  result("removal-state", chatRemovalStateSchema),
  result("deletion-target", deletionTargetSchema), result("remove-cloud-mirror", z.object({ chatId: id }).strict()),
  result("retain-deleted-chat", z.object({ chatId: id }).strict()),
  result("prepare-deleted-chat", z.object({ chatId: id, archiveId: id.nullable() }).strict()),
  result("recovery-page", recoveryArchivePageSchema), result("recovery-archive", recoveryArchiveSchema),
  result("retained-catalog", retainedCatalogSchema), result("retained-metadata", retainedMetadataSchema),
  result("recovery-home-retained", z.boolean()),
  result("recovery-related-home", recoveryArchiveSchema.nullable()),
  result("import-download", importDownloadSchema.nullable()), result("confirmed-import-page", importPageSchema),
  result("begin-import-download", importDownloadSchema), result("begin-import-entry", z.object({ ready: z.boolean() }).strict()),
  result("write-import-field", z.object({ bytes: rev }).strict()), result("commit-import-entry", importDownloadSchema), result("complete-import-download", importDownloadSchema),
  result("put-mirror-head", z.object({ chatId: id }).strict()),
  result("apply-chat-catalog", catalogCursorsSchema),
  result("confirmed-chat-page", z.object({ items: z.array(cloudChatHeadSchema).max(50), cursor: id.nullable(), complete: z.boolean() }).strict()),
  result("confirmed-catalog", chatCatalogPageSchema),
  result("confirmed-body-page", z.object({ ready: z.boolean(), messages: z.array(chatBodySchema).max(50), cursor: rev.nullable(), complete: z.boolean() }).strict()),
  result("archived-turn-page", z.object({ items: z.array(z.object({ branchId: id, chatId: id, turnId: id, canonicalResultHash: hash,
    assistantSeq: rev.positive(), createdAt: rev, messageCount: rev.optional(), body: retainedSourceRefSchema }).strict()).max(50), cursor: id.nullable(), complete: z.boolean() }).strict()),
  result("catalog-cursors", catalogCursorsSchema), result("advance-catalog", catalogCursorsSchema),
  result("mirror-download", mirrorDownloadSchema.nullable()),
  result("mirror-files", mirrorFilesSchema),
  result("begin-mirror-body", mirrorDownloadSchema), result("stage-mirror-body", mirrorDownloadSchema), result("stage-mirror-empty", mirrorDownloadSchema), result("complete-mirror-body", mirrorDownloadSchema),
  result("local-inventory", chatInventorySchema),
  result("local-execution", localExecutionStateSchema),
  result("remote-admission", remoteAdmissionStateSchema),
  result("remote-initial", frozenRemoteChatInitializationSchema.nullable()),
  result("freeze-remote-initial", frozenRemoteChatInitializationSchema),
  result("canonical-start", chatFactsSchema.shape.startState),
  result("install-execution-prefix", executionInstallResultSchema),
  result("prepare-chat-convergence", convergenceResultSchema), result("commit-chat-convergence", convergenceResultSchema),
  result("execution-archive-page", z.object({ items: z.array(executionArchiveSchema).max(50), cursor: id.nullable(), complete: z.boolean() }).strict()),
  result("capture-initial", z.object({ version: z.literal(1), manifestId: id, scope: syncScopeSchema, capturedAt: rev, state: z.enum(["captured", "complete"]),
    entries: z.array(sourceRef.extend({ chatId: id, revision: rev, completionHash: hash.optional() })).max(10000) }).strict()),
  result("complete-initial-chat", z.object({ chatId: id, evidenceHash: hash }).strict()),
  result("put-mirror", z.object({ chatId: id, cloudRevision: rev, count: rev }).strict()),
  result("capture-live-turn", sourceRef),
  result("capture-home-job", homeJobSchema.nullable()), result("archive-home-job", z.object({ id }).strict()),
  result("turn-delivery", z.object({ highSeq: rev }).strict()),
  result("turn-target", z.object({ incarnationId: id, messageRevision: rev, outboxDigest: hash }).strict().nullable()),
  result("save-outbox-checkpoint", retainedSourceRefSchema),
  result("outbox-checkpoint", retainedSourceRefSchema.nullable()),
  result("accept-chat-head", z.object({ chatId: id }).strict()),
  result("resolve-chat-metadata", z.object({ chatId: id, queued: id.nullable() }).strict()),
  result("chat-metadata", chatMetadataLocalStateSchema),
  result("chat-facts", chatFactsViewSchema), result("edit-chat-metadata", chatFactsViewSchema),
  result("resolve-chat-facts", chatFactsViewSchema),
  result("metadata-outbox", z.array(outboxRow).max(100)),
  result("prepare-materialization", z.object({ chatId: id, prepared: z.literal(true) }).strict()),
  result("materialize", z.object({ chatId: id, materialized: z.literal(true) }).strict()),
  result("settle-turn", z.object({ chatId: id, settled: z.boolean() }).strict()),
  result("propose-classification", z.object({ lifecycleOperationId: id, candidateHash: hash, state: classificationState }).strict()),
  result("confirm-classification", z.object({ state: classificationState }).strict()),
  result("commit-classification", z.object({ chatId: id, state: z.literal("committed") }).strict()),
  result("discard-classification", z.object({ state: z.literal("discarded") }).strict()),
  result("repair-classification", z.object({ chatId: id, repaired: z.literal(true) }).strict()),
  result("archive-deletion", z.object({ chatId: id, sourceIds: z.array(id).min(1) }).strict()),
  result("handoff-turn", sourceRef),
  result("attempt-outbox", z.object({ id: z.string().min(1).max(384) }).strict()),
  result("ack-outbox", z.object({ id: z.string().min(1).max(384) }).strict()),
  result("retire-covered-commit", z.object({ id: outboxId, retired: z.boolean() }).strict()),
  result("cache-blob", z.object({ blobId: logicalBlobSchema.shape.blobId }).strict()),
  result("cleanup-scope", z.object({ cleaned: z.literal(true), retainedChatIds: z.array(id) }).strict()),
  result("state", z.union([z.object({ scopes: rev, outbox: rev, receipts: rev }).strict(), z.object({ environment: id, user_id: id,
    initial_manifest_json: jsonText.nullable(), meta_cursor: z.string().nullable(), body_backfill_cursor: z.string().nullable(),
    paused: z.union([z.literal(0), z.literal(1)]), updated_at: rev }).strict(), z.null()])),
  result("mirror", mirrorValue), result("outbox", z.array(outboxRow).max(100)),
  result("mirror-catalog", z.object({ items: z.array(portableChatSchema).max(100), cursor: id.nullable(), complete: z.boolean() }).strict()),
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
  if (Buffer.byteLength(JSON.stringify(value), "utf8") > 8 * 1024 * 1024) {
    throw new Error("Local synchronization command exceeds 8 MiB");
  }
  return value;
}
