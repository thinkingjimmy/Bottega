/**
 * [INPUT]: Depends on the canonical Chat schema, SQLite connection, and deterministic repository codecs
 * [OUTPUT]: Provides connection-scoped row projection writers for narrow append/turn/fact commits, Chat core, readonly presentation, local facts, messages, subagents, attachments, branches, origins, and delta-only search documents written in variable-limit-safe chunks
 * [POS]: Write projection layer beneath transactional ChatRepository mutation orchestration
 */

import type { ChatRecord } from "../../../../../shared/chats-ipc";
import type { ChatFacts } from "../../chat-summary";
import { normalizeSearchText } from "../../../../../shared/search-text";
import {
  assertSubagentBudget,
  messageSchema,
  subagentsSchema,
} from "../../chat-schema";
import type { SqliteDatabase, SqliteValue } from "../connection";
import type { DatabaseCommand, HistoryImportEntryInput } from "../database-protocol";
import {
  SEARCH_CODEC_VERSION,
  changes,
  digest,
  gramTokens,
  json,
  messageSearchText,
  persistedMessagePayload,
  prepared,
  type Row,
} from "./codec";

/* 每行绑定 9 个变量，900 行 = 8100 个占位符，稳稳低于 SQLite 的 32766 上限。 */
const SEARCH_DOCUMENT_BATCH_ROWS = 900;

/* 文档身份 + 文本的语义指纹：写入前的比对与落盘的那一列必须同源。 */
const semanticDigest = (kind: string, sourceRowId: string, text: string) =>
  digest(`${SEARCH_CODEC_VERSION}\0${kind}\0${sourceRowId}\0${text}`);

export class ChatRecordWriter {
  constructor(
    private readonly database: SqliteDatabase,
    private readonly now: () => number
  ) {}

  appendMessage(
    command: Extract<DatabaseCommand, { kind: "append-message" }>,
    message: ReturnType<typeof messageSchema.parse>
  ) {
    this.assertAppendContract(command, message.seq);
    this.advanceAppendState(command);
    this.trimPrefix(command.chatId, command.retainedFromSeq);
    const rowId = this.insertMessage(command.chatId, message);
    if (message.role !== "notice") {
      this.writeSearchDocument(
        command.chatId,
        "native",
        String(rowId),
        messageSearchText(message)
      );
    }
  }

  commitTurn(
    command: Extract<DatabaseCommand, { kind: "commit-turn" }>,
    message: ReturnType<typeof messageSchema.parse> | null
  ) {
    this.assertTurnContract(command, message?.seq);
    this.advanceAppendState(command);
    this.trimPrefix(command.chatId, command.retainedFromSeq);
    if (message) {
      const rowId = this.insertMessage(command.chatId, message);
      if (message.role !== "notice") {
        this.writeSearchDocument(
          command.chatId,
          "native",
          String(rowId),
          messageSearchText(message)
        );
      }
    }
    this.writeSubagentSnapshot(command.chatId, command.subagents);
  }

  private assertAppendContract(
    command: Extract<DatabaseCommand, { kind: "append-message" }>,
    messageSeq: number
  ) {
    if (
      command.nextAggregateRevision !== command.expectedAggregateRevision + 1 ||
      command.nextMessageRevision !== command.expectedMessageRevision + 1 ||
      command.retainedFromSeq < 1 ||
      command.retainedFromSeq > messageSeq ||
      command.nextSeq <= messageSeq
    ) {
      throw new Error("append-message revision or sequence contract is invalid");
    }
  }

  private assertTurnContract(
    command: Extract<DatabaseCommand, { kind: "commit-turn" }>,
    messageSeq?: number
  ) {
    const messageDelta = messageSeq === undefined ? 0 : 1;
    if (
      command.nextAggregateRevision !== command.expectedAggregateRevision + 1 ||
      command.nextMessageRevision !== command.expectedMessageRevision + messageDelta ||
      command.retainedFromSeq < 1 ||
      (messageSeq !== undefined && command.retainedFromSeq > messageSeq) ||
      (messageSeq !== undefined && command.nextSeq <= messageSeq)
    ) {
      throw new Error("commit-turn revision or sequence contract is invalid");
    }
  }

