/**
 * [INPUT]: Depends on focused repository reader/writer collaborators, canonical Chat schemas, SQLite transactions, optional import-blob storage, and the closed database protocol
 * [OUTPUT]: Provides transactional narrow turn/fact/presentation and aggregate Chat mutations including readonly removal, imported source_status marking, receipts, native-Memory reads, startup reaping of interrupted imports that also reclaims abandoned generations, immutable-generation GC, self-healing search-projection reconciliation, and bounded timeline plus keyset search facades
 * [POS]: Chat domain SQL transaction authority inside the dedicated worker; row projection details live in repository collaborators
 */

import type { ChatRecord } from "../../../../shared/chats-ipc";
import {
  matchSearchTokens,
  normalizeSearchText,
} from "../../../../shared/search-text";
import {
  chatFactsSchema,
  chatRecordSchema,
  messageSchema,
} from "../chat-schema";
import type { ChatFacts } from "../chat-summary";
import type {
  DatabaseCommand,
  MutationOutcome,
  MutationReceipt,
  RemoveResult,
  SearchDocumentHit,
  UpsertResult,
} from "./database-protocol";
import type { SqliteDatabase } from "./connection";
import { transaction } from "./connection";
import { sqliteFailureOf } from "./failure";
import {
  digest,
  gramTokens,
  json,
  messageFromRow,
  messageSearchText,
  parseJson,
  queryGramTokens,
  receiptFromRow,
  type Row,
} from "./repository/codec";
import { ACTIVE_GENERATION_DOCUMENT_FENCE } from "./repository/imported-sql";
import { ChatRepositoryReader } from "./repository/reader";
import { ChatRecordWriter } from "./repository/writer";
import { HistoryImportRepository } from "./repository/imports";
import { ContinuationSagaRepository } from "./repository/continuation";
import { ChatMemoryReader } from "./repository/readers/memory";
import { ChatFactReader } from "./repository/readers/facts";

type MutationCommand = Extract<
  DatabaseCommand,
  { operationId: string; requestHash: string }
>;

/* 一次搜索页里同一个 Chat 的三类文档必须有确定次序：标题、原生消息、
   导入 entry。它同时是键集游标的第三段，因此排序与断点只能有一份写法。 */
const SEARCH_DOCUMENT_KIND_RANK =
  "CASE d.document_kind WHEN 'title' THEN 0 WHEN 'native' THEN 1 ELSE 2 END";

/* node:sqlite 只接受纯匿名占位符，因此断点的四段键按顺序重复绑定：
   updatedAt, updatedAt, chatId, chatId, kindRank, kindRank, rowId。 */
const SEARCH_DOCUMENT_KEYSET_AFTER = `(
  c.updated_at < ?
  OR (c.updated_at = ? AND (
        c.id > ?
        OR (c.id = ? AND (
              ${SEARCH_DOCUMENT_KIND_RANK} > ?
              OR (${SEARCH_DOCUMENT_KIND_RANK} = ? AND d.row_id > ?)
           ))
     ))
)`;

const nullableString = (value: unknown) =>
  value === null || value === undefined ? null : String(value);
const nullableNumber = (value: unknown) =>
  value === null || value === undefined ? null : Number(value);

export class ChatRepository {
  private readonly reader: ChatRepositoryReader;
  private readonly writer: ChatRecordWriter;
  private readonly imports: HistoryImportRepository;
  private readonly continuations: ContinuationSagaRepository;
  private readonly memory: ChatMemoryReader;
  private readonly facts: ChatFactReader;

  constructor(
    private readonly database: SqliteDatabase,
    private readonly now: () => number = Date.now,
    storage?: Readonly<{ importBlobsRoot?: string }>
  ) {
    this.reader = new ChatRepositoryReader(database);
    this.writer = new ChatRecordWriter(database, now);
    this.imports = new HistoryImportRepository(database, now, storage?.importBlobsRoot);
    this.continuations = new ContinuationSagaRepository(database, now);
    this.memory = new ChatMemoryReader(database);
    this.facts = new ChatFactReader(database);
  }

  listMetadata(deviceId: string, chatId?: string) {
    return this.reader.listMetadata(deviceId, chatId);
  }

