/**
 * [INPUT]: Depends on crypto, closed history-import commands, SQLite rows, deterministic codecs, the content-addressed ImportBlobStore, the retired-generation reclamation sweep, and ChatRecordWriter search projection
 * [OUTPUT]: Provides identity-bearing readonly Chat creation refused for adopted sources whose title search document is rewritten on every re-import (so a changed source title can never leave the projection drifted), resumable immutable generations, chunk/blob content, bounded FTS merge policy, revision-converging activation, cancellation, the sole no-op-on-equal source_status writer ("changed" has no producer and is unreachable), startup reaping of interrupted runs, saga-fenced bounded GC of superseded and abandoned generations, and run inspection
 * [POS]: External-history write model beneath ChatRepository; it never reads source files, stores nothing but whole source messages, and commits exactly one bounded batch at a time
 */

import { randomUUID } from "node:crypto";
import { normalizeSearchText } from "../../../../../shared/search-text";
import type {
  DatabaseCommand,
  HistoryImportEntryInput,
  HistoryImportSource,
} from "../database-protocol";
import type { SqliteDatabase, SqliteValue } from "../connection";
import { changes, digest, json, prepared, type Row } from "./codec";
import { reclaimRetiredGenerations } from "./import-gc";
import { ImportBlobStore } from "./import-blobs";
import { ChatRecordWriter } from "./writer";

export const IMPORT_CHUNK_BYTES = 32 * 1024;
export const IMPORT_BLOB_THRESHOLD_BYTES = 8 * 1024 * 1024;
export const IMPORT_BATCH_ENTRY_LIMIT = 2_048;
export const IMPORT_BATCH_BYTE_LIMIT = 4 * 1024 * 1024;
export const EMPTY_IMPORT_DIGEST = digest("bottega-history-import-v1");

const IMPORT_FTS_MERGE = {
  automerge: 0,
  crisismerge: 100_000,
  usermerge: 4,
  pgsz: 32_768,
} as const;
const IDLE_FTS_MERGE = {
  automerge: 8,
  crisismerge: 100_000,
  usermerge: 4,
  pgsz: 32_768,
} as const;

const booleanText = (value: boolean | "unknown") =>
  value === "unknown" ? value : String(value);

export const importTransactionBytes = (entry: HistoryImportEntryInput) => {
  const bytes = Buffer.byteLength(entry.content, "utf8");
  return bytes > IMPORT_BLOB_THRESHOLD_BYTES ? IMPORT_CHUNK_BYTES : bytes;
};

export function splitUtf8Chunks(value: string, limit = IMPORT_CHUNK_BYTES) {
  if (!Number.isSafeInteger(limit) || limit < 4) throw new Error("Invalid UTF-8 chunk limit");
  const bytes = Buffer.from(value, "utf8");
  const chunks: string[] = [];
  for (let start = 0; start < bytes.length;) {
    let end = Math.min(start + limit, bytes.length);
    while (end < bytes.length && (bytes[end]! & 0xc0) === 0x80) end -= 1;
    if (end === start) throw new Error("Could not find a UTF-8 code point boundary");
    chunks.push(bytes.subarray(start, end).toString("utf8"));
    start = end;
  }
  return chunks.length ? chunks : [""];
}

export function importedEntryDigest(entry: HistoryImportEntryInput) {
  if (entry.projection?.codecVersion === 1) return entry.projection.contentDigest;
  return digest(json({
    version: 1,
    sourceEntryId: entry.sourceEntryId,
    sourceMessageId: entry.sourceMessageId ?? null,
    role: entry.role,
    content: entry.content,
    createdAt: entry.createdAt ?? null,
    payload: entry.payload ?? null,
  }));
}

export function advanceImportDigest(
  previous: string,
  entries: readonly HistoryImportEntryInput[]
) {
  let value = previous;
  for (const entry of entries) {
    value = digest(`${value}\0${entry.deliverySeq}\0${importedEntryDigest(entry)}`);
  }
  return value;
}

export class HistoryImportRepository {
  private readonly writer: ChatRecordWriter;
  private readonly blobs: ImportBlobStore;