  private advanceAppendState(
    command: Extract<DatabaseCommand, { kind: "append-message" | "commit-turn" }>
  ) {
    const core = this.database.prepare(
      `UPDATE chats
          SET updated_at = ?, next_seq = ?, trimmed_through_seq = ?,
              native_message_revision = ?
        WHERE id = ? AND native_message_revision = ?`
    ).run(
      command.updatedAt,
      command.nextSeq,
      command.trimmedThroughSeq,
      command.nextMessageRevision,
      command.chatId,
      command.expectedMessageRevision
    );
    const local = this.database.prepare(
      `UPDATE chat_local_aggregate_state
          SET aggregate_revision = ?, timeline_revision = ?
        WHERE chat_id = ? AND device_id = ?
          AND aggregate_revision = ? AND timeline_revision = ?`
    ).run(
      command.nextAggregateRevision,
      command.nextMessageRevision,
      command.chatId,
      command.deviceId,
      command.expectedAggregateRevision,
      command.expectedMessageRevision
    );
    if (changes(core) !== 1 || changes(local) !== 1) {
      throw new Error("REVISION_STALE");
    }
  }

  private trimPrefix(chatId: string, retainedFromSeq: number) {
    const rows = this.database.prepare(
      "SELECT row_id FROM chat_messages WHERE chat_id = ? AND seq < ?"
    ).all(chatId, retainedFromSeq) as Row[];
    for (const row of rows) {
      this.database.prepare(
        "DELETE FROM chat_search_documents WHERE chat_id = ? AND document_kind = 'native' AND source_row_id = ?"
      ).run(chatId, String(row.row_id));
    }
    if (rows.length) {
      this.database.prepare(
        "DELETE FROM chat_messages WHERE chat_id = ? AND seq < ?"
      ).run(chatId, retainedFromSeq);
    }
  }