  getRecord(chatId: string, deviceId: string) {
    return this.reader.getRecord(chatId, deviceId);
  }

  getNativeMessage(command: Extract<DatabaseCommand, { kind: "get-native-message" }>) {
    return this.facts.getMessage(command);
  }

  getNativeMessages(command: Extract<DatabaseCommand, { kind: "get-native-messages" }>) {
    return this.facts.getMessages(command);
  }

  getNativeSubagents(command: Extract<DatabaseCommand, { kind: "get-native-subagents" }>) {
    return this.facts.getSubagents(command);
  }

  getTimelinePage(
    input: Extract<DatabaseCommand, { kind: "get-timeline-page" }>["input"],
    deviceId: string
  ) {
    return this.reader.getTimelinePage(input, deviceId);
  }

  getTimelineAround(
    input: Extract<DatabaseCommand, { kind: "get-timeline-around" }>["input"],
    deviceId: string
  ) {
    return this.reader.getTimelineAround(input, deviceId);
  }

  getOutlinePage(
    chatId: string,
    cursor: import("../../../../shared/chats-ipc").ChatOutlineCursor | undefined,
    limit: number,
    deviceId: string
  ) {
    return this.reader.getOutlinePage(chatId, cursor, limit, deviceId);
  }

  findMessages(command: Extract<DatabaseCommand, { kind: "find-messages" }>) {
    return this.reader.findMessages(command);
  }

  upsertRecord(
    command: Extract<DatabaseCommand, { kind: "upsert-record" }>
  ): MutationOutcome<UpsertResult> {
    try {
      return transaction(this.database, () => {
        const replay = this.replay<UpsertResult>(command);
        if (replay) return { status: "committed", receipt: replay };
        const record = chatRecordSchema.parse(command.record);
        if (command.expectedAggregateRevision !== undefined) {
          this.assertAggregateRevision(
            record.id,
            command.deviceId,
            command.expectedAggregateRevision
          );
        }
        const lifecycle = command.lifecycleKind ??
          (record.importOrigin ? "external-managed" : "native");
        this.writer.writeCore(record, lifecycle);
        this.writer.writeLocalFacts(record, command.deviceId);
        this.writer.writeMessages(record);
        this.writer.writeSubagents(record);
        this.writer.writeBranches(record);
        this.writer.writeImportOrigin(record);
        this.writer.writeSearchDocuments(record);
        const result = { chatId: record.id, aggregateRevision: record.chatRecordRevision,
          nativeMessageRevision: record.chatMessageRevision };
        return {
          status: "committed",
          receipt: this.commitReceipt(command, result, record.id),
        };
      });
    } catch (cause) {
      return { status: "rejected", failure: sqliteFailureOf(cause) };
    }
  }

  /* 事实变更的窄事务：CAS 与 upsert-record 同一份契约，写入面却只有
     chats + chat_local_*，标题变了才多写一行 title 搜索文档。 */
  updateChatFacts(
    command: Extract<DatabaseCommand, { kind: "update-chat-facts" }>
  ): MutationOutcome<UpsertResult> {
    try {
      return transaction(this.database, () => {
        const replay = this.replay<UpsertResult>(command);
        if (replay) return { status: "committed", receipt: replay };
        const facts = chatFactsSchema.parse(command.facts) as ChatFacts;
        this.assertAggregateRevision(facts.id, command.deviceId, command.expectedAggregateRevision);
        const stored = this.database.prepare(
          "SELECT lifecycle_kind, title FROM chats WHERE id = ?"
        ).get(facts.id) as Row | undefined;
        if (!stored) throw new Error("Chat does not exist");
        if (stored.lifecycle_kind === "external-readonly") {
          throw new Error("external-readonly Chat only accepts presentation mutations");
        }
        this.writer.writeCore(facts, stored.lifecycle_kind as "native" | "external-managed");
        this.writer.writeLocalFacts(facts, command.deviceId);
        if (stored.title !== facts.title) {
          this.writer.writeTitleSearchDocument(facts.id, facts.title);
        }
        const result = {
          chatId: facts.id,
          aggregateRevision: facts.chatRecordRevision,
          nativeMessageRevision: facts.chatMessageRevision,
        };
        return {
          status: "committed",
          receipt: this.commitReceipt(command, result, facts.id),
        };
      });
    } catch (cause) {
      return { status: "rejected", failure: sqliteFailureOf(cause) };
    }
  }

