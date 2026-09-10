/**
 * [INPUT]: Depends on the sole worker database, scope mode, canonical readers/writers and retention leaves.
 * [OUTPUT]: Provides scoped transactions, post-snapshot Chat enrollment, immutable outbox evidence and precise mirror cleanup.
 * [POS]: Composed ChatRepository collaborator; every mutation shares its existing operation receipt transaction.
 */
import { isAbsolute } from "node:path";
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
import { archiveDeletion, captureInitial, portableFacts } from "./snapshots";
import { enqueueSource, releaseMirrorArchiveRoots, releaseRoot, retainImportedHistory, writeClassification } from "./retention";

export class ChatCloudRepository {
  private readonly mode: StorageMode;
  private readonly classifications: ClassificationTransactions;
  private readonly mirrors: MirrorTransactions;
  constructor(private db: SqliteDatabase, private reader: ChatRepositoryReader, writer: ChatRecordWriter,
    private now: () => number, mode: StorageMode = { kind: "local-only" }) {
    this.mode = storageModeSchema.parse(mode);
    this.classifications = new ClassificationTransactions(db, reader, writer);
    this.mirrors = new MirrorTransactions(db, reader, writer, now);
  }
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
    if (command.requestHash !== digest(canonicalJson({ ...command, requestHash: undefined }))) throw new Error("CLOUD_REQUEST_HASH_MISMATCH");
    if (scope && action.type !== "cleanup-scope") this.db.prepare(`INSERT OR IGNORE INTO cloud_sync_state(environment,user_id,updated_at) VALUES(?,?,?)`)
      .run(scope.environment, scope.userId, this.now());
    let value: unknown;
    switch (action.type) {
      case "capture-initial": value = captureInitial(this.db, this.reader, scope!, deviceId, action.manifestId, this.now()); break;
      case "put-mirror": value = this.mirrors.put(action, scope!); break;
      case "prepare-materialization": value = this.mirrors.prepare(action, scope!); break;
      case "materialize": value = this.mirrors.materialize(action, scope!, deviceId); break;
      case "settle-turn": value = this.mirrors.settle(action, scope!, deviceId); break;
      case "propose-classification": {
        const stored = this.scopedChat(action.facts.id, scope);
        if (stored.cloud_state !== "local-only" && !scope) throw new Error("SYNC_SCOPE_REQUIRED");
        value = this.classifications.propose(action, deviceId, scope); break;
      }
      case "confirm-classification": value = this.classifications.confirm(action, scope!); break;
      case "commit-classification": {
        value = this.classifications.commit(action.lifecycleOperationId, deviceId, scope);
        const candidate = this.classifications.get(action.lifecycleOperationId)!;
        this.recordBusinessCommit(command, String(candidate.chat_id)); break;
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
        turnSequencesSchema.parse({ executorNoticeSeq: evidence.executorNoticeSeq, noticeSeq: evidence.noticeSeq, userSeq: evidence.userSeq, assistantSeq: evidence.assistantSeq });
        if (digest(canonicalJson(handoffIdentity(action))) !== evidence.identityHash) throw new Error("TURN_HANDOFF_IDENTITY_MISMATCH");
        if (evidence.userMessage.role !== "user" || evidence.userMessage.id !== evidence.userMessageId || evidence.userMessage.seq !== evidence.userSeq ||
          evidence.assistantSeq !== evidence.userSeq + 1 || (evidence.resultKind === "message") !== Boolean(evidence.resultMessage) ||
          (evidence.resultKind === "empty" && evidence.resultHash !== digest(canonicalJson(null))) ||
          (evidence.resultMessage && (evidence.resultMessage.id !== evidence.assistantMessageId || evidence.resultMessage.seq !== evidence.assistantSeq || evidence.resultMessage.role !== "assistant" ||
            digest(canonicalJson({ ...evidence.resultMessage, resultHash: undefined })) !== evidence.resultHash))) throw new Error("TURN_HANDOFF_INCOMPLETE");
        value = enqueueSource(this.db, { id: command.operationId, scope: scope!, chatId: action.chatId, entityKind: "turn", entityId: action.turnId,
          kind: "ledger-handoff", revision: evidence.assistantSeq, executionEpoch: action.executionEpoch, payload: { turnId: action.turnId, ...evidence }, now: this.now() }); break;
      }
      case "attempt-outbox": case "ack-outbox": {
        const item = this.db.prepare("SELECT * FROM cloud_outbox WHERE id=? AND environment=? AND user_id=?")
          .get(action.id, scope!.environment, scope!.userId) as Row | undefined;
        if (!item || item.payload_digest !== action.payloadDigest) throw new Error("OUTBOX_IDENTITY_MISMATCH");
        if (action.type === "attempt-outbox") this.db.prepare("UPDATE cloud_outbox SET attempts=attempts+1,last_error=? WHERE id=?").run(action.error, action.id);
        else {
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
      case "cleanup-scope": value = this.cleanup(scope!, action.retainedChatIds); break;
    }
    return cloudResultSchema.parse(boundedCloudValue({ type: action.type, value: JSON.parse(json(value)) }));
  }
  read(raw: CloudRead) {
    const { query, scope, deviceId } = cloudReadSchema.parse(raw);
    this.assertScope(scope, ["state", "custody", "source", "source-blob", "classification"].includes(query.type));
    let value: unknown;
    switch (query.type) {
      case "state": value = scope ? this.db.prepare("SELECT * FROM cloud_sync_state WHERE environment=? AND user_id=?").get(scope.environment, scope.userId) ?? null : {
        scopes: Number((this.db.prepare("SELECT COUNT(*) n FROM cloud_sync_state").get() as Row).n),
        outbox: Number((this.db.prepare("SELECT COUNT(*) n FROM cloud_outbox").get() as Row).n),
        receipts: Number((this.db.prepare("SELECT COUNT(*) n FROM cloud_turn_receipts").get() as Row).n) }; break;
      case "mirror": value = this.mirrors.read(query.chatId, scope!, query.afterSeq, query.limit); break;
      case "outbox": value = this.db.prepare("SELECT * FROM cloud_outbox WHERE environment=? AND user_id=? AND id>? ORDER BY id LIMIT ?")
        .all(scope!.environment, scope!.userId, query.afterId ?? "", query.limit); break;
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
          const hash = createHash("sha256"), buffer = Buffer.alloc(Math.min(bytes, 1024 * 1024));
          for (let offset = 0; offset < bytes;) {
            const read = readSync(file, buffer, 0, Math.min(buffer.length, bytes - offset), offset);
            if (!read) throw new Error("BLOB_INTEGRITY_FAILED");
            hash.update(buffer.subarray(0, read)); offset += read;
          }
          if (hash.digest("hex") !== query.sha256) throw new Error("BLOB_INTEGRITY_FAILED");
          const chunk = Buffer.alloc(Math.min(query.length, bytes - query.offset));
          if (readSync(file, chunk, 0, chunk.length, query.offset) !== chunk.length) throw new Error("BLOB_INTEGRITY_FAILED");
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
    if (!chatId || !("deviceId" in command) || !("operationId" in command)) return;
    const row = this.db.prepare("SELECT * FROM chats WHERE id=?").get(chatId) as Row | undefined;
    if (!row) return;
    const enrolling = row.cloud_state === "local-only";
    if (enrolling) {
      if (this.mode.kind === "local-only" || !this.db.prepare(`SELECT 1 FROM cloud_sync_state
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
    const facts = this.reader.listMetadata(command.deviceId, chatId)[0];
    if (!facts) throw new Error("Chat facts unavailable for outbox");
    const projected = projectChatClassification(facts);
    if (projected.conversationKind !== row.conversation_kind || projected.appId !== row.portable_app_id || projected.projectId !== row.portable_project_id) throw new Error("CHAT_CLASSIFICATION_DRIFT");
    if (this.db.prepare("SELECT 1 FROM chat_classification_candidates WHERE chat_id=? AND state IN ('pending','confirmed') LIMIT 1").get(chatId)) throw new Error("CHAT_CLASSIFICATION_PENDING");
    const message = "message" in command ? command.message : null;
    const record = enrolling && facts.readOnlyReason !== "external-readonly" ? this.reader.getRecord(chatId, command.deviceId) : "record" in command ? command.record : null;
    const imported = enrolling ?
      retainImportedHistory(this.db, chatId, `outbox:${command.operationId}`, this.now(), scope) : null;
    enqueueSource(this.db, { id: command.operationId, scope, chatId, entityKind: message ? "message" : "chat",
      kind: command.kind, revision: facts.chatRecordRevision, executionEpoch: row.cloud_execution_epoch as number | null,
      payload: { chat: portableFacts(facts, Number(row.cloud_revision)), ...(record ? { messages: record.messages,
        subagents: record.subagents ?? {}, branches: record.supersededBranches ?? [] } : {}),
        ...(imported ? { imported } : {}),
        ...(message ? { message } : {}), ...("subagents" in command ? { subagents: command.subagents } : {}) }, now: this.now() });
  }
  archiveBeforeRemoval(chatId: string, deviceId: string, operationId: string) {
    const row = this.db.prepare("SELECT * FROM chats WHERE id=?").get(chatId) as Row | undefined;
    if (!row) return;
    if (row.conversation_kind !== "ordinary" || row.cloud_state !== "local-only") {
      archiveDeletion(this.db, this.reader, chatId, String(row.incarnation_id), deviceId, operationId, this.now());
    }
    if (row.cloud_state !== "local-only") {
      const scope = { environment: String(row.cloud_environment), userId: String(row.cloud_user_id) };
      this.assertScope(scope);
      for (const pending of this.db.prepare("SELECT id FROM cloud_outbox WHERE environment=? AND user_id=? AND json_extract(payload_json,'$.chatId')=?").all(scope.environment, scope.userId, chatId) as Row[]) {
        releaseRoot(this.db, `outbox:${String(pending.id)}`);
        this.db.prepare("DELETE FROM cloud_outbox WHERE id=?").run(String(pending.id));
      }
      enqueueSource(this.db, { id: operationId, scope, chatId, entityKind: "tombstone", kind: "delete-chat", revision: Number(row.core_revision),
        executionEpoch: row.cloud_execution_epoch as number | null,
        payload: { chatId, incarnationId: row.incarnation_id, classification: { conversationKind: row.conversation_kind,
          appId: row.portable_app_id, projectId: row.portable_project_id } }, now: this.now() });
      this.db.prepare("INSERT OR REPLACE INTO cloud_tombstones(environment,user_id,chat_id,incarnation_id,deleted_at) VALUES(?,?,?,?,?)")
        .run(scope.environment, scope.userId, chatId, String(row.incarnation_id), this.now());
    }
  }
  private cleanup(scope: SyncScope, retained: string[]) {
    const rows = this.db.prepare("SELECT id,cloud_state FROM chats WHERE cloud_environment=? AND cloud_user_id=?").all(scope.environment, scope.userId) as Row[];
    for (const row of rows) {
      if (row.cloud_state === "mirror") {
        releaseMirrorArchiveRoots(this.db, scope, String(row.id));
        this.db.prepare("DELETE FROM chats WHERE id=?").run(String(row.id));
      }
      else {
        if (!retained.includes(String(row.id))) throw new Error("Local Chat removal requires lifecycle deletion custody");
        this.db.prepare(`UPDATE chats SET cloud_state='local-only',cloud_environment=NULL,cloud_user_id=NULL,cloud_revision=NULL,
          cloud_executor_device_id=NULL,cloud_execution_epoch=NULL,cloud_last_committed_executor_device_id=NULL,
          cloud_native_session_device_id=NULL,cloud_home_snapshot_id=NULL WHERE id=?`).run(String(row.id));
      }
    }
    for (const row of this.db.prepare("SELECT id FROM cloud_outbox WHERE environment=? AND user_id=?").all(scope.environment, scope.userId) as Row[]) {
      releaseRoot(this.db, `outbox:${String(row.id)}`);
    }
    this.db.prepare("DELETE FROM chat_classification_candidates WHERE environment=? AND user_id=? AND state='committed'").run(scope.environment, scope.userId);
    if (this.db.prepare("SELECT 1 FROM chat_classification_candidates WHERE environment=? AND user_id=? LIMIT 1").get(scope.environment, scope.userId)) throw new Error("CLASSIFICATION_CUSTODY_REQUIRES_RESOLUTION");
    this.db.prepare("UPDATE chat_retained_sources SET environment=NULL,user_id=NULL WHERE environment=? AND user_id=? AND local_device_id IS NOT NULL").run(scope.environment, scope.userId);
    for (const table of ["cloud_outbox", "cloud_turn_receipts", "cloud_blobs", "cloud_tombstones", "cloud_sync_state"]) {
      this.db.prepare(`DELETE FROM ${table} WHERE environment=? AND user_id=?`).run(scope.environment, scope.userId);
    }
    return { cleaned: true, retainedChatIds: retained };
  }
}