  constructor(
    private readonly database: SqliteDatabase,
    private readonly now: () => number,
    importBlobsRoot?: string
  ) {
    this.writer = new ChatRecordWriter(database, now);
    this.blobs = new ImportBlobStore(database, now, importBlobsRoot);
  }

  syncSearchMergePolicy() {
    const row = prepared(this.database,
      "SELECT COUNT(*) count FROM history_import_runs WHERE state = 'running'"
    ).get() as Row;
    const configured = new Map(
      (prepared(this.database,
        "SELECT k, v FROM chat_search_fts_config WHERE k IN ('automerge', 'crisismerge', 'usermerge', 'pgsz')"
      ).all() as Row[]).map((entry) => [String(entry.k), Number(entry.v)])
    );
    const importing = Number(row.count) > 0;
    if (!importing && configured.size === 0) return;
    const policy = importing ? IMPORT_FTS_MERGE : IDLE_FTS_MERGE;
    for (const [option, value] of Object.entries(policy)) {
      if (configured.get(option) === value) continue;
      this.database.exec(
        `INSERT INTO chat_search_fts(chat_search_fts, rank) VALUES('${option}', ${value})`
      );
    }
  }

  /* 崩溃、强杀、取消都可能留下半截导入：run 停在 running（于是 FTS 的
     automerge 被永远按在 0），代停在 building（于是永远激活不了），而那条
     只读 Chat 一代都没有——读侧一投影它就抛错，整个 ChatStore 起不来。
     启动时一次收尸：删掉的只读 Chat 会在下一次扫描里原样重生。 */
  reapInterrupted() {
    const runs = this.database.prepare(
      `UPDATE history_import_runs
          SET state = 'failed', last_error = 'reaped at startup', updated_at = ?
        WHERE state = 'running'`
    ).run(this.now());
    const generations = this.database.prepare(
      "UPDATE chat_import_generations SET state = 'abandoned' WHERE state = 'building'"
    ).run();
    const chats = this.database.prepare(
      `DELETE FROM chats
        WHERE lifecycle_kind = 'external-readonly'
          AND id NOT IN (SELECT chat_id FROM chat_active_import_generations)`
    ).run();
    /* 夭折的代际留在库里就是死重：它的 Chat 还活着（有一代活跃代），
       所以谁也不会顺手把它带走。收尸的同一趟就把它回收掉。 */
    const retired = this.database.prepare(
      `SELECT DISTINCT chat_id FROM chat_import_generations WHERE state = 'abandoned'`
    ).all() as Array<{ chat_id: string }>;
    let deletedGenerations = 0;
    let deletedEntryVersions = 0;
    const deletedBlobDigests: string[] = [];
    for (const row of retired) {
      const gc = this.gcRetiredGenerations(String(row.chat_id), 100);
      deletedGenerations += gc.deletedGenerations;
      deletedEntryVersions += gc.deletedEntryVersions;
      deletedBlobDigests.push(...gc.deletedBlobDigests);
    }
    this.syncSearchMergePolicy();
    return {
      failedRuns: changes(runs),
      abandonedGenerations: changes(generations),
      deletedChats: changes(chats),
      deletedGenerations,
      deletedEntryVersions,
      deletedBlobDigests,
    };
  }

  mergeSearchIndex(pageBudget = 1_024) {
    if (!Number.isSafeInteger(pageBudget) || pageBudget === 0 || Math.abs(pageBudget) > 16_384) {
      throw new Error("Invalid FTS merge page budget");
    }
    this.database.exec(
      `INSERT INTO chat_search_fts(chat_search_fts, rank) VALUES('merge', ${pageBudget})`
    );
  }