  appendMessage(
    command: Extract<DatabaseCommand, { kind: "append-message" }>
  ): MutationOutcome<UpsertResult> {
    try {
      return transaction(this.database, () => {
        const replay = this.replay<UpsertResult>(command);
        if (replay) return { status: "committed", receipt: replay };
        const message = messageSchema.parse(command.message);
        this.writer.appendMessage(command, message);
        const result = {
          chatId: command.chatId,
          aggregateRevision: command.nextAggregateRevision,
          nativeMessageRevision: command.nextMessageRevision,
        };
        return {
          status: "committed",
          receipt: this.commitReceipt(command, result, command.chatId),
        };
      });
    } catch (cause) {
      return { status: "rejected", failure: sqliteFailureOf(cause) };
    }
  }

  commitTurn(
    command: Extract<DatabaseCommand, { kind: "commit-turn" }>
  ): MutationOutcome<UpsertResult> {
    try {
      return transaction(this.database, () => {
        const replay = this.replay<UpsertResult>(command);
        if (replay) return { status: "committed", receipt: replay };
        const message = command.message ? messageSchema.parse(command.message) : null;
        this.writer.commitTurn(command, message);
        const result = {
          chatId: command.chatId,
          aggregateRevision: command.nextAggregateRevision,
          nativeMessageRevision: command.nextMessageRevision,
        };
        return {
          status: "committed",
          receipt: this.commitReceipt(command, result, command.chatId),
        };
      });
    } catch (cause) {
      return { status: "rejected", failure: sqliteFailureOf(cause) };
    }
  }

  updateReadonlyPresentation(
    command: Extract<DatabaseCommand, { kind: "update-readonly-presentation" }>
  ): MutationOutcome<UpsertResult> {
    try {
      return transaction(this.database, () => {
        const replay = this.replay<UpsertResult>(command);
        if (replay) return { status: "committed", receipt: replay };
        if (command.nextAggregateRevision !== command.expectedAggregateRevision + 1) {
          throw new Error("readonly presentation revision contract is invalid");
        }
        const result = this.writer.updateReadonlyPresentation(command);
        return {
          status: "committed",
          receipt: this.commitReceipt(command, result, command.chatId),
        };
      });
    } catch (cause) {
      return { status: "rejected", failure: sqliteFailureOf(cause) };
    }
  }

  removeRecord(
    command: Extract<DatabaseCommand, { kind: "remove-record" }>
  ): MutationOutcome<RemoveResult> {
    try {
      return transaction(this.database, () => {
        const replay = this.replay<RemoveResult>(command);
        if (replay) return { status: "committed", receipt: replay };
        const row = this.database.prepare(
          `SELECT c.lifecycle_kind, c.incarnation_id, a.aggregate_revision
             FROM chats c
             JOIN chat_local_aggregate_state a
               ON a.chat_id = c.id AND a.device_id = ?
            WHERE c.id = ?`
        ).get(command.deviceId, command.chatId) as Row | undefined;
        if (!row) throw new Error("Chat does not exist");
        if (
          command.expectedIncarnationId &&
          command.expectedIncarnationId !== row.incarnation_id
        ) {
          throw new Error("INCARNATION_MISMATCH");
        }
        /* 删除就是删除：外键级联带走这条 Chat 的全部行（只读导入的也一样），
           来源不再被任何墓碑记恨。下一次扫描于是能重新导入同一个来源。
           「不许永久删除只读会话」是产品栅栏，住在 ChatsService 与归档面，
           不在这里——否则删除 Project 与清空归档会半路夭折。 */
        const attachments = this.attachmentRows(command.chatId);
        this.database.prepare("DELETE FROM chats WHERE id = ?").run(command.chatId);
        /* Forks deliberately share ordinary attachment ids. Deletion therefore returns
           only globally unreferenced blobs; the filesystem owner must never infer GC
           eligibility from the deleted Chat alone. */
        const referenced = this.database.prepare(
          "SELECT 1 FROM chat_message_attachments WHERE attachment_id = ? LIMIT 1"
        );
        const reclaimable = attachments.filter(
          (attachment) => !referenced.get(attachment.id)
        );
        const result = { chatId: command.chatId, attachments: reclaimable };
        return {
          status: "committed",
          receipt: this.commitReceipt(command, result, command.chatId),
        };
      });
    } catch (cause) {
      return { status: "rejected", failure: sqliteFailureOf(cause) };
    }
  }

