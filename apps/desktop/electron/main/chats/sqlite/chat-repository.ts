/**
 * [INPUT]: Depends on focused repository reader/writer collaborators, canonical Chat schemas, SQLite transactions, optional import-blob storage, and the closed database protocol
 * [OUTPUT]: Provides receipt-atomic Chat writes, frozen owner checks, scoped outbox publication and original App transcript custody before native removal.
 * [POS]: Chat domain SQL transaction authority inside the dedicated worker; row projection details live in repository collaborators
 */
import { guardRecordUsers } from "./cloud/execution/commit";
import { ChatCloudRepository } from "./cloud/repository";
import { collectRetainedAttachmentIds } from "./cloud/retention";
import type { CloudMutation, CloudRead } from "./cloud/protocol";
import { commitAgentSwitch } from "./agent-switch/commit";
import { reserveSwitchSequences } from "./agent-switch/reserve";
import type { SwitchSequenceReservation } from "./agent-switch/command";
import type { AgentSwitchReceipt } from "../../../../shared/chat-agent/contracts";
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
import { searchDocuments } from "./search/documents";
import { indexConfirmedMirror } from "./search/mirrors";
import { readMirrorDownload } from "./cloud/mirror/downloads";
import { readRetainedSource } from "./cloud/inventory/source";
import { chatBodySchema } from "@ai-chat/cloud-protocol/chats/transcript/body";
import { ChatRepositoryReader } from "./repository/reader";
import { ChatRecordWriter } from "./repository/writer";
import { HistoryImportRepository } from "./repository/imports";
import { ContinuationSagaRepository } from "./repository/continuation";
import { ChatMemoryReader } from "./repository/readers/memory";
import { ChatFactReader } from "./repository/readers/facts";
import { readLibraryNative, listLibraryMirrors } from "../../library/mirrors/native-source";

type MutationCommand = Extract<
  DatabaseCommand,
  { operationId: string; requestHash: string }
>;

export class ChatRepository {
  private readonly cloud: ChatCloudRepository;
  private readonly reader: ChatRepositoryReader;
  private readonly writer: ChatRecordWriter;
  private readonly imports: HistoryImportRepository;
  private readonly continuations: ContinuationSagaRepository;
  private readonly memory: ChatMemoryReader;
  private readonly facts: ChatFactReader;

  constructor(
    private readonly database: SqliteDatabase,
    private readonly now: () => number = Date.now,
    storage?: Readonly<{ storageMode?: import("../../../../shared/local-storage/contracts").StorageMode; importBlobsRoot?: string; backendDefaults?: import("../../../../shared/settings-ipc").DefaultChatOptionsByBackend }>
  ) {
    this.reader = new ChatRepositoryReader(database);
    this.writer = new ChatRecordWriter(database, now);
    this.imports = new HistoryImportRepository(database, now, storage?.importBlobsRoot, storage?.backendDefaults);
    this.continuations = new ContinuationSagaRepository(database, now);
    this.memory = new ChatMemoryReader(database);
    this.facts = new ChatFactReader(database);
    this.cloud = new ChatCloudRepository(database, this.reader, this.writer, now, storage?.storageMode);
  }
  cloudRead(command: CloudRead) { return this.cloud.read(command); }
  configureStorageMode(mode: import("../../../../shared/local-storage/contracts").RuntimeStorageMode) { return this.cloud.configureMode(mode); }

  cloudMutate(command: CloudMutation) {
    return this.simpleMutation(command, null, () => this.cloud.mutate(command));
  }
  listMetadata(deviceId: string, chatId?: string) {
    return this.reader.listMetadata(deviceId, chatId);
  }
  getRecord(chatId: string, deviceId: string) {
    return this.reader.getRecord(chatId, deviceId);
  }
  readLibraryNative(command: Extract<DatabaseCommand, { kind: "read-library-native" }>) {
    return readLibraryNative(this.database, command, this.cloud.searchScope);
  }
  get libraryScope() { return this.cloud.searchScope; }
  listLibraryMirrors(afterId: string | null, known?: Readonly<Record<string, string>>) { return listLibraryMirrors(this.database, this.cloud.searchScope, afterId, known); }

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

  reserveSwitchSequences(command: Extract<DatabaseCommand, { kind: "reserve-switch-sequences" | "reserve-turn-sequences" }>): MutationOutcome<SwitchSequenceReservation> {
    try {
      return transaction(this.database, () => {
        const replay = this.replay<SwitchSequenceReservation>(command);
        if (replay) return { status: "committed", receipt: replay };
        const result = reserveSwitchSequences(this.database, this.reader, this.writer, command);
        return { status: "committed", receipt: this.commitReceipt(command, result, command.chatId) };
      });
    } catch (cause) {
      return { status: "rejected", failure: sqliteFailureOf(cause) };
    }
  }