  begin(command: Extract<DatabaseCommand, { kind: "begin-history-import" }>) {
    this.assertReadonlySource(command.source);
    const current = this.database.prepare(
      `SELECT r.* FROM history_import_runs r
        JOIN chat_import_origins o ON o.chat_id = r.chat_id
       WHERE r.state = 'running' AND o.source_kind = ?
         AND o.storage_fingerprint = ? AND o.canonical_native_id = ?`
    ).get(
      command.source.sourceKind,
      command.source.storageFingerprint,
      command.source.canonicalNativeId
    ) as Row | undefined;
    if (current) {
      if (
        current.source_revision !== command.source.historyRevision ||
        current.source_incarnation !== command.source.sourceIncarnation ||
        Number(current.source_size) !== command.source.sourceSize ||
        current.source_mtime_ns !== command.source.sourceMtimeNs
      ) {
        throw new Error("A different history revision is already importing for this source");
      }
      return {
        runId: String(current.run_id),
        chatId: String(current.chat_id),
        generationId: String(current.generation_id),
        cursor: this.cursorOf(current),
        rollingDigest: String(current.rolling_digest),
        committedEntryCount: Number(current.committed_entry_count),
        committedBytes: Number(current.committed_bytes),
      };
    }
    const chatId = this.findOrCreateReadonlyChat(command.source, command.deviceId);
    const runId = `import_${randomUUID().replaceAll("-", "")}`;
    const generationId = `generation_${randomUUID().replaceAll("-", "")}`;
    const createdAt = this.now();
    this.database.prepare(
      `INSERT INTO chat_import_generations(
         generation_id, chat_id, history_revision, source_incarnation,
         source_size, source_mtime_ns, incomplete_tail, state,
         entry_count, byte_size, digest_codec_version, content_digest, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, 'building', 0, 0, 1, ?, ?)`
    ).run(
      generationId,
      chatId,
      command.source.historyRevision,
      command.source.sourceIncarnation,
      command.source.sourceSize,
      command.source.sourceMtimeNs,
      booleanText(command.source.incompleteTail),
      digest(`${EMPTY_IMPORT_DIGEST}\0${runId}`),
      createdAt
    );
    this.database.prepare(
      `INSERT INTO history_import_runs(
         run_id, chat_id, generation_id, source_kind, project_id, state,
         source_revision, source_incarnation, source_size, source_mtime_ns,
         incomplete_tail, cursor_json, rolling_digest, committed_entry_count,
         committed_bytes, last_delivery_seq, stats_json, last_error,
         started_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, 'running', ?, ?, ?, ?, ?, 'null', ?, 0, 0, 0, '{}', NULL, ?, ?)`
    ).run(
      runId,
      chatId,
      generationId,
      command.source.sourceKind,
      command.source.projectId,
      command.source.historyRevision,
      command.source.sourceIncarnation,
      command.source.sourceSize,
      command.source.sourceMtimeNs,
      booleanText(command.source.incompleteTail),
      EMPTY_IMPORT_DIGEST,
      createdAt,
      createdAt
    );
    return {
      runId,
      chatId,
      generationId,
      cursor: null,
      rollingDigest: EMPTY_IMPORT_DIGEST,
      committedEntryCount: 0,
      committedBytes: 0,
    };
  }