  getOperationReceipt(operationId: string) {
    const row = this.database.prepare(
      "SELECT * FROM chat_operations WHERE operation_id = ?"
    ).get(operationId) as Row | undefined;
    return row ? receiptFromRow(row) : null;
  }

  listAttachmentIds() {
    return (this.database.prepare(
      "SELECT DISTINCT attachment_id FROM chat_message_attachments ORDER BY attachment_id"
    ).all() as Row[]).map((row) => String(row.attachment_id));
  }

  hasAttachmentReference(chatId: string, attachmentId: string, deviceId: string) {
    return Boolean(this.database.prepare(
      `SELECT 1 FROM chat_message_attachments a
         JOIN chat_messages m ON m.row_id = a.message_row_id
         JOIN chat_local_memberships l
           ON l.chat_id = m.chat_id AND l.device_id = ?
        WHERE m.chat_id = ? AND a.attachment_id = ? LIMIT 1`
    ).get(deviceId, chatId, attachmentId));
  }

  getAttachmentReference(chatId: string, attachmentId: string, deviceId: string) {
    const row = this.database.prepare(
      `SELECT a.attachment_id, a.filename, a.media_type, a.byte_size
         FROM chat_message_attachments a
         JOIN chat_messages m ON m.row_id = a.message_row_id
         JOIN chat_local_memberships l
           ON l.chat_id = m.chat_id AND l.device_id = ?
        WHERE m.chat_id = ? AND a.attachment_id = ? LIMIT 1`
    ).get(deviceId, chatId, attachmentId) as Row | undefined;
    return row ? {
      id: String(row.attachment_id),
      filename: String(row.filename),
      mediaType: String(row.media_type),
      byteSize: Number(row.byte_size),
    } : null;
  }

  listMemorySummaries(deviceId: string) { return this.memory.listSummaries(deviceId); }

  getMemoryNativeSegment(
    command: Extract<DatabaseCommand, { kind: "get-memory-native-segment" }>
  ) {
    return this.memory.getSegment(command);
  }

