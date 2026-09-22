/**
 * [INPUT]: Depends on the sole worker database, scope mode, canonical readers/writers and lifecycle-specific deletion custody.
 * [OUTPUT]: Routes original synchronization/removal transactions and exact worker-owned remote admission snapshots.
 * [POS]: Composed ChatRepository collaborator; every mutation shares its existing operation receipt transaction.
 */
import { isAbsolute } from "node:path";
import { cloudChatHeadSchema } from "@ai-chat/cloud-protocol/chats/model";
import { readChatDeletion, requestChatDeletion, keepChatDeletion } from "./deletion/intent";
import { readFileSync, lstatSync, openSync, fstatSync, readSync, closeSync, constants } from "node:fs";
import { createHash } from "node:crypto";
import { turnSequencesSchema } from "../../../../../shared/chat-agent/sequences";
import { canonicalJson, projectChatClassification, sameScope, storageModeSchema, type StorageMode, type SyncScope } from "../../../../../shared/local-storage/contracts";
import type { DatabaseCommand } from "../database-protocol";
import type { SqliteDatabase } from "../connection";
import type { ChatRepositoryReader } from "../repository/reader";
import type { ChatRecordWriter } from "../repository/writer";
import { digest, json, type Row } from "../repository/codec";
import { boundedCloudValue, cloudMutationSchema, cloudReadSchema, cloudResultSchema, handoffIdentity, type CloudMutation, type CloudRead } from "./protocol";
import { ClassificationTransactions } from "./classification";
import { MirrorTransactions } from "./mirrors";
import { archiveDeletion, captureInitial, frozenChatSource, portableFacts } from "./snapshots";
import { enqueueSource, releaseMirrorArchiveRoots, releaseRoot, retainImportedHistory, writeClassification } from "./retention";
import { enrollmentOpen, transitionStorageMode } from "../../../../../shared/local-storage/scope-mode";
import type { RuntimeStorageMode } from "../../../../../shared/local-storage/contracts";
import { readCheckpoint, saveCheckpoint } from "./delivery/checkpoints";
import { captureInitialMetadata, captureMetadataEdit } from "./delivery/metadata-capture";
import { acceptMetadataHead, confirmMetadataReceipt, readMetadataState } from "./delivery/metadata-confirm";
import { resolveMetadata } from "./delivery/metadata-resolve";
import { editChatFacts } from "./delivery/facts/edit";
import { readChatFacts } from "./delivery/facts/state";
import { readLocalInventory } from "./inventory/read";
import { completeInitialChat } from "./initialization/complete";
import { convergeChat } from "./convergence/transaction";
import { captureTurn } from "./delivery/turns/capture";
import { turnDeliveryProgress } from "./delivery/turns/checkpoints";
import { putMirrorHead, readCatalogCursors, advanceCatalog, confirmedChatPage, confirmedCatalog } from "./mirror/heads";
import { beginMirrorBody, stageMirrorBody, stageMirrorEmpty, completeMirrorBody, readMirrorDownload, confirmedBodyPage } from "./mirror/downloads";
import { turnOutboxDigest } from "./settlement/outbox";
import { archivedTurnPage } from "./settlement/custody";
import { readMirrorFiles } from "./mirror/files";
import { commitAsOwner } from "./execution/commit";
import { installExecutionPrefix } from "./execution/install";
import { executionArchivePage } from "./execution/archive";
import { mirrorStartState } from "./mirror/window";
import { readImportDownload } from "./imported/state";
import { beginImportDownload, completeImportDownload, confirmedImportPage } from "./imported/downloads";
import { beginImportEntry, writeImportField, commitImportEntry } from "./imported/entries";
import { localExecutionState } from "./execution/state";
import { remoteAdmissionState, remoteInitialization } from "./execution/remote";
import { captureHomeJob } from "./home/jobs";
import { recoveryArchive, recoveryPage, recoveryRelatedHome } from "./recovery/reads";
import { retainedCatalog, retainedMetadata } from "./recovery/catalog";
import { preserveRecoveryHomeJob, recoveryHomeRetained } from "./recovery/home";
import { readRetainedSource } from "./inventory/source";
import { homeJobSchema } from "./home/contracts";
import { captureOptionsEdit } from "./delivery/options/capture";
import { retireCoveredCommit } from "./settlement/coverage";
import { businessOutboxKinds } from "./delivery/options/model";
import { deletionTarget, removeCloudMirror, chatRemovalState } from "./deletion/mirrors";
import { readDeletionMarker, rememberDeletion } from "./deletion/markers";
import { archiveDeletedExecution, retainDeletedChat, prepareDeletedChat } from "./deletion/native";
import { retainAppTranscript, restoreRetainedAppMirror } from "./deletion/handoff";