  append(command: Extract<DatabaseCommand, { kind: "append-history-import-batch" }>) {
    if (!command.entries.length || command.entries.length > IMPORT_BATCH_ENTRY_LIMIT) {
      throw new Error("History import batch entry budget exceeded");
    }
    const byteSize = command.entries.reduce(
      (sum, entry) => sum + Buffer.byteLength(entry.content, "utf8"),
      0
    );
    const transactionBytes = command.entries.reduce(
      (sum, entry) => sum + importTransactionBytes(entry),
      0
    );
    if (transactionBytes > IMPORT_BATCH_BYTE_LIMIT) {
      throw new Error("History import batch byte budget exceeded");
    }
    const run = this.requireRunning(command.runId);
    if (
      run.source_revision !== command.sourceRevision ||
      this.cursorOf(run) !== command.expectedCursor ||
      run.rolling_digest !== command.expectedRollingDigest
    ) {
      throw new Error("History import source, cursor, or rolling digest is stale");
    }
    let deliverySeq = Number(run.last_delivery_seq);
    const searchDocuments: Array<{
      chatId: string;
      kind: "imported-version";
      sourceRowId: string;
      text: string;
      projection?: NonNullable<HistoryImportEntryInput["projection"]>;
    }> = [];
    const chunkRows: Array<{
      entryVersionId: string;
      ordinal: number;
      content: string;
      byteSize: number;
      contentDigest: string;
    }> = [];
    const memberships: Array<{ deliverySeq: number; entryVersionId: string }> = [];
    let rollingDigest = command.expectedRollingDigest;
    for (const entry of command.entries) {
      if (!entry.sourceEntryId || entry.deliverySeq <= deliverySeq) {
        throw new Error("History import delivery sequence is not strictly increasing");
      }
      deliverySeq = entry.deliverySeq;
      const written = this.writeEntryVersion(String(run.chat_id), entry, chunkRows);
      const entryVersionId = written.entryVersionId;
      rollingDigest = digest(`${rollingDigest}\0${entry.deliverySeq}\0${written.contentDigest}`);
      if (written.searchText !== null) {
        searchDocuments.push({
          chatId: String(run.chat_id),
          kind: "imported-version",
          sourceRowId: entryVersionId,
          text: written.searchText,
          projection: written.projection,
        });
      }
      memberships.push({ deliverySeq, entryVersionId });
    }
    this.writeChunksBatch(chunkRows);
    this.writeMembershipsBatch(
      String(run.chat_id),
      String(run.generation_id),
      memberships
    );
    this.writer.writeSearchDocumentsBatch(searchDocuments);
    const entryCount = Number(run.committed_entry_count) + command.entries.length;
    const committedBytes = Number(run.committed_bytes) + byteSize;
    const updated = this.database.prepare(
      `UPDATE history_import_runs
          SET cursor_json = ?, rolling_digest = ?, committed_entry_count = ?,
              committed_bytes = ?, last_delivery_seq = ?, updated_at = ?
        WHERE run_id = ? AND state = 'running' AND rolling_digest = ?`
    ).run(
      json(command.nextCursor),
      rollingDigest,
      entryCount,
      committedBytes,
      deliverySeq,
      this.now(),
      command.runId,
      command.expectedRollingDigest
    );
    if (changes(updated) !== 1) throw new Error("History import run changed concurrently");
    this.database.prepare(
      `UPDATE chat_import_generations
          SET entry_count = ?, byte_size = ?
        WHERE generation_id = ? AND state = 'building'`
    ).run(entryCount, committedBytes, run.generation_id as SqliteValue);
    return {
      runId: command.runId,
      cursor: command.nextCursor,
      rollingDigest,
      committedEntryCount: entryCount,
      committedBytes,
    };
  }