  /* 键集分页：游标就是上一页最后一条命中的排序键。OFFSET 分页在扫描期间
     被任何一次 chats.updated_at 写入整体推移窗口——被 touch 的那条跑到最前，
     它身后所有还没读到的行同时后移一格，于是重发一条、漏发一条。键集只问
     "严格排在这个键之后的下一批"，被 touch 的 Chat 至多出现一次，未被动过
     的邻居一条都不会被跳过。 */
  searchDocuments(command: Extract<DatabaseCommand, { kind: "search-documents" }>) {
    if (!command.grams.length) return { hits: [], nextCursor: null };
    const match = command.grams.map((gram) => `"${gram}"`).join(" AND ");
    const cursor = command.cursor;
    const rows = this.database.prepare(
      `SELECT d.*, ${SEARCH_DOCUMENT_KIND_RANK} kind_rank,
              c.title, c.agent, c.updated_at, c.incarnation_id,
              la.aggregate_revision core_revision,
              la.timeline_revision native_message_revision,
              a.generation_id active_generation_id,
              m.payload_json message_json,
              m.message_id native_message_id, m.seq native_message_seq,
              m.role native_message_role,
              ie.delivery_seq imported_message_seq,
              iv.entry_version_id imported_message_id,
              iv.role imported_message_role
         FROM chat_search_fts f
         JOIN chat_search_documents d ON d.row_id = f.rowid
         JOIN chats c ON c.id = d.chat_id
         JOIN chat_local_memberships lm
           ON lm.chat_id = c.id AND lm.device_id = ?
         JOIN chat_local_aggregate_state la
           ON la.chat_id = c.id AND la.device_id = ?
         LEFT JOIN chat_active_import_generations a ON a.chat_id = c.id
         LEFT JOIN chat_messages m
           ON d.document_kind = 'native' AND CAST(m.row_id AS TEXT) = d.source_row_id
         LEFT JOIN chat_import_entry_versions iv
           ON d.document_kind = 'imported-version' AND iv.entry_version_id = d.source_row_id
         LEFT JOIN chat_import_generation_entries ie
           ON ie.chat_id = d.chat_id
          AND ie.generation_id = a.generation_id
          AND ie.entry_version_id = iv.entry_version_id
        WHERE chat_search_fts MATCH ?
          AND ${ACTIVE_GENERATION_DOCUMENT_FENCE}
          ${cursor ? `AND ${SEARCH_DOCUMENT_KEYSET_AFTER}` : ""}
        ORDER BY c.updated_at DESC, c.id, ${SEARCH_DOCUMENT_KIND_RANK}, d.row_id
        LIMIT ?`
    ).all(
      command.deviceId,
      command.deviceId,
      match,
      ...(cursor
        ? [
            cursor.updatedAt,
            cursor.updatedAt,
            cursor.chatId,
            cursor.chatId,
            cursor.kindRank,
            cursor.kindRank,
            cursor.rowId,
          ]
        : []),
      command.limit + 1
    ) as Row[];
    const page = rows.slice(0, command.limit);
    const hits: SearchDocumentHit[] = page.map((row) => ({
      chatId: String(row.chat_id),
      documentKind: row.document_kind as SearchDocumentHit["documentKind"],
      sourceRowId: String(row.source_row_id),
      searchText: String(row.search_text),
      message: row.message_json
        ? messageSchema.parse(parseJson(row.message_json, "search message"))
        : null,
      messageId: nullableString(row.native_message_id ?? row.imported_message_id),
      messageSeq: nullableNumber(row.native_message_seq ?? row.imported_message_seq),
      messageRole: (row.native_message_role ?? row.imported_message_role ?? null) as
        | "user"
        | "assistant"
        | null,
      timelineSegment: row.document_kind === "native"
        ? "native"
        : row.document_kind === "imported-version"
          ? "imported"
          : null,
      title: row.title === null ? null : String(row.title),
      agent: row.agent as ChatRecord["agent"],
      updatedAt: Number(row.updated_at),
      activeGenerationId: row.active_generation_id === null
        ? null
        : String(row.active_generation_id),
      incarnationId: row.incarnation_id === null
        ? null
        : String(row.incarnation_id),
      coreRevision: Number(row.core_revision),
      nativeMessageRevision: Number(row.native_message_revision),
    }));
    const last = page.at(-1);
    return {
      hits,
      nextCursor: rows.length > command.limit && last
        ? {
            updatedAt: Number(last.updated_at),
            chatId: String(last.chat_id),
            kindRank: Number(last.kind_rank),
            rowId: Number(last.row_id),
          }
        : null,
    };
  }

  beginContinuationSaga(
    command: Extract<DatabaseCommand, { kind: "begin-continuation-saga" }>
  ) {
    return this.simpleMutation(command, command.chatId, () =>
      this.continuations.begin(command)
    );
  }

  markContinuationHomePreparing(
    command: Extract<DatabaseCommand, { kind: "mark-continuation-home-preparing" }>
  ) {
    return this.simpleMutation(command, command.sagaId, () =>
      this.continuations.markHomePreparing(command)
    );
  }

  recordContinuationHomeCommitted(
    command: Extract<DatabaseCommand, { kind: "record-continuation-home-committed" }>
  ) {
    return this.simpleMutation(command, command.sagaId, () =>
      this.continuations.recordHomeCommitted(command)
    );
  }

  finalizeContinuationSaga(
    command: Extract<DatabaseCommand, { kind: "finalize-continuation-saga" }>
  ) {
    return this.simpleMutation(command, command.sagaId, () =>
      this.continuations.finalize(command)
    );
  }

  failContinuationPrecommit(
    command: Extract<DatabaseCommand, { kind: "fail-continuation-precommit" }>
  ) {
    return this.simpleMutation(command, command.sagaId, () =>
      this.continuations.failPrecommit(command)
    );
  }

