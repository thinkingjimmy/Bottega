/**
 * [INPUT]: Depends on portable Chat codecs, SQLite row writers and committed Home preparation evidence.
 * [OUTPUT]: Provides readonly mirrors, persisted sequence watermarks, fenced materialization and monotonic turn settlement.
 * [POS]: Mirror read model never creates local authority; explicit materialization only admits ordinary Chats.
 */
import { chatRecordSchema, messageSchema, subagentsSchema } from "../../chat-schema";
import { portableChatSchema, turnReceiptSchema, canonicalJson, projectChatClassification, type SyncScope } from "../../../../../shared/local-storage/contracts";
import type { ChatRecord } from "../../../../../shared/chats-ipc";
import type { SqliteDatabase } from "../connection";
import type { ChatRepositoryReader } from "../repository/reader";
import type { ChatRecordWriter } from "../repository/writer";
import { digest, json, type Row } from "../repository/codec";
import type { CloudAction } from "./protocol";
import { retainSource } from "./retention";

export class MirrorTransactions {
  constructor(private db: SqliteDatabase, private reader: ChatRepositoryReader, private writer: ChatRecordWriter, private now: () => number) {}
  put(action: Extract<CloudAction, { type: "put-mirror" }>, scope: SyncScope) {
    const chat = portableChatSchema.parse(action.chat);
    if (this.db.prepare("SELECT 1 FROM cloud_tombstones WHERE environment=? AND user_id=? AND chat_id=?").get(scope.environment, scope.userId, chat.id)) throw new Error("CHAT_DELETED");
    const existing = this.db.prepare("SELECT * FROM chats WHERE id=?").get(chat.id) as Row | undefined;
    if (existing && (existing.cloud_state !== "mirror" || existing.cloud_environment !== scope.environment || existing.cloud_user_id !== scope.userId || existing.incarnation_id !== chat.incarnationId)) throw new Error("CHAT_IDENTITY_CONFLICT");
    if (existing && Number(existing.cloud_revision) >= chat.cloudRevision) {
      const portable = this.db.prepare("SELECT portable_json FROM cloud_chat_mirrors WHERE chat_id=?").get(chat.id) as Row;
      if (existing.cloud_revision !== chat.cloudRevision || canonicalJson(JSON.parse(String(portable.portable_json))) !== canonicalJson(chat) ||
          canonicalJson(this.messages(chat.id)) !== canonicalJson(action.messages) || canonicalJson(this.subagents(chat.id)) !== canonicalJson(action.subagents)) throw new Error("MIRROR_REVISION_CONFLICT");
      return { chatId: chat.id, cloudRevision: chat.cloudRevision, count: this.messages(chat.id).length };
    }
    if (existing) this.archive(chat.id, `mirror:${chat.id}:${chat.cloudRevision}`);
    this.db.prepare(`INSERT INTO chats(id,lifecycle_kind,agent,agent_revision,options_json,title,title_source,created_at,updated_at,
      incarnation_id,next_seq,core_revision,native_message_revision,conversation_kind,portable_app_id,portable_project_id,
      cloud_state,cloud_environment,cloud_user_id,cloud_revision)
      VALUES(?,'native',?,?,?,?, 'user',?,?,?,1,0,0,?,?,?,'mirror',?,?,?)
      ON CONFLICT(id) DO UPDATE SET title=excluded.title,agent=excluded.agent,agent_revision=excluded.agent_revision,
      options_json=excluded.options_json,updated_at=excluded.updated_at,conversation_kind=excluded.conversation_kind,
      portable_app_id=excluded.portable_app_id,portable_project_id=excluded.portable_project_id,cloud_revision=excluded.cloud_revision`).run(
      chat.id, chat.agent, chat.agentRevision, json(chat.options), chat.title, chat.createdAt, chat.updatedAt, chat.incarnationId,
      chat.classification.conversationKind, chat.classification.appId, chat.classification.projectId, scope.environment, scope.userId, chat.cloudRevision);
    this.db.prepare(`INSERT INTO cloud_chat_mirrors(chat_id,environment,user_id,portable_json) VALUES(?,?,?,?)
      ON CONFLICT(chat_id) DO UPDATE SET portable_json=excluded.portable_json,preparation_json=NULL`).run(chat.id, scope.environment, scope.userId, json(chat));
    this.writer.writeMessages({ id: chat.id, messages: action.messages } as ChatRecord);
    this.db.prepare("UPDATE chats SET next_seq=MAX(next_seq,?) WHERE id=?").run(Math.max(1, ...action.messages.map(item => item.seq + 1)), chat.id);
    this.writer.writeSubagentSnapshot(chat.id, action.subagents);
    this.writer.writeTitleSearchDocument(chat.id, chat.title);
    return { chatId: chat.id, cloudRevision: chat.cloudRevision, count: action.messages.length };
  }
  read(chatId: string, scope: SyncScope, afterSeq: number, limit: number) {
    const row = this.db.prepare(`SELECT m.portable_json,m.preparation_json,c.next_seq FROM cloud_chat_mirrors m
      JOIN chats c ON c.id=m.chat_id WHERE m.chat_id=? AND m.environment=? AND m.user_id=?`)
      .get(chatId, scope.environment, scope.userId) as Row | undefined;
    if (!row) return null;
    const messages = (this.db.prepare("SELECT payload_json FROM chat_messages WHERE chat_id=? AND seq>? ORDER BY seq LIMIT ?")
      .all(chatId, afterSeq, limit) as Row[]).map(item => messageSchema.parse(JSON.parse(String(item.payload_json))));
    return { chat: portableChatSchema.parse(JSON.parse(String(row.portable_json))), nextSeq: Number(row.next_seq), messages,
      executable: false as const, subagents: this.subagents(chatId), preparation: row.preparation_json ? JSON.parse(String(row.preparation_json)) : null };
  }
  prepare(action: Extract<CloudAction, { type: "prepare-materialization" }>, scope: SyncScope) {
    const mirror = this.read(action.chatId, scope, 0, 1);
    if (!mirror || mirror.chat.cloudRevision !== action.expectedCloudRevision ||
        mirror.chat.classification.conversationKind !== "ordinary" || action.evidence.chatId !== action.chatId ||
        action.evidence.incarnationId !== mirror.chat.incarnationId || action.evidence.projectId !== mirror.chat.classification.projectId) throw new Error("MIRROR_PREPARATION_REJECTED");
    if (mirror.preparation && canonicalJson(mirror.preparation) !== canonicalJson(action.evidence)) throw new Error("MIRROR_PREPARATION_CONFLICT");
    this.db.prepare("UPDATE cloud_chat_mirrors SET preparation_json=? WHERE chat_id=?").run(json(action.evidence), action.chatId);
    return { chatId: action.chatId, prepared: true };
  }
  materialize(action: Extract<CloudAction, { type: "materialize" }>, scope: SyncScope, deviceId: string) {
    const record = chatRecordSchema.parse(action.record);
    const mirror = this.read(record.id, scope, 0, 1);
    if (!mirror || !mirror.preparation || mirror.chat.cloudRevision !== action.expectedCloudRevision ||
        mirror.chat.classification.conversationKind !== "ordinary" ||
        mirror.preparation.homeDir !== record.homeDir || record.incarnationId !== mirror.chat.incarnationId || record.nextSeq !== mirror.nextSeq ||
        record.session || record.grants.length || record.appRole || record.importOrigin || record.parentChatId ||
        record.agent !== mirror.chat.agent || record.agentRevision !== mirror.chat.agentRevision || record.title !== mirror.chat.title ||
        record.createdAt !== mirror.chat.createdAt || canonicalJson(record.subagents ?? {}) !== canonicalJson(this.subagents(record.id)) ||
        canonicalJson(projectChatClassification(record)) !== canonicalJson(mirror.chat.classification) ||
        canonicalJson(record.options) !== canonicalJson(mirror.chat.options) ||
        canonicalJson(record.messages) !== canonicalJson(this.messages(record.id))) throw new Error("MIRROR_MATERIALIZATION_REJECTED");
    this.writer.writeCore(record, "native");
    this.writer.writeLocalFacts(record, deviceId);
    this.writer.writeSearchDocuments(record);
    this.db.prepare("UPDATE chats SET cloud_state='synced' WHERE id=?").run(record.id);
    this.db.prepare("DELETE FROM cloud_chat_mirrors WHERE chat_id=?").run(record.id);
    return { chatId: record.id, materialized: true };
  }
  settle(action: Extract<CloudAction, { type: "settle-turn" }>, scope: SyncScope, deviceId: string) {
    const receipt = turnReceiptSchema.parse(action.receipt);
    const row = this.db.prepare("SELECT * FROM chats WHERE id=? AND cloud_environment=? AND cloud_user_id=?")
      .get(receipt.chatId, scope.environment, scope.userId) as Row | undefined;
    if (!row || row.incarnation_id !== receipt.incarnationId) throw new Error("TURN_IDENTITY_CONFLICT");
    const message = action.message;
    if (receipt.settlementState !== "settled" && message) throw new Error("TURN_RESULT_BEFORE_SETTLEMENT");
    if (receipt.settlementState === "settled" && ((receipt.resultKind === "message") !== Boolean(message) || (message && (
      message.id !== receipt.assistantMessageId || message.seq !== receipt.assistantSeq || message.role !== "assistant" ||
      message.turnId !== receipt.turnId || message.resultHash !== receipt.resultHash ||
      digest(canonicalJson({ ...message, resultHash: undefined })) !== receipt.resultHash ||
      !message.completion || (message.completion === "interrupted") !== Boolean(message.completionReason))))) throw new Error("TURN_RESULT_CONFLICT");
    const previous = this.db.prepare("SELECT receipt_json FROM cloud_turn_receipts WHERE environment=? AND user_id=? AND turn_id=?")
      .get(scope.environment, scope.userId, receipt.turnId) as Row | undefined;
    if (previous) {
      const old = turnReceiptSchema.parse(JSON.parse(String(previous.receipt_json)));
      if (old.identityHash !== receipt.identityHash || old.chatId !== receipt.chatId || old.executionEpoch !== receipt.executionEpoch ||
          old.executorDeviceId !== receipt.executorDeviceId || old.userSeq !== receipt.userSeq || old.assistantSeq !== receipt.assistantSeq ||
          old.userMessageId !== receipt.userMessageId || old.assistantMessageId !== receipt.assistantMessageId) throw new Error("TURN_IDENTITY_CONFLICT");
      if (old.settlementState === "settled") {
        if (canonicalJson(old) !== canonicalJson(receipt)) throw new Error("TURN_ALREADY_SETTLED");
        this.advanceCursor(scope, action.cursor);
        return { chatId: receipt.chatId, settled: true };
      }
      if (["open", "sealing", "settled"].indexOf(receipt.settlementState) < ["open", "sealing", "settled"].indexOf(old.settlementState)) throw new Error("TURN_RECEIPT_REGRESSION");
    }
    if (receipt.settlementState === "settled") {
      for (const later of this.db.prepare("SELECT receipt_json FROM cloud_turn_receipts WHERE chat_id=? AND settlement_state='settled'").iterate(receipt.chatId) as Iterable<Row>) {
        if (turnReceiptSchema.parse(JSON.parse(String(later.receipt_json))).assistantSeq > receipt.assistantSeq) throw new Error("TURN_BACKFILL_ORDER_CONFLICT");
      }
      const native = this.reader.getRecord(receipt.chatId, deviceId);
      const before = this.messages(receipt.chatId);
      const tail = before.filter(item => item.seq >= receipt.assistantSeq);
      if (tail.length && canonicalJson(tail) !== canonicalJson(message ? [message] : [])) this.archive(receipt.chatId, `settlement:${receipt.turnId}`);
      const messages = [...before.filter(item => item.seq < receipt.assistantSeq), ...(message ? [message] : [])];
      if (native) {
        const next = chatRecordSchema.parse({ ...native, messages, chatRecordRevision: native.chatRecordRevision + 1,
          chatMessageRevision: native.chatMessageRevision + 1, nextSeq: Math.max(native.nextSeq, receipt.assistantSeq + 1) });
        this.writer.writeCore(next, native.importOrigin ? "external-managed" : "native");
        this.writer.writeLocalFacts(next, deviceId);
        this.writer.writeMessages(next);
        this.writer.writeSearchDocuments(next);
      } else {
        this.writer.writeMessages({ id: receipt.chatId, messages } as ChatRecord);
        this.db.prepare("UPDATE chats SET next_seq=MAX(next_seq,?),core_revision=core_revision+1,native_message_revision=native_message_revision+1 WHERE id=?")
          .run(receipt.assistantSeq + 1, receipt.chatId);
      }
    }
    this.db.prepare(`INSERT INTO cloud_turn_receipts(environment,user_id,chat_id,turn_id,execution_epoch,settlement_state,receipt_json,updated_at)
      VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(environment,user_id,turn_id) DO UPDATE SET settlement_state=excluded.settlement_state,receipt_json=excluded.receipt_json,updated_at=excluded.updated_at`)
      .run(scope.environment, scope.userId, receipt.chatId, receipt.turnId, receipt.executionEpoch, receipt.settlementState, json(receipt), this.now());
    this.advanceCursor(scope, action.cursor);
    return { chatId: receipt.chatId, settled: receipt.settlementState === "settled" };
  }
  private advanceCursor(scope: SyncScope, cursor: string) {
    this.db.prepare("UPDATE cloud_sync_state SET body_backfill_cursor=?,updated_at=? WHERE environment=? AND user_id=?")
      .run(cursor, this.now(), scope.environment, scope.userId);
  }
  private subagents(chatId: string) {
    const rows = this.db.prepare("SELECT agent_thread_id,meta_json,parts_json FROM chat_subagents WHERE chat_id=? ORDER BY agent_thread_id").all(chatId) as Row[];
    return subagentsSchema.parse(Object.fromEntries(rows.map(row => [String(row.agent_thread_id), { meta: JSON.parse(String(row.meta_json)), parts: JSON.parse(String(row.parts_json)) }])));
  }
  private messages(chatId: string) {
    return (this.db.prepare("SELECT payload_json FROM chat_messages WHERE chat_id=? ORDER BY seq").all(chatId) as Row[])
      .map(row => messageSchema.parse(JSON.parse(String(row.payload_json))));
  }
  archive(chatId: string, rootId: string) {
    const messages = this.messages(chatId);
    const row = this.db.prepare("SELECT * FROM chats WHERE id=?").get(chatId) as Row;
    const subagents = this.db.prepare("SELECT * FROM chat_subagents WHERE chat_id=?").all(chatId);
    return retainSource(this.db, { chatId, rootId, kind: "superseded-tail", revision: Number(row.core_revision),
      payload: { classification: { conversationKind: row.conversation_kind, appId: row.portable_app_id, projectId: row.portable_project_id }, messages, subagents }, now: this.now() });
  }
}