  finalize(command: Extract<DatabaseCommand, { kind: "finalize-history-import" }>) {
    const run = this.requireRunning(command.runId);
    if (
      Number(run.committed_entry_count) !== command.expectedEntryCount ||
      Number(run.committed_bytes) !== command.expectedByteSize ||
      run.rolling_digest !== command.expectedRollingDigest
    ) {
      throw new Error("History import final digest or count is stale");
    }
    const previous = this.database.prepare(
      "SELECT generation_id FROM chat_active_import_generations WHERE chat_id = ?"
    ).get(run.chat_id as SqliteValue) as Row | undefined;
    this.database.prepare(
      "DELETE FROM chat_active_import_generations WHERE chat_id = ?"
    ).run(run.chat_id as SqliteValue);
    if (previous) {
      this.database.prepare(
        "UPDATE chat_import_generations SET state = 'superseded' WHERE chat_id = ? AND generation_id = ?"
      ).run(run.chat_id as SqliteValue, previous.generation_id as SqliteValue);
    }
    const ready = this.database.prepare(
      `UPDATE chat_import_generations SET state = 'ready', content_digest = ?
        WHERE generation_id = ? AND state = 'building'`
    ).run(command.expectedRollingDigest, run.generation_id as SqliteValue);
    if (changes(ready) !== 1) throw new Error("History import generation is not building");
    /* 扫描期只抽读了文件的头几 KB，那一格「未完成尾部」是猜的；解析器把整
       条源读完之后才知道答案。谁读得多谁说了算，代际与运行记录一起改口。 */
    if (command.incompleteTail !== undefined) {
      const verdict = booleanText(command.incompleteTail);
      this.database.prepare(
        "UPDATE chat_import_generations SET incomplete_tail = ? WHERE generation_id = ?"
      ).run(verdict, run.generation_id as SqliteValue);
      this.database.prepare(
        "UPDATE history_import_runs SET incomplete_tail = ? WHERE run_id = ?"
      ).run(verdict, command.runId);
    }
    this.database.prepare(
      "INSERT INTO chat_active_import_generations(chat_id, generation_id, activated_at) VALUES (?, ?, ?)"
    ).run(run.chat_id as SqliteValue, run.generation_id as SqliteValue, this.now());
    this.database.prepare(
      `UPDATE history_import_runs SET state = 'completed', updated_at = ? WHERE run_id = ?`
    ).run(this.now(), command.runId);
    this.database.prepare(
      `UPDATE chat_import_origins
          SET history_revision = ?, source_size = ?, source_mtime_ns = ?,
              source_status = 'match', last_imported_at = ?
        WHERE chat_id = ?`
    ).run(
      run.source_revision as SqliteValue,
      run.source_size as SqliteValue,
      run.source_mtime_ns as SqliteValue,
      this.now(),
      run.chat_id as SqliteValue
    );
    /* 两个版本号必须合流成同一个数：原生 append 的 CAS 拿
       「timeline_revision == native_message_revision」当锁，激活一代只推高
       其中一个，就会让一条已收养的会话再也写不进下一条消息。 */
    const revision = this.nextTimelineRevision(String(run.chat_id));
    this.database.prepare(
      `UPDATE chat_local_aggregate_state
          SET aggregate_revision = aggregate_revision + 1,
              timeline_revision = ?
        WHERE chat_id = ?`
    ).run(revision, run.chat_id as SqliteValue);
    this.database.prepare(
      `UPDATE chat_local_memberships
          SET membership_revision = membership_revision + 1, updated_at = ?
        WHERE chat_id = ?`
    ).run(this.now(), run.chat_id as SqliteValue);
    this.database.prepare(
      `UPDATE chats
          SET updated_at = ?, core_revision = core_revision + 1,
              native_message_revision = ?
        WHERE id = ?`
    ).run(this.now(), revision, run.chat_id as SqliteValue);
    return {
      runId: command.runId,
      chatId: String(run.chat_id),
      generationId: String(run.generation_id),
      supersededGenerationId: previous ? String(previous.generation_id) : null,
    };
  }

  gcRetiredGenerations(chatId: string, limitInput = 8) {
    return reclaimRetiredGenerations(this.database, chatId, limitInput);
  }

  unlinkBlobs(contentDigests: readonly string[]) {
    this.blobs.unlink(contentDigests);
  }

  cancel(command: Extract<DatabaseCommand, { kind: "cancel-history-import" }>) {
    const run = this.requireRunning(command.runId);
    this.database.prepare(
      "UPDATE history_import_runs SET state = 'cancelled', last_error = ?, updated_at = ? WHERE run_id = ?"
    ).run(command.reason, this.now(), command.runId);
    this.database.prepare(
      "UPDATE chat_import_generations SET state = 'abandoned' WHERE generation_id = ? AND state = 'building'"
    ).run(run.generation_id as SqliteValue);
    return { runId: command.runId, cancelled: true as const };
  }