  isolateContinuationOrphan(
    command: Extract<DatabaseCommand, { kind: "isolate-continuation-orphan" }>
  ) {
    return this.simpleMutation(command, command.sagaId, () =>
      this.continuations.isolateOrphan(command)
    );
  }

  listReconcilableContinuations() {
    return this.continuations.listReconcilable();
  }

  beginHistoryImport(command: Extract<DatabaseCommand, { kind: "begin-history-import" }>) {
    return this.simpleMutation(command, null, () => {
      const result = this.imports.begin(command);
      this.imports.syncSearchMergePolicy();
      return result;
    });
  }

  appendHistoryImportBatch(
    command: Extract<DatabaseCommand, { kind: "append-history-import-batch" }>
  ) {
    const startedAt = performance.now();
    const outcome = this.simpleMutation(command, command.runId, () => this.imports.append(command));
    return { ...outcome, transactionDurationMs: performance.now() - startedAt };
  }

  finalizeHistoryImport(
    command: Extract<DatabaseCommand, { kind: "finalize-history-import" }>
  ) {
    const outcome = this.simpleMutation(command, command.runId, () => {
      const result = this.imports.finalize(command);
      const finalized = { ...result, gc: this.imports.gcRetiredGenerations(result.chatId) };
      this.imports.syncSearchMergePolicy();
      return finalized;
    });
    if (outcome.status === "committed") {
      try { this.imports.unlinkBlobs(outcome.receipt.result.gc.deletedBlobDigests); }
      catch (cause) { console.warn("[chat-sqlite] deferred imported-blob cleanup", cause); }
    }
    return outcome;
  }

  cancelHistoryImport(
    command: Extract<DatabaseCommand, { kind: "cancel-history-import" }>
  ) {
    return this.simpleMutation(command, command.runId, () => {
      const result = this.imports.cancel(command);
      this.imports.syncSearchMergePolicy();
      return result;
    });
  }

  markImportSourceStatus(
    command: Extract<DatabaseCommand, { kind: "mark-import-source-status" }>
  ) {
    return this.simpleMutation(command, command.chatId, () =>
      this.imports.markSourceStatus(command)
    );
  }

  /* 启动第一件事：给上一次运行留下的半截导入收尸，并让 FTS 的合并策略
     回到 idle。它必须先于任何投影跑完，listMetadata 才不会撞上残行。 */
  reapInterruptedHistoryImports() {
    const result = transaction(this.database, () => this.imports.reapInterrupted());
    try { this.imports.unlinkBlobs(result.deletedBlobDigests); }
    catch (cause) { console.warn("[chat-sqlite] deferred imported-blob cleanup", cause); }
    return result;
  }

  mergeHistoryImportSearchIndex(pageBudget?: number) { this.imports.mergeSearchIndex(pageBudget); }
  getHistoryImportRun(runId: string) {
    return this.imports.getRun(runId);
  }

  /* ── 搜索投影是派生数据：漂移就重算，不只是判死刑 ─────────────────
     chat_search_documents 的每一行都能从 chats.title、原生消息或导入 entry
     的 payload 重新算出来。此前这里发现漂移只会抛错：维护闸门从此每 6 小时
     失败一次，却没有任何路径会把它修好——写入口的修复只在来源再次变化时
     才跑，来源不变的 begin 被收据回放直接短路。派生数据的正确姿势是可重建：
     逐行比对，对不上的用同一个写入口重写（UPSERT，触发器同步 FTS，与正常
     写入一字不差），闸门报告修了几行。先读完再写：游标开着时改同一张表，
     SQLite 不给任何保证。 */
  reconcileSearchProjection() {
    return transaction(this.database, () => {
      const documents = this.database.prepare(
        `SELECT d.*, c.title,
                m.message_id, m.seq, m.role, m.content, m.created_at, m.payload_json,
                v.payload_json imported_payload_json
           FROM chat_search_documents d
           JOIN chats c ON c.id = d.chat_id
           LEFT JOIN chat_messages m
             ON d.document_kind = 'native' AND CAST(m.row_id AS TEXT) = d.source_row_id
           LEFT JOIN chat_import_entry_versions v
             ON d.document_kind = 'imported-version' AND v.entry_version_id = d.source_row_id
          ORDER BY d.row_id`
      ).iterate() as Iterable<Row>;
      const drifted: Array<{
        chatId: string;
        kind: "title" | "native" | "imported-version";
        sourceRowId: string;
        text: string;
      }> = [];
      let count = 0;
      for (const document of documents) {
        count += 1;
        const kind = String(document.document_kind) as "title" | "native" | "imported-version";
        const text = kind === "title"
          ? normalizeSearchText(String(document.title ?? ""))
          : kind === "native"
            ? messageSearchText(messageFromRow(document))
            : this.searchTextForImportedPayload(document.imported_payload_json);
        const grams = gramTokens(text).join(" ");
        if (
          digest(text) === document.search_text_digest &&
          digest(grams) === document.grams_digest &&
          text === document.search_text &&
          grams === document.grams_text
        ) continue;
        drifted.push({
          chatId: String(document.chat_id),
          kind,
          sourceRowId: String(document.source_row_id),
          text,
        });
      }
      this.writer.writeSearchDocumentsBatch(drifted);
      return { documents: count, repaired: drifted.length };
    });
  }