  private insertMessage(
    chatId: string,
    message: ReturnType<typeof messageSchema.parse>
  ) {
    /* INSERT 自己就说了新行是谁；再 SELECT 一次只是把同一件事问两遍。 */
    const rowId = this.database.prepare(
      `INSERT INTO chat_messages(
         chat_id, message_id, seq, role, content, created_at, payload_json
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      chatId,
      message.id,
      message.seq,
      message.role,
      message.content,
      message.createdAt,
      persistedMessagePayload(message)
    ).lastInsertRowid;
    if (message.role === "user") {
      for (const [ordinal, attachment] of (message.attachments ?? []).entries()) {
        this.database.prepare(
          `INSERT INTO chat_message_attachments(
             message_row_id, attachment_id, ordinal, filename, media_type, byte_size
           ) VALUES (?, ?, ?, ?, ?, ?)`
        ).run(
          rowId,
          attachment.id,
          ordinal,
          attachment.filename,
          attachment.mediaType,
          attachment.byteSize
        );
      }
    }
    return rowId;
  }

  writeCore(record: ChatFacts, lifecycle: "native" | "external-managed") {
    this.database.prepare(
      `INSERT INTO chats(
         id, lifecycle_kind, agent, title, title_source, created_at, updated_at,
         archived_at, incarnation_id, next_seq, trimmed_through_seq,
         branches_trimmed_through_seq, core_revision, native_message_revision
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         lifecycle_kind = excluded.lifecycle_kind,
         agent = excluded.agent,
         title = excluded.title,
         title_source = excluded.title_source,
         updated_at = excluded.updated_at,
         archived_at = excluded.archived_at,
         incarnation_id = excluded.incarnation_id,
         next_seq = excluded.next_seq,
         trimmed_through_seq = excluded.trimmed_through_seq,
         core_revision = excluded.core_revision,
         native_message_revision = excluded.native_message_revision`
    ).run(
      record.id,
      lifecycle,
      record.agent,
      record.title,
      record.titleSource,
      record.createdAt,
      record.updatedAt,
      record.archivedAt ?? null,
      record.incarnationId,
      record.nextSeq,
      record.trimmedThroughSeq ?? 0,
      0,
      record.chatRecordRevision,
      record.chatMessageRevision
    );
  }

  updateReadonlyPresentation(
    command: Extract<DatabaseCommand, { kind: "update-readonly-presentation" }>
  ) {
    const authority = this.database.prepare(
      `SELECT c.lifecycle_kind, u.read_only_reason
         FROM chats c
         LEFT JOIN chat_local_authorities u
           ON u.chat_id = c.id AND u.device_id = ?
        WHERE c.id = ?`
    ).get(command.deviceId, command.chatId) as Row | undefined;
    if (
      authority?.lifecycle_kind !== "external-readonly" &&
      !authority?.read_only_reason
    ) {
      throw new Error("readonly presentation requires a readonly local authority");
    }
    const aggregate = this.database.prepare(
      `UPDATE chat_local_aggregate_state SET aggregate_revision = ?
        WHERE chat_id = ? AND device_id = ? AND aggregate_revision = ?`
    ).run(
      command.nextAggregateRevision,
      command.chatId,
      command.deviceId,
      command.expectedAggregateRevision
    );
    if (Number(aggregate.changes) !== 1) throw new Error("REVISION_STALE");
    if (command.presentation.kind === "title") {
      const core = this.database.prepare(
        `UPDATE chats SET title = ?, title_source = ?, updated_at = ?,
             core_revision = core_revision + 1 WHERE id = ?`
      ).run(
        command.presentation.title,
        command.presentation.titleSource,
        command.updatedAt,
        command.chatId
      );
      if (Number(core.changes) !== 1) throw new Error("REVISION_STALE");
      this.database.prepare(
        `INSERT INTO chat_title_jobs(chat_id, device_id, state, job_json, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(chat_id, device_id) DO UPDATE SET
           state = excluded.state, job_json = excluded.job_json,
           updated_at = excluded.updated_at`
      ).run(
        command.chatId,
        command.deviceId,
        command.presentation.titleJob.state,
        json(command.presentation.titleJob),
        command.updatedAt
      );
      this.writeSearchDocument(
        command.chatId,
        "title",
        command.chatId,
        normalizeSearchText(command.presentation.title ?? "")
      );
    } else {
      const membership = this.database.prepare(
        `UPDATE chat_local_memberships
            SET visibility_state = ?, archived_at = ?,
                membership_revision = membership_revision + 1, updated_at = ?
          WHERE chat_id = ? AND device_id = ?`
      ).run(
        command.presentation.archivedAt === null ? "visible" : "archived",
        command.presentation.archivedAt,
        command.updatedAt,
        command.chatId,
        command.deviceId
      );
      if (Number(membership.changes) !== 1) throw new Error("REVISION_STALE");
    }
    const core = this.database.prepare(
      "SELECT native_message_revision FROM chats WHERE id = ?"
    ).get(command.chatId) as Row | undefined;
    if (!core) throw new Error("REVISION_STALE");
    return {
      chatId: command.chatId,
      aggregateRevision: command.nextAggregateRevision,
      nativeMessageRevision: Number(core.native_message_revision),
    };
  }

  writeLocalFacts(record: ChatFacts, deviceId: string) {
    this.database.prepare(
      `INSERT INTO chat_local_aggregate_state(
         chat_id, device_id, aggregate_revision, timeline_revision
       ) VALUES (?, ?, ?, ?)
       ON CONFLICT(chat_id, device_id) DO UPDATE SET
         aggregate_revision = excluded.aggregate_revision,
         timeline_revision = excluded.timeline_revision`
    ).run(record.id, deviceId, record.chatRecordRevision, record.chatMessageRevision);
    this.database.prepare(
      `INSERT INTO chat_local_memberships(
         chat_id, device_id, local_project_id, visibility_state,
         archived_at, membership_revision, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(chat_id, device_id) DO UPDATE SET
         local_project_id = excluded.local_project_id,
         visibility_state = excluded.visibility_state,
         archived_at = excluded.archived_at,
         membership_revision = excluded.membership_revision,
         updated_at = excluded.updated_at`
    ).run(
      record.id,
      deviceId,
      record.projectId,
      record.archivedAt ? "archived" : "visible",
      record.archivedAt ?? null,
      record.chatRecordRevision,
      record.createdAt,
      record.updatedAt
    );
    this.database.prepare(
      `INSERT INTO chat_device_bindings(
         chat_id, device_id, state, home_dir, session_backend, session_id,
         session_tool_plan_json, start_state_json, binding_revision,
         created_at, updated_at
       ) VALUES (?, ?, 'ready', ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(chat_id, device_id) DO UPDATE SET
         state = 'ready', home_dir = excluded.home_dir,
         session_backend = excluded.session_backend, session_id = excluded.session_id,
         session_tool_plan_json = excluded.session_tool_plan_json,
         start_state_json = excluded.start_state_json,
         binding_revision = excluded.binding_revision,
         updated_at = excluded.updated_at`
    ).run(
      record.id,
      deviceId,
      record.homeDir ?? null,
      record.session?.backend ?? null,
      record.session?.id ?? null,
      record.session?.toolPlan ? json(record.session.toolPlan) : null,
      json(record.startState),
      record.chatRecordRevision,
      record.createdAt,
      record.updatedAt
    );
    this.database.prepare(
      `INSERT INTO chat_local_authorities(
         chat_id, device_id, app_role, context_json, grants_json,
         grant_revision, read_only_reason, authority_revision
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(chat_id, device_id) DO UPDATE SET
         app_role = excluded.app_role, context_json = excluded.context_json,
         grants_json = excluded.grants_json, grant_revision = excluded.grant_revision,
         read_only_reason = excluded.read_only_reason,
         authority_revision = excluded.authority_revision`
    ).run(
      record.id,
      deviceId,
      record.appRole,
      json(record.context),
      json(record.grants),
      record.grantRevision,
      record.readOnlyReason ?? null,
      record.chatRecordRevision
    );
    this.database.prepare(
      `INSERT INTO chat_title_jobs(chat_id, device_id, state, job_json, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(chat_id, device_id) DO UPDATE SET
         state = excluded.state, job_json = excluded.job_json, updated_at = excluded.updated_at`
    ).run(record.id, deviceId, record.titleJob.state, json(record.titleJob), record.updatedAt);
  }

  writeMessages(record: ChatRecord) {
    const retained = new Set(record.messages.map((message) => message.id));
    const existing = this.database.prepare(
      "SELECT row_id, message_id, payload_json FROM chat_messages WHERE chat_id = ?"
    ).all(record.id) as Row[];
    const existingByMessageId = new Map(
      existing.map((row) => [String(row.message_id), row])
    );
    for (const row of existing) {
      if (!retained.has(String(row.message_id))) {
        this.database.prepare("DELETE FROM chat_messages WHERE row_id = ?").run(row.row_id as SqliteValue);
      }
    }
    for (const message of record.messages) {
      const payload = persistedMessagePayload(message);
      const row = existingByMessageId.get(message.id);
      if (row?.payload_json === payload) continue;
      this.database.prepare(
        `INSERT INTO chat_messages(
           chat_id, message_id, seq, role, content, created_at, payload_json
         ) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(chat_id, message_id) DO UPDATE SET
           seq = excluded.seq, role = excluded.role, content = excluded.content,
           created_at = excluded.created_at, payload_json = excluded.payload_json`
      ).run(record.id, message.id, message.seq, message.role, message.content, message.createdAt, payload);
      const saved = this.database.prepare(
        "SELECT row_id FROM chat_messages WHERE chat_id = ? AND message_id = ?"
      ).get(record.id, message.id) as Row;
      this.database.prepare("DELETE FROM chat_message_attachments WHERE message_row_id = ?").run(saved.row_id as SqliteValue);
      if (message.role === "user") {
        for (const [ordinal, attachment] of (message.attachments ?? []).entries()) {
          this.database.prepare(
            `INSERT INTO chat_message_attachments(
               message_row_id, attachment_id, ordinal, filename, media_type, byte_size
             ) VALUES (?, ?, ?, ?, ?, ?)`
          ).run(saved.row_id as SqliteValue, attachment.id, ordinal, attachment.filename, attachment.mediaType, attachment.byteSize);
        }
      }
    }
  }

  writeSubagents(record: ChatRecord) {
    this.writeSubagentSnapshot(record.id, record.subagents ?? {});
  }

  writeSubagentSnapshot(chatId: string, input: Record<string, unknown>) {
    const subagents = subagentsSchema.parse(input);
    assertSubagentBudget(subagents);
    const retained = new Set(Object.keys(subagents));
    for (const row of this.database.prepare("SELECT agent_thread_id FROM chat_subagents WHERE chat_id = ?").all(chatId) as Row[]) {
      if (!retained.has(String(row.agent_thread_id))) {
        this.database.prepare("DELETE FROM chat_subagents WHERE chat_id = ? AND agent_thread_id = ?").run(chatId, row.agent_thread_id as SqliteValue);
      }
    }
    for (const [agentThreadId, subagent] of Object.entries(subagents)) {
      this.database.prepare(
        `INSERT INTO chat_subagents(chat_id, agent_thread_id, meta_json, parts_json)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(chat_id, agent_thread_id) DO UPDATE SET
           meta_json = excluded.meta_json, parts_json = excluded.parts_json`
      ).run(chatId, agentThreadId, json(subagent.meta), json(subagent.parts));
    }
  }

  /* 分支水位是分支的事实，跟着分支一起落盘：writeCore 只写事实相，
     窄事实变更于是永远不会顺手抹掉一次修订留下的裁剪水位。 */
  writeBranches(record: ChatRecord) {
    this.database.prepare(
      "UPDATE chats SET branches_trimmed_through_seq = ? WHERE id = ?"
    ).run(record.supersededBranchesTrimmedThroughSeq ?? 0, record.id);
    this.database.prepare("DELETE FROM chat_superseded_branches WHERE chat_id = ?").run(record.id);
    for (const [ordinal, branch] of (record.supersededBranches ?? []).entries()) {
      this.database.prepare(
        `INSERT INTO chat_superseded_branches(
           chat_id, intent_id, superseded_at, supersedes_user_message_id,
           through_seq_end, ordinal
         ) VALUES (?, ?, ?, ?, ?, ?)`
      ).run(record.id, branch.intentId, branch.supersededAt, branch.supersedesUserMessageId, branch.throughSeqEnd, ordinal);
      for (const [messageOrdinal, message] of branch.messages.entries()) {
        this.database.prepare(
          "INSERT INTO chat_branch_messages(chat_id, branch_intent_id, ordinal, message_json) VALUES (?, ?, ?, ?)"
        ).run(record.id, branch.intentId, messageOrdinal, json(message));
      }
    }
  }

  writeImportOrigin(record: ChatRecord) {
    if (!record.importOrigin) {
      this.database.prepare("DELETE FROM chat_import_origins WHERE chat_id = ?").run(record.id);
      return;
    }
    const origin = record.importOrigin;
    this.database.prepare(
      `INSERT INTO chat_import_origins(
         chat_id, source_kind, storage_fingerprint,
         canonical_native_id, aliases_json, resume_alias, original_cwd,
         source_status, can_resume, adoption_snapshot_id, snapshot_digest,
         history_revision, source_size, source_mtime_ns, last_imported_at, managed_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, 'match', 1, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(chat_id) DO UPDATE SET
         aliases_json = excluded.aliases_json,
         resume_alias = excluded.resume_alias,
         history_revision = excluded.history_revision,
         source_size = excluded.source_size,
         source_mtime_ns = excluded.source_mtime_ns,
         last_imported_at = excluded.last_imported_at`
    ).run(
      record.id,
      origin.sourceKind,
      origin.storageFingerprint,
      origin.canonicalNativeId,
      json(origin.aliases),
      origin.resumeAlias,
      origin.originalCwd,
      origin.adoptionSnapshotId ?? null,
      record.snapshotDigest ?? null,
      origin.historyRevision,
      origin.sourceSize,
      origin.sourceMtimeNs,
      record.updatedAt,
      record.createdAt
    );
  }

  /* 语义摘要说了算：一次改名不该把这条 Chat 的每条消息都重投影一遍，
     每一次 upsert 都要连带触发 FTS 的 delete+insert。摘要没变就不写。 */
  writeSearchDocuments(record: ChatRecord) {
    const stored = new Map(
      (this.database.prepare(
        `SELECT document_kind, source_row_id, source_semantic_digest
           FROM chat_search_documents
          WHERE chat_id = ? AND document_kind IN ('title', 'native')`
      ).all(record.id) as Row[]).map((row) =>
        [`${row.document_kind}:${row.source_row_id}`, String(row.source_semantic_digest)] as const
      )
    );
    const rowIds = new Map(
      (this.database.prepare(
        "SELECT row_id, message_id FROM chat_messages WHERE chat_id = ?"
      ).all(record.id) as Row[]).map((row) =>
        [String(row.message_id), String(row.row_id)] as const
      )
    );
    const retained = new Set<string>();
    const write = (
      kind: "title" | "native",
      sourceRowId: string,
      text: string
    ) => {
      retained.add(`${kind}:${sourceRowId}`);
      if (stored.get(`${kind}:${sourceRowId}`) === semanticDigest(kind, sourceRowId, text)) {
        return;
      }
      this.writeSearchDocument(record.id, kind, sourceRowId, text);
    };
    write("title", record.id, normalizeSearchText(record.title ?? ""));
    for (const message of record.messages) {
      if (message.role === "notice") continue;
      const rowId = rowIds.get(message.id);
      if (!rowId) throw new Error("search projection has no message row");
      write("native", rowId, messageSearchText(message));
    }
    for (const key of stored.keys()) {
      if (retained.has(key)) continue;
      const separator = key.indexOf(":");
      this.database.prepare(
        "DELETE FROM chat_search_documents WHERE chat_id = ? AND document_kind = ? AND source_row_id = ?"
      ).run(record.id, key.slice(0, separator), key.slice(separator + 1));
    }
  }

  /** 标题事实的窄写入：只有标题真的变了才碰这一行文档。 */
  writeTitleSearchDocument(chatId: string, title: string | null) {
    this.writeSearchDocument(chatId, "title", chatId, normalizeSearchText(title ?? ""));
  }

  writeSearchDocument(
    chatId: string,
    kind: "title" | "native" | "imported-version",
    sourceRowId: string,
    text: string
  ) {
    this.writeSearchDocumentsBatch([{ chatId, kind, sourceRowId, text }]);
  }

  writeSearchDocumentsBatch(documents: readonly Readonly<{
    chatId: string;
    kind: "title" | "native" | "imported-version";
    sourceRowId: string;
    text: string;
    projection?: NonNullable<HistoryImportEntryInput["projection"]>;
  }>[]) {
    /* 9 个占位符一行；SQLite 的 32766 变量上限决定了批次必须切片，
       否则一次导入的大批文档会在绑定阶段直接炸掉。 */
    for (let offset = 0; offset < documents.length; offset += SEARCH_DOCUMENT_BATCH_ROWS) {
      this.writeSearchDocumentChunk(
        documents.slice(offset, offset + SEARCH_DOCUMENT_BATCH_ROWS)
      );
    }
  }

  private writeSearchDocumentChunk(documents: readonly Readonly<{
    chatId: string;
    kind: "title" | "native" | "imported-version";
    sourceRowId: string;
    text: string;
    projection?: NonNullable<HistoryImportEntryInput["projection"]>;
  }>[]) {
    if (!documents.length) return;
    const values: SqliteValue[] = [];
    const rows = documents.map(({ chatId, kind, sourceRowId, text, projection }) => {
      const grams = projection?.gramsText ?? gramTokens(text).join(" ");
      const textDigest = projection?.searchTextDigest ?? digest(text);
      const gramsDigest = projection?.gramsDigest ?? digest(grams);
      values.push(
        chatId,
        kind,
        sourceRowId,
        SEARCH_CODEC_VERSION,
        semanticDigest(kind, sourceRowId, text),
        text,
        textDigest,
        grams,
        gramsDigest
      );
      return "(?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)";
    });
    prepared(this.database,
      `INSERT INTO chat_search_documents(
         chat_id, document_kind, source_row_id, projection_codec_version,
         source_semantic_digest, search_text, search_blob_ref,
         search_text_digest, grams_text, grams_digest
       ) VALUES ${rows.join(",")}
       ON CONFLICT(chat_id, document_kind, source_row_id) DO UPDATE SET
         projection_codec_version = excluded.projection_codec_version,
         source_semantic_digest = excluded.source_semantic_digest,
         search_text = excluded.search_text,
         search_blob_ref = NULL,
         search_text_digest = excluded.search_text_digest,
         grams_text = excluded.grams_text,
         grams_digest = excluded.grams_digest`
    ).run(...values);
  }
}