  /* sourceStatus 的唯一写入口。同值即无操作：扫描每一轮都会经过这里，
     让不变的事实也去推高 revision，只会把侧栏刷成一台永动机。
     "changed" 没有生产者，也不会有：内容一变就是新的一代 import 代际，
     旧代际连同那句判定一起退休——那一档在这套模型里不可达。 */
  markSourceStatus(
    command: Extract<DatabaseCommand, { kind: "mark-import-source-status" }>
  ) {
    const origin = this.database.prepare(
      "SELECT source_status FROM chat_import_origins WHERE chat_id = ?"
    ).get(command.chatId) as Row | undefined;
    if (!origin) throw new Error("HISTORY_IMPORT_ORIGIN_MISSING");
    if (String(origin.source_status) === command.sourceStatus) {
      return { chatId: command.chatId, sourceStatus: command.sourceStatus, changed: false };
    }
    this.database.prepare(
      "UPDATE chat_import_origins SET source_status = ? WHERE chat_id = ?"
    ).run(command.sourceStatus, command.chatId);
    this.database.prepare(
      `UPDATE chat_local_aggregate_state
          SET aggregate_revision = aggregate_revision + 1
        WHERE chat_id = ?`
    ).run(command.chatId);
    this.database.prepare(
      "UPDATE chats SET updated_at = ?, core_revision = core_revision + 1 WHERE id = ?"
    ).run(this.now(), command.chatId);
    return { chatId: command.chatId, sourceStatus: command.sourceStatus, changed: true };
  }

  getRun(runId: string) {
    const row = this.database.prepare(
      "SELECT * FROM history_import_runs WHERE run_id = ?"
    ).get(runId) as Row | undefined;
    return row ? {
      runId: String(row.run_id),
      chatId: String(row.chat_id),
      generationId: String(row.generation_id),
      state: row.state as "running" | "completed" | "cancelled" | "failed",
      sourceRevision: String(row.source_revision),
      cursor: this.cursorOf(row),
      rollingDigest: String(row.rolling_digest),
      committedEntryCount: Number(row.committed_entry_count),
      committedBytes: Number(row.committed_bytes),
      lastDeliverySeq: Number(row.last_delivery_seq),
    } : null;
  }

  /* 收养之后源文件还在长：那条会话已经是原生的了，再给它挂一代只读历史
     会让 chats 与 chat_local_aggregate_state 的版本号错开一格，此后每一次
     append 的 CAS 都失败。这里直接拒绝，不建代、不改任何一行。 */
  private assertReadonlySource(source: HistoryImportSource) {
    const row = prepared(this.database,
      `SELECT c.lifecycle_kind FROM chat_import_origins o
         JOIN chats c ON c.id = o.chat_id
        WHERE o.source_kind = ? AND o.storage_fingerprint = ? AND o.canonical_native_id = ?`
    ).get(
      source.sourceKind,
      source.storageFingerprint,
      source.canonicalNativeId
    ) as Row | undefined;
    if (row && row.lifecycle_kind !== "external-readonly") {
      throw new Error("HISTORY_SOURCE_MANAGED");
    }
  }

  private nextTimelineRevision(chatId: string) {
    const row = prepared(this.database,
      `SELECT c.native_message_revision native,
              COALESCE((SELECT MAX(timeline_revision) FROM chat_local_aggregate_state
                         WHERE chat_id = c.id), 0) timeline
         FROM chats c WHERE c.id = ?`
    ).get(chatId) as Row;
    return Math.max(Number(row.native), Number(row.timeline)) + 1;
  }

