/**
 * [INPUT]: Depends on portable Chat codecs, SQLite row writers and committed Home preparation evidence.
 * [OUTPUT]: Provides bounded mirrors and atomic settlement preserving verified same-owner successors after explicit replacement.
 * [POS]: Mirror read model never creates local authority; explicit materialization only admits ordinary Chats.
 */
import { portableForkLineage } from "@ai-chat/cloud-protocol/chats/model";
import { chatRecordSchema, messageSchema, subagentsSchema } from "../../chat-schema";
import { portableChatSchema, turnReceiptSchema, canonicalJson, projectChatClassification, type SyncScope } from "../../../../../shared/local-storage/contracts";
import type { ChatRecord } from "../../../../../shared/chats-ipc";
import type { SqliteDatabase } from "../connection";
import type { ChatRepositoryReader } from "../repository/reader";
import type { ChatRecordWriter } from "../repository/writer";
import { digest, json, type Row } from "../repository/codec";
import type { CloudAction } from "./protocol";
import { retainSource } from "./retention";
import { captureMirrorMetadata } from "./delivery/metadata-capture";
import { projectPortableMessage } from "@ai-chat/cloud-protocol/chats/content/projection";
import { readMirrorDownload } from "./mirror/downloads";
import { readMetadataState } from "./delivery/metadata-confirm";
import { archiveSupersededTail } from "./settlement/custody";
import { acknowledgeTurnOutbox, replacementSuccessorThrough, turnOutboxDigest } from "./settlement/outbox";
import { writeMirrorFiles } from "./mirror/files";
import { activateCloudImport } from "./imported/downloads";
import { readImportDownload } from "./imported/state";
import { mirrorExecutionWindow } from "./mirror/window";

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
    this.db.prepare(`INSERT INTO chats(id,lifecycle_kind,agent,agent_revision,options_json,title,title_source,created_at,updated_at,sort_key,
      incarnation_id,next_seq,core_revision,native_message_revision,conversation_kind,portable_app_id,portable_project_id,
      cloud_state,cloud_environment,cloud_user_id,cloud_revision)
      VALUES(?,'native',?,?,?,?, 'user',?,?,?,?,1,0,0,?,?,?,'mirror',?,?,?)
      ON CONFLICT(id) DO UPDATE SET title=excluded.title,agent=excluded.agent,agent_revision=excluded.agent_revision,
      options_json=excluded.options_json,updated_at=excluded.updated_at,sort_key=excluded.sort_key,conversation_kind=excluded.conversation_kind,
      portable_app_id=excluded.portable_app_id,portable_project_id=excluded.portable_project_id,cloud_revision=excluded.cloud_revision`).run(
      chat.id, chat.agent, chat.agentRevision, json(chat.options), chat.title, chat.createdAt, chat.updatedAt, chat.sortKey ?? null, chat.incarnationId,
      chat.classification.conversationKind, chat.classification.appId, chat.classification.projectId, scope.environment, scope.userId, chat.cloudRevision);
    this.db.prepare("UPDATE chats SET parent_chat_id=?,parent_incarnation_id=?,parent_message_id=?,inherited_through_seq=? WHERE id=?")
      .run(chat.parentChatId ?? null, chat.parentIncarnationId ?? null, chat.parentMessageId ?? null, chat.inheritedThroughSeq ?? null, chat.id);
    this.db.prepare(`INSERT INTO cloud_chat_mirrors(chat_id,environment,user_id,portable_json) VALUES(?,?,?,?)
      ON CONFLICT(chat_id) DO UPDATE SET portable_json=excluded.portable_json,preparation_json=NULL`).run(chat.id, scope.environment, scope.userId, json(chat));
    this.writer.writeMessages({ id: chat.id, messages: action.messages } as ChatRecord);
    this.db.prepare("UPDATE chats SET next_seq=MAX(next_seq,?) WHERE id=?").run(Math.max(1, ...action.messages.map(item => item.seq + 1)), chat.id);
    this.writer.writeSubagentSnapshot(chat.id, action.subagents);
    this.writer.writeSearchDocuments({ id: chat.id, title: chat.title, messages: action.messages } as ChatRecord);
    captureMirrorMetadata(this.db, scope, chat);
    return { chatId: chat.id, cloudRevision: chat.cloudRevision, count: action.messages.length };
  }
  catalog(scope: SyncScope, afterId: string | null, limit: number) {
    const rows = this.db.prepare(`SELECT chat_id,portable_json FROM cloud_chat_mirrors
      WHERE environment=? AND user_id=? AND chat_id>? ORDER BY chat_id LIMIT ?`).all(scope.environment, scope.userId, afterId ?? "", limit + 1) as Row[];
    const page = rows.slice(0, limit), complete = rows.length <= limit;
    return { items: page.map(row => portableChatSchema.parse(JSON.parse(String(row.portable_json)))),
      cursor: complete ? null : String(page.at(-1)!.chat_id), complete };
  }
  read(chatId: string, scope: SyncScope, afterSeq: number, limit: number) {
    const row = this.db.prepare(`SELECT m.portable_json,m.preparation_json,c.next_seq,c.trimmed_through_seq FROM cloud_chat_mirrors m
      JOIN chats c ON c.id=m.chat_id WHERE m.chat_id=? AND m.environment=? AND m.user_id=?`)
      .get(chatId, scope.environment, scope.userId) as Row | undefined;
    if (!row) return null;
    const download = readMirrorDownload(this.db, scope, chatId), head = readMetadataState(this.db, scope, chatId).head;
    const bodyReady = download ? download.complete && download.bodyRevision === head?.bodyRevision : !head;
    const rows = this.db.prepare("SELECT payload_json FROM chat_messages WHERE chat_id=? AND seq>? ORDER BY seq LIMIT ?").all(chatId, afterSeq, limit + 1) as Row[];
    const messages = []; let bytes = 0;
    for (const item of rows.slice(0, limit)) {
      const text = String(item.payload_json); if (messages.length && bytes + Buffer.byteLength(text) > 4 * 1024 * 1024) break;
      bytes += Buffer.byteLength(text); messages.push(messageSchema.parse(JSON.parse(text)));
    }
    const complete = bodyReady && messages.length === rows.length;
    return { chat: portableChatSchema.parse(JSON.parse(String(row.portable_json))), nextSeq: row.next_seq === null ? (head?.reservedThroughSeq ?? 0) + 1 : Number(row.next_seq), trimmedThroughSeq: Number(row.trimmed_through_seq), messages: bodyReady ? messages : [],
      executable: false as const, bodyReady, cursor: bodyReady && !complete && messages.length ? messages.at(-1)!.seq : null, complete,
      subagents: bodyReady ? this.subagents(chatId) : {}, preparation: row.preparation_json ? JSON.parse(String(row.preparation_json)) : null };
  }
  prepare(action: Extract<CloudAction, { type: "prepare-materialization" }>, scope: SyncScope) {
    const confirmed = readMetadataState(this.db, scope, action.chatId).head;
    const row = this.db.prepare("SELECT lifecycle_kind,cloud_state FROM chats WHERE id=? AND cloud_environment=? AND cloud_user_id=?").get(action.chatId, scope.environment, scope.userId) as Row | undefined;
    if (confirmed?.kind === "external-managed" && row?.lifecycle_kind === "external-readonly" && row.cloud_state === "synced") {
      const imported = readImportDownload(this.db, scope, action.chatId);
      if (!imported?.complete || imported.bodyRevision !== confirmed.bodyRevision) throw new Error("IMPORT_GENERATION_INCOMPLETE");
      const native = readMirrorDownload(this.db, scope, action.chatId);
      if (!native?.complete || native.bodyRevision !== confirmed.bodyRevision) throw new Error("MIRROR_BODY_UNAVAILABLE");
      const window = mirrorExecutionWindow(this.db, scope, action.chatId);
      this.writer.writeMessages({ id: action.chatId, messages: window.messages } as ChatRecord);
      this.writer.writeSubagentSnapshot(action.chatId, window.subagents);
      this.db.prepare("UPDATE chats SET trimmed_through_seq=? WHERE id=?").run(window.trimmedThroughSeq, action.chatId);
      this.db.prepare(`INSERT INTO cloud_chat_mirrors(chat_id,environment,user_id,portable_json) VALUES(?,?,?,?)
        ON CONFLICT(chat_id) DO UPDATE SET portable_json=excluded.portable_json`).run(action.chatId, scope.environment, scope.userId, json(confirmed.chat));
    }
    const mirror = this.read(action.chatId, scope, 0, 1);
    if (!mirror || !mirror.bodyReady || mirror.chat.cloudRevision !== action.expectedCloudRevision ||
        mirror.chat.classification.conversationKind !== "ordinary" || action.evidence.chatId !== action.chatId ||
        action.evidence.incarnationId !== mirror.chat.incarnationId || action.evidence.projectId !== mirror.chat.classification.projectId) throw new Error("MIRROR_PREPARATION_REJECTED");
    if (mirror.preparation && canonicalJson(mirror.preparation) !== canonicalJson(action.evidence)) throw new Error("MIRROR_PREPARATION_CONFLICT");
    this.db.prepare("UPDATE cloud_chat_mirrors SET preparation_json=? WHERE chat_id=?").run(json(action.evidence), action.chatId);
    return { chatId: action.chatId, prepared: true };
  }
  materialize(action: Extract<CloudAction, { type: "materialize" }>, scope: SyncScope, deviceId: string) {
    const record = chatRecordSchema.parse(action.record);
    const confirmed = readMetadataState(this.db, scope, record.id).head;
    if (confirmed && (confirmed.ownerDeviceId !== deviceId || confirmed.archivedAt !== null || confirmed.openTurnId ||
      confirmed.chat.incarnationId !== record.incarnationId)) throw new Error("EXECUTION_IDENTITY_CHANGED");
    const mirror = this.read(record.id, scope, 0, 1);
    if (!mirror || !mirror.bodyReady || !mirror.preparation || mirror.chat.cloudRevision !== action.expectedCloudRevision ||
        mirror.chat.classification.conversationKind !== "ordinary" ||
        mirror.preparation.homeDir !== record.homeDir || record.incarnationId !== mirror.chat.incarnationId || record.nextSeq !== mirror.nextSeq ||
        (record.trimmedThroughSeq ?? 0) !== mirror.trimmedThroughSeq || record.session || record.grants.length || record.appRole || record.importOrigin ||
        canonicalJson(portableForkLineage(record)) !== canonicalJson(portableForkLineage(mirror.chat)) ||
        record.agent !== mirror.chat.agent || record.agentRevision !== mirror.chat.agentRevision || record.title !== mirror.chat.title ||
        record.createdAt !== mirror.chat.createdAt || (record.sortKey ?? null) !== (mirror.chat.sortKey ?? null) ||
        canonicalJson(record.subagents ?? {}) !== canonicalJson(this.subagents(record.id)) ||
        canonicalJson(projectChatClassification(record)) !== canonicalJson(mirror.chat.classification) ||
        canonicalJson(record.options) !== canonicalJson(mirror.chat.options) ||
        canonicalJson(record.messages) !== canonicalJson(this.messages(record.id))) throw new Error("MIRROR_MATERIALIZATION_REJECTED");
    if (confirmed?.kind === "external-managed") activateCloudImport(this.db, scope, record.id, this.now());
    this.writer.writeCore(record, confirmed?.kind === "external-managed" ? "external-managed" : "native");
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
    if (action.expectedMessageRevision !== undefined && Number(row.native_message_revision) !== action.expectedMessageRevision) throw new Error("REVISION_STALE");
    if (action.expectedOutboxDigest !== undefined && turnOutboxDigest(this.db, scope, receipt.chatId) !== action.expectedOutboxDigest) throw new Error("TURN_OUTBOX_CHANGED");
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
      if (old.identityHash !== receipt.identityHash || old.chatId !== receipt.chatId ||           old.ownerDeviceId !== receipt.ownerDeviceId || old.userSeq !== receipt.userSeq || old.assistantSeq !== receipt.assistantSeq ||
          old.userMessageId !== receipt.userMessageId || old.assistantMessageId !== receipt.assistantMessageId) throw new Error("TURN_IDENTITY_CONFLICT");
      if (old.settlementState === "settled") {
        if (canonicalJson(old) !== canonicalJson(receipt)) throw new Error("TURN_ALREADY_SETTLED");
      }
      if (["open", "sealing", "settled"].indexOf(receipt.settlementState) < ["open", "sealing", "settled"].indexOf(old.settlementState)) throw new Error("TURN_RECEIPT_REGRESSION");
    }
    if (receipt.settlementState === "settled" && receipt.assistantSeq > Number(row.trimmed_through_seq)) {
      const native = this.reader.getRecord(receipt.chatId, deviceId);
      const before = this.messages(receipt.chatId);
      const tail = before.filter(item => item.seq >= receipt.assistantSeq);
      const same = message ? tail[0]?.seq === receipt.assistantSeq && canonicalJson(projectPortableMessage(tail[0])) === canonicalJson(message) : !tail.some(item => item.seq === receipt.assistantSeq);
      let confirmedThrough = replacementSuccessorThrough(this.db, scope, receipt, deviceId, before);
      if (!same) {
        for (const later of this.db.prepare("SELECT receipt_json FROM cloud_turn_receipts WHERE chat_id=? AND settlement_state='settled'").iterate(receipt.chatId) as Iterable<Row>) {
          const settled = turnReceiptSchema.parse(JSON.parse(String(later.receipt_json)));
          if (settled.assistantSeq <= receipt.assistantSeq) continue;
          const result = before.find(item => item.seq === settled.assistantSeq);
          const portable = result ? projectPortableMessage(result) : null;
          if (settled.resultKind === "empty" ? Boolean(result) : !result || result.id !== settled.assistantMessageId ||
            portable?.role !== "assistant" || portable.resultHash !== settled.resultHash) throw new Error("TURN_CANONICAL_SUFFIX_UNAVAILABLE");
          confirmedThrough = Math.max(confirmedThrough, settled.assistantSeq);
        }
        const divergent = tail.some(item => item.seq === receipt.assistantSeq || item.seq > confirmedThrough);
        if (divergent) archiveSupersededTail(this.db, scope, receipt, {
          classification: { conversationKind: row.conversation_kind, appId: row.portable_app_id, projectId: row.portable_project_id },
          messages: before.filter(item => item.seq >= receipt.userSeq), subagents: this.subagents(receipt.chatId),
        }, this.now());
        if (divergent && native?.context.kind === "ordinary" && action.deferReplacement) return { chatId: receipt.chatId, settled: false };
      }
      const messages = same ? before : [...before.filter(item => item.seq < receipt.assistantSeq || item.seq > receipt.assistantSeq && item.seq <= confirmedThrough), ...(message ? [message] : [])].sort((a, b) => a.seq - b.seq);
      const subagentsChanged = action.subagents && Object.entries(action.subagents).some(([id, value]) => canonicalJson(this.subagents(receipt.chatId)[id] ?? null) !== canonicalJson(value));
      const changed = !same || subagentsChanged || Number(row.next_seq) < receipt.assistantSeq + 1;
      if (native && changed) {
        const next = chatRecordSchema.parse({ ...native, messages, subagents: { ...native.subagents, ...action.subagents }, chatRecordRevision: native.chatRecordRevision + 1,
          chatMessageRevision: native.chatMessageRevision + 1, nextSeq: Math.max(native.nextSeq, receipt.assistantSeq + 1) });
        this.writer.writeCore(next, native.importOrigin ? "external-managed" : "native");
        this.writer.writeLocalFacts(next, deviceId);
        this.writer.writeMessages(next);
        this.writer.writeSubagents(next);
        this.writer.writeSearchDocuments(next);
      } else if (changed) {
        this.writer.writeMessages({ id: receipt.chatId, messages } as ChatRecord);
        if (action.subagents) this.writer.writeSubagents({ id: receipt.chatId, subagents: { ...this.subagents(receipt.chatId), ...action.subagents } } as ChatRecord);
        this.db.prepare("UPDATE chats SET next_seq=MAX(next_seq,?),core_revision=core_revision+1,native_message_revision=native_message_revision+1 WHERE id=?")
          .run(receipt.assistantSeq + 1, receipt.chatId);
      }
    }
    this.db.prepare(`INSERT INTO cloud_turn_receipts(environment,user_id,chat_id,turn_id,settlement_state,receipt_json,updated_at)
      VALUES(?,?,?,?,?,?,?) ON CONFLICT(environment,user_id,turn_id) DO UPDATE SET settlement_state=excluded.settlement_state,receipt_json=excluded.receipt_json,updated_at=excluded.updated_at`)
      .run(scope.environment, scope.userId, receipt.chatId, receipt.turnId, receipt.settlementState, json(receipt), this.now());
    this.advanceCursor(scope, action.cursor);
    if (action.files) writeMirrorFiles(this.db, scope, receipt.chatId, receipt.assistantMessageId, action.files, this.now());
    if (action.expectedOutboxDigest !== undefined) acknowledgeTurnOutbox(this.db, scope, receipt, action.message, action.subagents, this.now());
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