  switchAgent(command: Extract<DatabaseCommand, { kind: "switch-agent" }>): MutationOutcome<AgentSwitchReceipt> {
    try {
      return transaction(this.database, () => {
        const replay = this.replay<AgentSwitchReceipt>(command);
        if (replay) return { status: "committed", receipt: replay };
        const result = commitAgentSwitch(this.database, this.reader, this.writer, command);
        return { status: "committed", receipt: this.commitReceipt(command, result, command.chatId) };
      });
    } catch (cause) {
      return { status: "rejected", failure: sqliteFailureOf(cause) };
    }
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
        guardRecordUsers(this.database, this.reader, command.deviceId, record, command.ownerCommit);
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
        this.cloud.archiveBeforeRemoval(command.chatId, command.deviceId, command.operationId, command.retainedAppId);
        const attachments = this.attachmentRows(command.chatId);
        this.database.prepare("DELETE FROM chats WHERE id = ?").run(command.chatId);
        /* Forks deliberately share ordinary attachment ids. Deletion therefore returns
           only globally unreferenced blobs; the filesystem owner must never infer GC
           eligibility from the deleted Chat alone. */
        const referenced = this.database.prepare(
          "SELECT 1 FROM chat_message_attachments WHERE attachment_id = ? LIMIT 1"
        );
        const reclaimable = attachments.filter(
          (attachment) => !referenced.get(attachment.id) && !collectRetainedAttachmentIds(this.database).has(attachment.id)
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
    return [...new Set([...(this.database.prepare(
      "SELECT DISTINCT attachment_id FROM chat_message_attachments ORDER BY attachment_id"
    ).all() as Row[]).map((row) => String(row.attachment_id)), ...collectRetainedAttachmentIds(this.database)])];
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

  searchDocuments(command: Extract<DatabaseCommand, { kind: "search-documents" }>) {
    return searchDocuments(this.database, command, this.cloud.searchScope);
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
      let added = 0;
      const mirrors = this.database.prepare("SELECT id,cloud_environment,cloud_user_id FROM chats WHERE cloud_state='mirror'").all() as Row[];
      for (const mirror of mirrors) {
        const scope = { environment: String(mirror.cloud_environment), userId: String(mirror.cloud_user_id) };
        if (readMirrorDownload(this.database, scope, String(mirror.id))?.complete) added += indexConfirmedMirror(this.database, this.writer, scope, String(mirror.id));
      }
      const documents = this.database.prepare(
        `SELECT d.*, c.title,
                m.message_id, m.seq, m.role, m.content, m.created_at, m.payload_json,
                v.payload_json imported_payload_json, s.source_id mirror_source_id, s.digest mirror_digest
           FROM chat_search_documents d
           JOIN chats c ON c.id = d.chat_id
           LEFT JOIN chat_messages m
             ON d.document_kind = 'native' AND CAST(m.row_id AS TEXT) = d.source_row_id
           LEFT JOIN chat_import_entry_versions v
             ON d.document_kind = 'imported-version' AND v.entry_version_id = d.source_row_id
           LEFT JOIN chat_retained_sources s
             ON d.document_kind='native' AND d.source_row_id='mirror:' || s.source_id
            AND s.chat_id=c.id AND s.environment=c.cloud_environment AND s.user_id=c.cloud_user_id AND s.kind='mirror-body'
          ORDER BY d.row_id`
      ).iterate() as Iterable<Row>;
      const drifted: Array<{
        chatId: string;
        kind: "title" | "native" | "imported-version";
        sourceRowId: string;
        text: string;
      }> = [];
      const stale: number[] = [];
      let count = 0;
      for (const document of documents) {
        count += 1;
        const kind = String(document.document_kind) as "title" | "native" | "imported-version";
        const cached = kind === "native" && String(document.source_row_id).startsWith("mirror:");
        if (cached && !document.mirror_source_id) { stale.push(Number(document.row_id)); continue; }
        const text = kind === "title"
          ? normalizeSearchText(String(document.title ?? ""))
          : kind === "native"
            ? messageSearchText(cached ? chatBodySchema.parse(readRetainedSource(this.database, { sourceId: String(document.mirror_source_id), digest: String(document.mirror_digest) })).message : messageFromRow(document))
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
      for (const rowId of stale) this.database.prepare("DELETE FROM chat_search_documents WHERE row_id=?").run(rowId);
      this.writer.writeSearchDocumentsBatch(drifted);
      return { documents: count, repaired: drifted.length + stale.length + added };
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
    if (command.kind !== "cloud-mutate" && command.kind !== "remove-record") this.cloud.recordBusinessCommit(command, targetId);
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