  private findOrCreateReadonlyChat(source: HistoryImportSource, deviceId: string) {
    const existing = this.database.prepare(
      `SELECT chat_id FROM chat_import_origins
        WHERE source_kind = ? AND storage_fingerprint = ? AND canonical_native_id = ?`
    ).get(source.sourceKind, source.storageFingerprint, source.canonicalNativeId) as Row | undefined;
    if (existing) {
      const chatId = String(existing.chat_id);
      this.database.prepare(
        `UPDATE chats
            SET title = CASE WHEN title_source = 'user' THEN title ELSE ? END,
                updated_at = MAX(updated_at, ?), archived_at = ?
          WHERE id = ? AND lifecycle_kind = 'external-readonly'`
      ).run(source.title, source.updatedAt, source.archivedAt ?? null, chatId);
      /* 标题改了，标题的搜索文档也得跟着改——否则 chats.title 与那一行文档
         各说各话，维护闸门的 `reconcileSearchProjection` 会判它漂移。
         回读而不是直接用 source.title：`title_source='user'` 时上面那条
         UPDATE 保留的是用户自己起的名字。
         注意这一分支只在来源真的变化时才跑：来源不变的 begin 被收据回放
         短路，存量漂移由维护闸门按 chats.title 重算修复，不靠这里。
         同分支里其它被改写的事实（成员归属、origins 的别名/状态）都不进
         搜索投影，标题是这里唯一的缺口。 */
      this.writer.writeTitleSearchDocument(
        chatId,
        (this.database.prepare("SELECT title FROM chats WHERE id = ?")
          .get(chatId) as Row | undefined)?.title as string | null ?? null
      );
      this.database.prepare(
        `UPDATE chat_local_memberships
            SET local_project_id = ?, updated_at = MAX(updated_at, ?)
          WHERE chat_id = ? AND device_id = ?`
      ).run(
        source.projectId,
        source.updatedAt,
        chatId,
        deviceId
      );
      this.database.prepare(
        `UPDATE chat_import_origins
            SET aliases_json = ?, resume_alias = ?, original_cwd = ?,
                source_status = ?, can_resume = ?
          WHERE chat_id = ?`
      ).run(
        json(source.aliases),
        source.resumeAlias,
        source.originalCwd,
        source.sourceStatus,
        source.canResume ? 1 : 0,
        chatId
      );
      return chatId;
    }
    /* 只读 Chat 一诞生就拿到真身份：续聊沿用它，不换代——读侧因此不需要
       第二种「时间线身份」，AppGrant/深链的 incarnation 也不会在收养那一刻
       突然变脸。来源唯一性由 chat_import_origins 的三元组唯一索引把守。 */
    const chatId = `chat_${randomUUID().replaceAll("-", "")}`;
    const incarnationId = randomUUID().replaceAll("-", "");
    this.database.prepare(
      `INSERT INTO chats(
         id, lifecycle_kind, agent, title, title_source, created_at, updated_at,
         archived_at, incarnation_id, next_seq, trimmed_through_seq,
         branches_trimmed_through_seq, core_revision, native_message_revision
       ) VALUES (?, 'external-readonly', ?, ?, 'local-fallback', ?, ?, ?, ?, NULL, 0, 0, 1, 0)`
    ).run(
      chatId,
      source.sourceKind,
      source.title,
      source.createdAt,
      source.updatedAt,
      source.archivedAt ?? null,
      incarnationId
    );
    this.database.prepare(
      `INSERT INTO chat_local_aggregate_state(
         chat_id, device_id, aggregate_revision, timeline_revision
       ) VALUES (?, ?, 1, 0)`
    ).run(chatId, deviceId);
    this.database.prepare(
      `INSERT INTO chat_local_memberships(
         chat_id, device_id, local_project_id, visibility_state,
         archived_at, membership_revision, created_at, updated_at
       ) VALUES (?, ?, ?, 'visible', NULL, 1, ?, ?)`
    ).run(
      chatId,
      deviceId,
      source.projectId,
      source.createdAt,
      source.updatedAt
    );
    this.database.prepare(
      `INSERT INTO chat_import_origins(
         chat_id, source_kind, storage_fingerprint,
         canonical_native_id, aliases_json, resume_alias, original_cwd,
         source_status, can_resume, adoption_snapshot_id, snapshot_digest,
         history_revision, source_size, source_mtime_ns, last_imported_at, managed_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, NULL)`
    ).run(
      chatId,
      source.sourceKind,
      source.storageFingerprint,
      source.canonicalNativeId,
      json(source.aliases),
      source.resumeAlias,
      source.originalCwd,
      source.sourceStatus,
      source.canResume ? 1 : 0,
      source.historyRevision,
      source.sourceSize,
      source.sourceMtimeNs,
      this.now()
    );
    this.writer.writeSearchDocument(
      chatId,
      "title",
      chatId,
      normalizeSearchText(source.title)
    );
    return chatId;
  }