  private searchTextForImportedPayload(value: unknown) {
    const payload = parseJson(value, "imported entry payload");
    if (!payload || typeof payload !== "object" || !("searchText" in payload)) {
      throw new Error("imported entry payload has no canonical search projection");
    }
    return normalizeSearchText(String((payload as { searchText: unknown }).searchText));
  }

  private attachmentRows(chatId: string) {
    return (this.database.prepare(
      `SELECT a.attachment_id, a.filename, a.media_type, a.byte_size
         FROM chat_message_attachments a
         JOIN chat_messages m ON m.row_id = a.message_row_id
        WHERE m.chat_id = ? ORDER BY m.seq, a.ordinal`
    ).all(chatId) as Row[]).map((row) => ({
      id: String(row.attachment_id),
      filename: String(row.filename),
      mediaType: String(row.media_type),
      byteSize: Number(row.byte_size),
    }));
  }

  private assertAggregateRevision(
    chatId: string,
    deviceId: string,
    expected: number | null
  ) {
    const aggregate = this.database.prepare(
      "SELECT aggregate_revision FROM chat_local_aggregate_state WHERE chat_id = ? AND device_id = ?"
    ).get(chatId, deviceId) as Row | undefined;
    const actual = aggregate ? Number(aggregate.aggregate_revision) : null;
    if (actual !== expected) throw new Error("REVISION_STALE");
  }

  private replay<T>(command: MutationCommand): MutationReceipt<T> | null {
    const receipt = this.getOperationReceipt(command.operationId);
    if (!receipt) return null;
    if (receipt.requestHash !== command.requestHash) {
      throw new Error("operationId was reused with a different request hash");
    }
    return receipt as MutationReceipt<T>;
  }

  private commitReceipt<T>(
    command: MutationCommand,
    result: T,
    targetId: string | null
  ): MutationReceipt<T> {
    const committedAt = this.now();
    this.database.prepare(
      `INSERT INTO chat_operations(
         operation_id, request_hash, kind, target_id, status, result_json, committed_at
       ) VALUES (?, ?, ?, ?, 'committed', ?, ?)`
    ).run(
      command.operationId,
      command.requestHash,
      command.kind,
      targetId,
      json(result),
      committedAt
    );
    return {
      operationId: command.operationId,
      requestHash: command.requestHash,
      kind: command.kind,
      targetId,
      result,
      committedAt,
    };
  }

  private simpleMutation<T>(
    command: MutationCommand,
    targetId: string | null,
    run: () => T
  ): MutationOutcome<T> {
    try {
      return transaction(this.database, () => {
        const replay = this.replay<T>(command);
        if (replay) return { status: "committed", receipt: replay };
        const result = run();
        return {
          status: "committed",
          receipt: this.commitReceipt(command, result, targetId),
        };
      });
    } catch (cause) {
      return { status: "rejected", failure: sqliteFailureOf(cause) };
    }
  }
}

export { queryGramTokens };

export function exactSearchFilter(
  hits: SearchDocumentHit[],
  tokens: readonly string[]
) {
  return hits.filter((hit) => matchSearchTokens(hit.searchText, tokens));
}