export class ChatCloudRepository {
  private mode: StorageMode;
  private readonly classifications: ClassificationTransactions;
  private readonly mirrors: MirrorTransactions;
  private readonly verifiedImportBlobs = new Map<string, string>();
  constructor(private db: SqliteDatabase, private reader: ChatRepositoryReader, private writer: ChatRecordWriter,
    private now: () => number, mode: StorageMode = { kind: "local-only" }) {
    this.mode = storageModeSchema.parse(mode);
    this.classifications = new ClassificationTransactions(db, reader, writer, now);
    this.mirrors = new MirrorTransactions(db, reader, writer, now);
    if (this.mode.kind === "sync") this.configureMode(this.mode);
  }
  configureMode(mode: RuntimeStorageMode) {
    const scopes = (this.db.prepare("SELECT environment,user_id FROM cloud_sync_state").all() as Row[])
      .map(row => ({ environment: String(row.environment), userId: String(row.user_id) }));
    this.mode = transitionStorageMode(this.mode, mode, scopes);
    return this.mode;
  }
  get searchScope() { return this.mode.kind !== "local-only" ? this.mode.scope : null; }
  private assertScope(scope: SyncScope | null, localAllowed = false) {
    if (!scope) {
      if (localAllowed) return;
      throw new Error("SYNC_SCOPE_REQUIRED");
    }
    if (this.mode.kind === "local-only" || !sameScope(this.mode.scope, scope)) throw new Error("SYNC_SCOPE_UNAVAILABLE");
    const other = this.db.prepare("SELECT 1 FROM cloud_sync_state WHERE environment<>? OR user_id<>? LIMIT 1")
      .get(scope.environment, scope.userId);
    if (other) throw new Error("PREVIOUS_SCOPE_CLEANUP_REQUIRED");
  }
  mutate(raw: CloudMutation) {
    const command = cloudMutationSchema.parse(boundedCloudValue(raw));
    const { action, scope, deviceId } = command;
    const localAllowed = ["propose-classification", "commit-classification", "repair-classification", "archive-deletion"].includes(action.type);
    this.assertScope(scope, localAllowed);
    if (scope && !enrollmentOpen(this.mode) && !["cleanup-scope", "commit-classification", "ack-outbox", "attempt-outbox", "handoff-turn"].includes(action.type)) {
      throw new Error("SYNC_ENROLLMENT_CLOSED");
    }
    if (command.requestHash !== digest(canonicalJson({ ...command, requestHash: undefined }))) throw new Error("CLOUD_REQUEST_HASH_MISMATCH");
    if (scope && action.type !== "cleanup-scope") this.db.prepare(`INSERT OR IGNORE INTO cloud_sync_state(environment,user_id,updated_at) VALUES(?,?,?)`)
      .run(scope.environment, scope.userId, this.now());
    let value: unknown;
    switch (action.type) {
      case "freeze-remote-initial": value = remoteInitialization(this.db, scope!, deviceId, action.initialization.chatId, action.initialization); break;
      case "request-chat-deletion":
        if (command.operationId !== action.operationId) throw new Error("CHAT_DELETION_OPERATION_CHANGED");
        value = requestChatDeletion(this.db, this.reader, scope!, deviceId, action, this.now()); break;
      case "keep-chat-deletion":
        if (command.operationId !== action.operationId) throw new Error("CHAT_DELETION_OPERATION_CHANGED");
        value = keepChatDeletion(this.db, scope!, action); break;
      case "retire-covered-commit": value = retireCoveredCommit(this.db, scope!, deviceId, action.id, action.payloadDigest); break;
      case "capture-home-job": value = captureHomeJob(this.db, scope!, deviceId, action.turn, this.now()); break;
      case "put-mirror-head": value = putMirrorHead(this.db, this.writer, this.mirrors, scope!, deviceId, action.head, this.now()); break;
      case "apply-chat-catalog":
        if (action.revision <= action.expectedRevision || action.heads.some(head => head.catalogRevision <= action.expectedRevision || head.catalogRevision > action.revision)) throw new Error("CATALOG_PAGE_INVALID");
        for (const head of action.heads) putMirrorHead(this.db, this.writer, this.mirrors, scope!, deviceId, head, this.now());
        value = advanceCatalog(this.db, scope!, "chats", action.expectedRevision, action.revision, this.now()); break;
      case "advance-catalog": value = advanceCatalog(this.db, scope!, action.topic, action.expectedRevision, action.revision, this.now()); break;
      case "begin-mirror-body": value = beginMirrorBody(this.db, scope!, action.head, this.now(), this.writer); break;
      case "begin-import-download": value = beginImportDownload(this.db, scope!, action, this.now()); break;
      case "begin-import-entry": value = beginImportEntry(this.db, scope!, action.chatId, action.generationId, action.entry); break;
      case "write-import-field": value = writeImportField(this.db, scope!, action); break;
      case "commit-import-entry": value = commitImportEntry(this.db, scope!, action, this.now()); break;
      case "complete-import-download": value = completeImportDownload(this.db, scope!, action.chatId, action.generationId, this.now()); break;
      case "stage-mirror-empty": value = stageMirrorEmpty(this.db, scope!, action.chatId, action.bodyRevision, action.beforeSeq, action.prefix, this.now()); break;
      case "stage-mirror-body": value = stageMirrorBody(this.db, scope!, action.chatId, action.bodyRevision, action.beforeSeq, action.bodyHash, action.body, this.now()); break;
      case "complete-mirror-body": value = completeMirrorBody(this.db, this.writer, scope!, action.chatId, action.bodyRevision, action.beforeSeq, this.now()); break;
      case "capture-initial": value = captureInitial(this.db, this.reader, scope!, deviceId, action.manifestId, this.now()); break;
      case "capture-live-turn": value = captureTurn(this.db, scope!, deviceId, command.operationId, action.sourceId, action.payloadDigest, action.admission, this.now()); break;
      case "complete-initial-chat": value = completeInitialChat(this.db, scope!, action.id, action.payloadDigest, this.now()); break;
      case "save-outbox-checkpoint": value = saveCheckpoint(this.db, scope!, action.id, action.payloadDigest, action.checkpoint, this.now(),
        (item, receipt) => {
          if (receipt.head && ["applied", "converged"].includes(receipt.status)) restoreRetainedAppMirror(this.db, scope!, receipt.head,
            () => { this.mirrors.put({ type: "put-mirror", chat: receipt.head!.chat, messages: [], subagents: {} }, scope!); });
          confirmMetadataReceipt(this.db, this.writer, scope!, deviceId, item, receipt, this.now());
        }); break;
      case "accept-chat-head": value = acceptMetadataHead(this.db, this.writer, scope!, deviceId, action.head, this.now()); break;
      case "edit-chat-metadata":
        if (command.operationId !== action.operationId) throw new Error("CHAT_METADATA_OPERATION_CHANGED");
        value = editChatFacts(this.db, this.writer, scope!, deviceId, action, this.now()); break;
      case "resolve-chat-facts": {
        if (command.operationId !== action.operationId) throw new Error("CHAT_METADATA_OPERATION_CHANGED");
        const head = readMetadataState(this.db, scope!, action.chatId).head;
        if (!head || head.chat.incarnationId !== action.incarnationId || head.chat.cloudRevision !== action.expectedRevision) throw new Error("CHAT_METADATA_REVIEW_CHANGED");
        resolveMetadata(this.db, this.writer, scope!, deviceId, command.operationId, action.decision, head, action.expectedQueueHash, this.now());
        value = readChatFacts(this.db, scope!, action.chatId); break;
      }
      case "resolve-chat-metadata": value = resolveMetadata(this.db, this.writer, scope!, deviceId, command.operationId, action.decision, action.head, action.expectedQueueHash, this.now()); break;
      case "put-mirror": value = this.mirrors.put(action, scope!); break;
      case "prepare-materialization": value = this.mirrors.prepare(action, scope!); break;
      case "install-execution-prefix": value = installExecutionPrefix(this.db, this.reader, this.writer, scope!, deviceId, action, this.now()); break;
      case "prepare-chat-convergence": case "commit-chat-convergence": value = convergeChat(this.db, this.reader, this.writer, scope!, deviceId, action, this.now()); break;
      case "materialize": value = this.mirrors.materialize(action, scope!, deviceId); break;
      case "settle-turn": value = this.mirrors.settle(action, scope!, deviceId); break;
      case "propose-classification": {
        const stored = this.scopedChat(action.facts.id, scope);
        if (stored.cloud_state !== "local-only" && !scope) throw new Error("SYNC_SCOPE_REQUIRED");
        value = this.classifications.propose(action, deviceId, scope); break;
      }
      case "confirm-classification": value = this.classifications.confirm(action, scope!, deviceId); break;
      case "discard-classification": value = this.classifications.discard(action, scope!); break;
      case "commit-classification": {
        const committed = this.classifications.get(action.lifecycleOperationId)?.state === "committed";
        value = this.classifications.commit(action.lifecycleOperationId, deviceId, scope);
        const candidate = this.classifications.get(action.lifecycleOperationId)!;
        if (!committed) this.recordBusinessCommit(command, String(candidate.chat_id)); break;
      }
      case "repair-classification": {
        this.scopedChat(action.chatId, scope);
        if (action.deviceId !== deviceId) throw new Error("SYNC_DEVICE_MISMATCH");
        const facts = this.reader.listMetadata(deviceId, action.chatId)[0];
        if (!facts || facts.chatRecordRevision !== action.expectedRevision) throw new Error("REVISION_STALE");
        writeClassification(this.db, facts); value = { chatId: action.chatId, repaired: true }; break;
      }
      case "archive-deletion": {
        this.scopedChat(action.chatId, scope);
        value = archiveDeletion(this.db, this.reader, action.chatId, action.expectedIncarnationId, deviceId, command.operationId, this.now()); break;
      }
      case "handoff-turn": {
        const chat = this.scopedChat(action.chatId, scope);
        if (chat.cloud_state !== "synced" || !this.reader.listMetadata(deviceId, action.chatId).length) throw new Error("LOCAL_EXECUTION_AUTHORITY_REQUIRED");
        const evidence = action.evidence;
        turnSequencesSchema.parse({ noticeSeq: evidence.noticeSeq, userSeq: evidence.userSeq, assistantSeq: evidence.assistantSeq });
        if (digest(canonicalJson(handoffIdentity(action))) !== evidence.identityHash) throw new Error("TURN_HANDOFF_IDENTITY_MISMATCH");
        if (evidence.userMessage.role !== "user" || evidence.userMessage.id !== evidence.userMessageId || evidence.userMessage.seq !== evidence.userSeq ||
          evidence.assistantSeq !== evidence.userSeq + 1 || (evidence.resultKind === "message") !== Boolean(evidence.resultMessage) ||
          (evidence.resultKind === "pending" && evidence.resultHash !== null) ||
          (evidence.resultKind === "empty" && evidence.resultHash !== digest(canonicalJson(null))) ||
          (evidence.resultMessage && (evidence.resultMessage.id !== evidence.assistantMessageId || evidence.resultMessage.seq !== evidence.assistantSeq || evidence.resultMessage.role !== "assistant" ||
            digest(canonicalJson({ ...evidence.resultMessage, resultHash: undefined })) !== evidence.resultHash))) throw new Error("TURN_HANDOFF_INCOMPLETE");
        value = enqueueSource(this.db, { id: command.operationId, scope: scope!, chatId: action.chatId, entityKind: "turn", entityId: action.turnId,
          kind: "ledger-handoff", revision: evidence.assistantSeq, payload: { turnId: action.turnId, ...evidence }, now: this.now() }); break;
      }
      case "attempt-outbox": case "ack-outbox": {
        const item = this.db.prepare("SELECT * FROM cloud_outbox WHERE id=? AND environment=? AND user_id=?")
          .get(action.id, scope!.environment, scope!.userId) as Row | undefined;
        if (!item || item.payload_digest !== action.payloadDigest) throw new Error("OUTBOX_IDENTITY_MISMATCH");
        if (action.type === "attempt-outbox") this.db.prepare("UPDATE cloud_outbox SET attempts=attempts+1,last_error=? WHERE id=?").run(action.error, action.id);
        else {
          if (item.kind === "classification") throw new Error("CLASSIFICATION_CONFIRMATION_REQUIRED");
          if (["queued", "blocked", "conflicted"].includes(String(item.metadata_status))) throw new Error("CHAT_METADATA_CONFIRMATION_REQUIRED");
          if (businessOutboxKinds.has(String(item.kind))) throw new Error("CHAT_COVERAGE_AND_CUSTODY_REQUIRED");
          if (item.kind === "delete-chat" && !readCheckpoint(this.db, scope!, action.id, "deletion-receipt")) throw new Error("DELETION_CONFIRMATION_REQUIRED");
          if (item.entity_kind === "home-snapshot" && !readCheckpoint(this.db, scope!, action.id, "home-complete")) throw new Error("HOME_COMPLETION_REQUIRED");
          if (item.entity_kind === "home-snapshot") {
            const source = JSON.parse(String(item.payload_json)).sources[0];
            preserveRecoveryHomeJob(this.db, scope!, homeJobSchema.parse(readRetainedSource(this.db, source)), source, this.now());
          }
          this.db.prepare("DELETE FROM cloud_outbox WHERE id=?").run(action.id);
          releaseRoot(this.db, `outbox:${action.id}`);
        }
        value = { id: action.id }; break;
      }
      case "cache-blob": {
        if (!isAbsolute(action.localPath)) throw new Error("Blob cache requires an internal absolute locator");
        const stat = lstatSync(action.localPath);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== action.blob.bytes || stat.size > 64 * 1024 * 1024) throw new Error("BLOB_INTEGRITY_FAILED");
        const bytes = readFileSync(action.localPath);
        if (bytes.byteLength !== action.blob.bytes || digest(bytes) !== action.blob.sha256) throw new Error("BLOB_INTEGRITY_FAILED");
        const existing = this.db.prepare("SELECT sha256,bytes,mime FROM cloud_blobs WHERE environment=? AND user_id=? AND blob_id=?")
          .get(scope!.environment, scope!.userId, action.blob.blobId) as Row | undefined;
        if (existing && (existing.sha256 !== action.blob.sha256 || existing.bytes !== action.blob.bytes || existing.mime !== action.blob.mime)) throw new Error("BLOB_IDENTITY_CONFLICT");
        this.db.prepare(`INSERT INTO cloud_blobs(environment,user_id,blob_id,sha256,bytes,mime,local_path,last_used_at)
          VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(environment,user_id,blob_id) DO UPDATE SET local_path=excluded.local_path,last_used_at=excluded.last_used_at`)
          .run(scope!.environment, scope!.userId, action.blob.blobId, action.blob.sha256, action.blob.bytes, action.blob.mime, action.localPath, this.now());
        value = { blobId: action.blob.blobId }; break;
      }
      case "remove-cloud-mirror": value = removeCloudMirror(this.db, scope!, action.tombstone, this.now()); break;
      case "retain-deleted-chat": value = retainDeletedChat(this.db, this.reader, scope!, deviceId, action, this.now()); break;
      case "prepare-deleted-chat": value = prepareDeletedChat(this.db, this.reader, scope!, deviceId, action, this.now()); break;
      case "cleanup-scope": value = this.cleanup(scope!, action.retainedChatIds); break;
    }
    return cloudResultSchema.parse(boundedCloudValue({ type: action.type, value: JSON.parse(json(value)) }));
  }
  read(raw: CloudRead) {
    const { query, scope, deviceId } = cloudReadSchema.parse(raw);
    this.assertScope(scope, ["state", "custody", "source", "source-blob", "classification", "local-inventory", "local-execution", "removal-state"].includes(query.type));
    let value: unknown;
    switch (query.type) {
      case "chat-deletion": value = readChatDeletion(this.db, scope!, query.chatId); break;
      case "removal-state": value = chatRemovalState(this.db, query.chatId); break;
      case "recovery-page": value = recoveryPage(this.db, scope!, query.chatId, query.afterId, query.limit); break;
      case "retained-catalog": value = retainedCatalog(this.db, scope!, query.afterId); break;
      case "retained-metadata": value = retainedMetadata(this.db, scope!, query.chatId, query.archiveId, query.before); break;
      case "recovery-archive": value = recoveryArchive(this.db, scope!, query.chatId, query.archiveId); break;
      case "recovery-home-retained": value = recoveryHomeRetained(this.db, scope!, query.chatId, query.jobId); break;
      case "recovery-related-home": value = recoveryRelatedHome(this.db, scope!, query.chatId, query.archiveId); break;
      case "catalog-cursors": value = readCatalogCursors(this.db, scope!); break;
      case "deletion-target": value = deletionTarget(this.db, scope!, query.chatId); break;
      case "archived-turn-page": value = archivedTurnPage(this.db, scope!, query.chatId, query.afterId, query.limit); break;
      case "confirmed-chat-page": value = confirmedChatPage(this.db, scope!, query.afterId, query.limit); break;
      case "confirmed-catalog": value = confirmedCatalog(this.db, scope!, query.afterRevision, query.throughRevision); break;
      case "confirmed-body-page": value = confirmedBodyPage(this.db, scope!, query.chatId, query.revision, query.beforeSeq, query.limit); break;
      case "mirror-download": value = readMirrorDownload(this.db, scope!, query.chatId); break;
      case "import-download": value = readImportDownload(this.db, scope!, query.chatId); break;
      case "confirmed-import-page": value = confirmedImportPage(this.db, scope!, query.chatId, query.generationId, query.revision, query.beforeSeq, query.limit); break;
      case "mirror-files": value = readMirrorFiles(this.db, scope!, query.chatId, query.messageId); break;
      case "local-inventory": value = readLocalInventory(this.db, this.reader, deviceId); break;
      case "execution-archive-page": value = executionArchivePage(this.db, scope!, query.chatId, query.afterId, query.limit); break;
      case "local-execution": value = localExecutionState(this.db, query.chatId, deviceId); break;
      case "remote-initial": value = remoteInitialization(this.db, scope!, deviceId, query.chatId); break;
      case "remote-admission": value = remoteAdmissionState(this.db, this.reader, scope!, deviceId, query.chatId); break;
      case "canonical-start": value = mirrorStartState(this.db, scope!, query.chatId); break;
      case "mirror-catalog": value = this.mirrors.catalog(scope!, query.afterId, query.limit); break;
      case "outbox-checkpoint": value = readCheckpoint(this.db, scope!, query.id, query.key); break;
      case "turn-delivery": value = turnDeliveryProgress(this.db, scope!, query.id); break;
      case "turn-target": {
        const row = this.db.prepare("SELECT incarnation_id,native_message_revision FROM chats WHERE id=? AND cloud_environment=? AND cloud_user_id=?")
          .get(query.chatId, scope!.environment, scope!.userId) as Row | undefined;
        value = row ? { incarnationId: row.incarnation_id, messageRevision: row.native_message_revision, outboxDigest: turnOutboxDigest(this.db, scope!, query.chatId) } : null; break;
      }
      case "chat-metadata": value = readMetadataState(this.db, scope!, query.chatId); break;
      case "chat-facts": value = readChatFacts(this.db, scope!, query.chatId); break;
      case "metadata-outbox": value = this.db.prepare(`SELECT * FROM cloud_outbox WHERE environment=? AND user_id=?
        AND json_extract(payload_json,'$.chatId')=? AND metadata_status IN ('queued','blocked','conflicted')
        ORDER BY seq_or_revision,created_at,id LIMIT ?`).all(scope!.environment, scope!.userId, query.chatId, query.limit); break;
      case "state": value = scope ? this.db.prepare("SELECT * FROM cloud_sync_state WHERE environment=? AND user_id=?").get(scope.environment, scope.userId) ?? null : {
        scopes: Number((this.db.prepare("SELECT COUNT(*) n FROM cloud_sync_state").get() as Row).n),
        outbox: Number((this.db.prepare("SELECT COUNT(*) n FROM cloud_outbox").get() as Row).n),
        receipts: Number((this.db.prepare("SELECT COUNT(*) n FROM cloud_turn_receipts").get() as Row).n) }; break;
      case "mirror": value = this.mirrors.read(query.chatId, scope!, query.afterSeq, query.limit); break;
      case "outbox": value = this.db.prepare(`SELECT * FROM cloud_outbox WHERE environment=? AND user_id=? AND id>?
        AND (? IS NULL OR entity_kind=?) AND (? IS NULL OR id=?) AND (? IS NULL OR json_extract(payload_json,'$.chatId')=?) ORDER BY id LIMIT ?`)
        .all(scope!.environment, scope!.userId, query.afterId ?? "", query.entityKind ?? null, query.entityKind ?? null, query.id ?? null, query.id ?? null, query.chatId ?? null, query.chatId ?? null, query.limit); break;
      case "turn-receipt": {
        const row = this.db.prepare("SELECT receipt_json FROM cloud_turn_receipts WHERE environment=? AND user_id=? AND turn_id=?")
          .get(scope!.environment, scope!.userId, query.turnId) as Row | undefined;
        value = row ? JSON.parse(String(row.receipt_json)) : null; break;
      }
      case "source": {
        const row = this.db.prepare("SELECT * FROM chat_retained_sources WHERE source_id=?").get(query.sourceId) as Row | undefined;
        if (row && (row.environment !== (scope?.environment ?? null) || row.user_id !== (scope?.userId ?? null) || (!scope && row.local_device_id !== deviceId))) throw new Error("SYNC_SCOPE_UNAVAILABLE");
        if (row && digest(String(row.payload_json)) !== row.digest) throw new Error("SOURCE_CONTENT_CORRUPT");
        value = row ? { sourceId: row.source_id, digest: row.digest, payload: JSON.parse(String(row.payload_json)) } : null; break;
      }
      case "source-blob": {
        const source = this.db.prepare("SELECT environment,user_id,local_device_id FROM chat_retained_sources WHERE source_id=?").get(query.sourceId) as Row | undefined;
        if (!source || source.environment !== (scope?.environment ?? null) || source.user_id !== (scope?.userId ?? null) || (!scope && source.local_device_id !== deviceId)) throw new Error("SYNC_SCOPE_UNAVAILABLE");
        const blob = this.db.prepare(`SELECT b.local_path,b.byte_size FROM chat_retained_import_blobs r
          JOIN chat_import_blobs b ON b.content_digest=r.content_digest WHERE r.source_id=? AND r.content_digest=?`).get(query.sourceId, query.sha256) as Row | undefined;
        if (!blob) throw new Error("RETAINED_BLOB_UNAVAILABLE");
        const file = openSync(String(blob.local_path), constants.O_RDONLY | constants.O_NOFOLLOW);
        try {
          const stat = fstatSync(file), bytes = Number(blob.byte_size);
          if (!stat.isFile() || stat.size !== bytes || query.offset > bytes) throw new Error("BLOB_INTEGRITY_FAILED");
          const identity = (value: typeof stat) => [value.dev, value.ino, value.size, value.mtimeMs, value.ctimeMs].join(":");
          const stamp = identity(stat);
          if (this.verifiedImportBlobs.get(query.sha256) !== stamp) {
            const hash = createHash("sha256"), buffer = Buffer.alloc(Math.min(bytes, 1024 * 1024));
            for (let offset = 0; offset < bytes;) {
              const read = readSync(file, buffer, 0, Math.min(buffer.length, bytes - offset), offset);
              if (!read) throw new Error("BLOB_INTEGRITY_FAILED");
              hash.update(buffer.subarray(0, read)); offset += read;
            }
            if (hash.digest("hex") !== query.sha256) throw new Error("BLOB_INTEGRITY_FAILED");
            if (this.verifiedImportBlobs.size >= 8) this.verifiedImportBlobs.clear();
            this.verifiedImportBlobs.set(query.sha256, stamp);
          }
          const chunk = Buffer.alloc(Math.min(query.length, bytes - query.offset));
          if (readSync(file, chunk, 0, chunk.length, query.offset) !== chunk.length) throw new Error("BLOB_INTEGRITY_FAILED");
          if (identity(fstatSync(file)) !== stamp) { this.verifiedImportBlobs.delete(query.sha256); throw new Error("BLOB_INTEGRITY_FAILED"); }
          value = { sha256: query.sha256, bytes, offset: query.offset, data: chunk.toString("base64"), eof: query.offset + chunk.length === bytes };
        } finally { closeSync(file); }
        break;
      }
      case "classification": {
        const row = this.classifications.get(query.lifecycleOperationId);
        if (row && (row.environment !== (scope?.environment ?? null) || row.user_id !== (scope?.userId ?? null))) throw new Error("SYNC_SCOPE_UNAVAILABLE");
        value = row ?? null; break;
      }
      case "custody": {
        this.assertSourceAccess(query.chatId, deviceId, scope);
        value = (this.db.prepare("SELECT * FROM chat_deletion_custody WHERE chat_id=?").all(query.chatId) as Row[]).filter(custody =>
          (JSON.parse(String(custody.source_ids_json)) as string[]).every(sourceId => {
            const source = this.db.prepare("SELECT environment,user_id,local_device_id FROM chat_retained_sources WHERE source_id=?").get(sourceId) as Row | undefined;
            return source && source.environment === (scope?.environment ?? null) && source.user_id === (scope?.userId ?? null) && (scope || source.local_device_id === deviceId);
          })); break;
      }
    }
    return cloudResultSchema.parse(boundedCloudValue({ type: query.type, value: JSON.parse(json(value)) }));
  }
  private assertSourceAccess(chatId: string, deviceId: string, scope: SyncScope | null) {
    const row = this.db.prepare("SELECT cloud_environment,cloud_user_id FROM chats WHERE id=?").get(chatId) as Row | undefined;
    if (row && (row.cloud_environment !== (scope?.environment ?? null) || row.cloud_user_id !== (scope?.userId ?? null))) throw new Error("SYNC_SCOPE_UNAVAILABLE");
    if (!scope && row && !this.reader.listMetadata(deviceId, chatId).length) throw new Error("CHAT_UNAVAILABLE");
  }
  private scopedChat(chatId: string, scope: SyncScope | null) {
    const chat = this.db.prepare("SELECT * FROM chats WHERE id=?").get(chatId) as Row | undefined;
    if (!chat || chat.cloud_environment !== (scope?.environment ?? null) || chat.cloud_user_id !== (scope?.userId ?? null)) throw new Error("SYNC_SCOPE_UNAVAILABLE");
    return chat;
  }
  recordBusinessCommit(command: DatabaseCommand, chatId: string | null) {
    const importing = command.kind === "finalize-history-import";
    let deviceId = "deviceId" in command ? command.deviceId : undefined;
    if (importing) {
      const owners = this.db.prepare(`SELECT r.chat_id,a.device_id FROM history_import_runs r JOIN chat_local_aggregate_state a ON a.chat_id=r.chat_id WHERE r.run_id=? LIMIT 2`).all(command.runId) as Row[];
      if (owners.length !== 1) throw new Error("IMPORT_SOURCE_OWNER_UNAVAILABLE");
      chatId = String(owners[0]!.chat_id); deviceId = String(owners[0]!.device_id);
    }
    if (!chatId || !deviceId || !("operationId" in command)) return;
    if (this.db.prepare("SELECT 1 FROM chat_classification_candidates WHERE chat_id=? AND state IN ('pending','confirmed') LIMIT 1").get(chatId)) throw new Error("CHAT_CLASSIFICATION_PENDING");
    const row = this.db.prepare("SELECT * FROM chats WHERE id=?").get(chatId) as Row | undefined;
    if (!row) return;
    const enrolling = row.cloud_state === "local-only";
    if (enrolling) {
      if (this.mode.kind === "local-only" || !enrollmentOpen(this.mode) || !this.db.prepare(`SELECT 1 FROM cloud_sync_state
        WHERE environment=? AND user_id=? AND initial_manifest_json IS NOT NULL`)
        .get(this.mode.scope.environment, this.mode.scope.userId)) return;
      this.assertScope(this.mode.scope);
      this.db.prepare("UPDATE chats SET cloud_state='synced',cloud_environment=?,cloud_user_id=?,cloud_revision=0 WHERE id=?")
        .run(this.mode.scope.environment, this.mode.scope.userId, chatId);
      Object.assign(row, { cloud_state: "synced", cloud_environment: this.mode.scope.environment, cloud_user_id: this.mode.scope.userId, cloud_revision: 0 });
    }
    if (row.cloud_state === "mirror") throw new Error("MIRROR_IS_READONLY");
    const scope = { environment: String(row.cloud_environment), userId: String(row.cloud_user_id) };
    this.assertScope(scope);
    const facts = this.reader.listMetadata(deviceId, chatId)[0];
    if (!facts) throw new Error("Chat facts unavailable for outbox");
    const projected = projectChatClassification(facts);
    if (projected.conversationKind !== row.conversation_kind || projected.appId !== row.portable_app_id || projected.projectId !== row.portable_project_id) throw new Error("CHAT_CLASSIFICATION_DRIFT");
    if (this.db.prepare("SELECT 1 FROM chat_classification_candidates WHERE chat_id=? AND state IN ('pending','confirmed') LIMIT 1").get(chatId)) throw new Error("CHAT_CLASSIFICATION_PENDING");
    const message = "message" in command ? command.message : "userMessage" in command ? command.userMessage : null;
    if (message?.role === "user") commitAsOwner(this.db, chatId, deviceId, "ownerCommit" in command ? command.ownerCommit : undefined);
    const record = enrolling && facts.readOnlyReason !== "external-readonly" ? this.reader.getRecord(chatId, deviceId) : "record" in command ? command.record : null;
    const imported = enrolling || importing ?
      retainImportedHistory(this.db, chatId, `outbox:${command.operationId}`, this.now(), scope) : null;
    const optionsOperation = enrolling ? null : captureOptionsEdit(this.db, scope, command.operationId, command.kind, facts);
    enqueueSource(this.db, { id: command.operationId, scope, chatId, entityKind: !enrolling && importing ? "generation" : !enrolling && message ? "message" : "chat",
      kind: enrolling ? "initialize" : command.kind === "cloud-mutate" && command.action.type === "commit-classification" ? "classification-commit" : command.kind, revision: facts.chatRecordRevision,
      payload: { ...(enrolling || importing ? frozenChatSource(this.db, facts, record, Number(row.cloud_revision)) :
        { chat: portableFacts(facts, Number(row.cloud_revision)) }), ...(record && !enrolling ? { messages: record.messages,
        subagents: record.subagents ?? {}, branches: record.supersededBranches ?? [] } : {}),
        ...(imported ? { imported } : {}), ...(optionsOperation ? { optionsOperation } : {}),
        ...(!enrolling && message ? { message } : {}), ...(!enrolling && "notice" in command ? { notices: [command.notice] } : {}),
        ...(!enrolling && "nextSeq" in command ? { throughSeq: command.nextSeq - 1 } : {}),
        ...(!enrolling && "subagents" in command ? { subagents: command.subagents } : {}) }, now: this.now() });
    if (enrolling) captureInitialMetadata(this.db, scope, command.operationId, { chat: portableFacts(facts, 0),
      lifecycleKind: String(row.lifecycle_kind), archivedAt: facts.archivedAt ?? null });
    else captureMetadataEdit(this.db, scope, command.operationId, facts);
  }
  archiveBeforeRemoval(chatId: string, deviceId: string, operationId: string, retainedAppId?: string) {
    if (this.db.prepare("SELECT 1 FROM chat_classification_candidates WHERE chat_id=? AND state IN ('pending','confirmed') LIMIT 1").get(chatId)) throw new Error("CHAT_CLASSIFICATION_PENDING");
    const row = this.db.prepare("SELECT * FROM chats WHERE id=?").get(chatId) as Row | undefined;
    if (!row) return;
    if (retainedAppId && (row.conversation_kind === "ordinary" || row.portable_app_id !== retainedAppId)) throw new Error("APP_TRANSCRIPT_OWNER_CHANGED");
    const archived = row.conversation_kind !== "ordinary" || row.cloud_state !== "local-only" ?
      archiveDeletion(this.db, this.reader, chatId, String(row.incarnation_id), deviceId, operationId, this.now()) : null;
    if (retainedAppId) { retainAppTranscript(this.db, row, deviceId, operationId, archived!.sourceIds, this.now()); return; }
    if (row.cloud_state !== "local-only") {
      const scope = { environment: String(row.cloud_environment), userId: String(row.cloud_user_id) };
      this.assertScope(scope);
      const attempt = readChatDeletion(this.db, scope, chatId);
      const confirmed = readDeletionMarker(this.db, scope, chatId) ?? (attempt.result && attempt.result.status !== "conflicted" ? attempt.result.tombstone : null);
      if (attempt.pending || attempt.result?.status === "conflicted") throw new Error("CHAT_DELETION_CONFIRMATION_REQUIRED");
      const metadata = this.db.prepare("SELECT confirmed_json FROM cloud_chat_metadata_state WHERE chat_id=?").get(chatId) as Row | undefined;
      const head = metadata?.confirmed_json ? cloudChatHeadSchema.parse(JSON.parse(String(metadata.confirmed_json))) : null;
      const expectedRevision = head?.chat.cloudRevision ?? null;
      if (confirmed && head) archiveDeletedExecution(this.db, this.reader, scope, deviceId, head, this.now());
      for (const pending of this.db.prepare("SELECT id FROM cloud_outbox WHERE environment=? AND user_id=? AND json_extract(payload_json,'$.chatId')=?").all(scope.environment, scope.userId, chatId) as Row[]) {
        this.db.prepare("DELETE FROM cloud_outbox WHERE id=?").run(String(pending.id));
        releaseRoot(this.db, `outbox:${String(pending.id)}`);
      }
      if (confirmed) { rememberDeletion(this.db, scope, confirmed, String(row.incarnation_id), this.now()); return; }
      enqueueSource(this.db, { id: operationId, scope, chatId, entityKind: "tombstone", kind: "delete-chat", revision: Number(row.core_revision),
        payload: { chatId, incarnationId: row.incarnation_id, expectedRevision, classification: { conversationKind: row.conversation_kind,
          appId: row.portable_app_id, projectId: row.portable_project_id } }, now: this.now() });
      this.db.prepare("INSERT OR REPLACE INTO cloud_tombstones(environment,user_id,chat_id,incarnation_id,deleted_at) VALUES(?,?,?,?,?)")
        .run(scope.environment, scope.userId, chatId, String(row.incarnation_id), this.now());
    }
  }
  private cleanup(scope: SyncScope, retained: string[]) {
    this.db.prepare(`INSERT OR IGNORE INTO chat_retention_roots(root_id,source_id)
      SELECT 'detached-classification:' || candidate.operation_id, root.source_id
      FROM chat_classification_candidates candidate JOIN chat_retention_roots root ON root.root_id='outbox:' || candidate.operation_id
      WHERE candidate.environment=? AND candidate.user_id=?`).run(scope.environment, scope.userId);
    const rows = this.db.prepare("SELECT id,cloud_state FROM chats WHERE cloud_environment=? AND cloud_user_id=?").all(scope.environment, scope.userId) as Row[];
    for (const row of rows) {
      if (row.cloud_state === "mirror") {
        releaseMirrorArchiveRoots(this.db, scope, String(row.id));
        this.db.prepare("DELETE FROM chats WHERE id=?").run(String(row.id));
      }
      else {
        if (!retained.includes(String(row.id))) throw new Error("Local Chat removal requires lifecycle deletion custody");
        this.db.prepare(`UPDATE chats SET cloud_state='local-only',cloud_environment=NULL,cloud_user_id=NULL,cloud_revision=NULL,
          cloud_owner_device_id=NULL,
          cloud_native_session_device_id=NULL,cloud_home_snapshot_id=NULL WHERE id=?`).run(String(row.id));
      }
    }
    for (const row of this.db.prepare("SELECT id,metadata_status FROM cloud_outbox WHERE environment=? AND user_id=?").all(scope.environment, scope.userId) as Row[]) {
      if (["queued", "blocked", "conflicted"].includes(String(row.metadata_status))) {
        this.db.prepare(`INSERT OR IGNORE INTO chat_retention_roots(root_id,source_id)
          SELECT ?,source_id FROM chat_retention_roots WHERE root_id=?`)
          .run(`detached-metadata:${String(row.id)}`, `outbox:${String(row.id)}`);
      }
      this.db.prepare("DELETE FROM cloud_outbox WHERE id=?").run(String(row.id));
      releaseRoot(this.db, `outbox:${String(row.id)}`);
    }
    this.db.prepare("UPDATE chat_classification_candidates SET state='detached' WHERE environment=? AND user_id=?").run(scope.environment, scope.userId);
    this.db.prepare("UPDATE chat_retained_sources SET environment=NULL,user_id=NULL WHERE environment=? AND user_id=? AND local_device_id IS NOT NULL").run(scope.environment, scope.userId);
    for (const table of ["cloud_outbox", "cloud_chat_metadata_state", "cloud_turn_receipts", "cloud_blobs", "cloud_tombstones", "cloud_sync_state"]) {
      this.db.prepare(`DELETE FROM ${table} WHERE environment=? AND user_id=?`).run(scope.environment, scope.userId);
    }
    return { cleaned: true, retainedChatIds: retained };
  }
}