  private writeEntryVersion(
    chatId: string,
    entry: HistoryImportEntryInput,
    chunkRows: Array<{
      entryVersionId: string;
      ordinal: number;
      content: string;
      byteSize: number;
      contentDigest: string;
    }>
  ) {
    const contentDigest = importedEntryDigest(entry);
    const existing = prepared(this.database,
      `SELECT entry_version_id FROM chat_import_entry_versions
        WHERE chat_id = ? AND source_entry_id = ? AND content_digest = ?`
    ).get(chatId, entry.sourceEntryId, contentDigest) as Row | undefined;
    if (existing) {
      return {
        entryVersionId: String(existing.entry_version_id),
        searchText: null,
        contentDigest,
        projection: undefined,
      };
    }
    const entryVersionId = `entry_${randomUUID()}`;
    const payload = {
      ...(entry.payload && typeof entry.payload === "object" ? entry.payload : {}),
      sourceEntryId: entry.sourceEntryId,
      sourceMessageId: entry.sourceMessageId ?? null,
      searchText: entry.projection?.normalizedSearchText ?? normalizeSearchText(entry.searchText),
      preview: Array.from(entry.content.replace(/\s+/g, " ").trim()).slice(0, 500).join(""),
    };
    const byteSize = Buffer.byteLength(entry.content, "utf8");
    prepared(this.database,
      `INSERT INTO chat_import_entry_versions(
         entry_version_id, chat_id, source_entry_id, source_message_id, role,
         created_at, payload_json, digest_codec_version, content_digest,
         byte_size
       ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`
    ).run(
      entryVersionId,
      chatId,
      entry.sourceEntryId,
      entry.sourceMessageId ?? null,
      entry.role,
      entry.createdAt ?? null,
      json(payload),
      contentDigest,
      byteSize
    );
    if (byteSize > IMPORT_BLOB_THRESHOLD_BYTES) {
      this.blobs.write(entryVersionId, entry.content);
    } else {
      for (const [ordinal, content] of splitUtf8Chunks(entry.content).entries()) {
        chunkRows.push({
          entryVersionId,
          ordinal,
          content,
          byteSize: Buffer.byteLength(content, "utf8"),
          contentDigest: digest(content),
        });
      }
    }
    return {
      entryVersionId,
      searchText: String(payload.searchText),
      contentDigest,
      projection: entry.projection,
    };
  }

  private writeChunksBatch(rows: readonly Readonly<{
    entryVersionId: string;
    ordinal: number;
    content: string;
    byteSize: number;
    contentDigest: string;
  }>[]) {
    if (!rows.length) return;
    const values: SqliteValue[] = [];
    const placeholders = rows.map((row) => {
      values.push(row.entryVersionId, row.ordinal, row.content, row.byteSize, row.contentDigest);
      return "(?, 'content', ?, ?, ?, ?)";
    });
    prepared(this.database,
      `INSERT INTO chat_import_entry_version_chunks(
         entry_version_id, field_kind, ordinal, content, byte_size, content_digest
       ) VALUES ${placeholders.join(",")}`
    ).run(...values);
  }

  private writeMembershipsBatch(
    chatId: string,
    generationId: string,
    rows: readonly Readonly<{ deliverySeq: number; entryVersionId: string }>[]
  ) {
    const values: SqliteValue[] = [];
    const placeholders = rows.map((row) => {
      values.push(chatId, generationId, row.deliverySeq, row.entryVersionId);
      return "(?, ?, ?, ?)";
    });
    prepared(this.database,
      `INSERT INTO chat_import_generation_entries(
         chat_id, generation_id, delivery_seq, entry_version_id
       ) VALUES ${placeholders.join(",")}`
    ).run(...values);
  }

  private requireRunning(runId: string) {
    const row = prepared(this.database,
      "SELECT * FROM history_import_runs WHERE run_id = ? AND state = 'running'"
    ).get(runId) as Row | undefined;
    if (!row) throw new Error("History import run is not active");
    return row;
  }

  private cursorOf(row: Row) {
    return row.cursor_json === "null" ? null : JSON.parse(String(row.cursor_json)) as string;
  }
}
