/**
 * [INPUT]: Depends on shared UTF-8 byte-budget truncation, canonical Chat and readonly-record schemas, preview projection, SQLite connection, aggregate admission, the shared imported-entry SQL, closed commands, and repository codecs
 * [OUTPUT]: Provides all-Chat or single-Chat metadata that never projects a readonly Chat without an active generation, budgeted aggregates including empty readonly records, and byte-bounded native/imported timeline projections (one canonical turn per imported assistant entry: folded process statements unfold into text/tool parts, a plan payload becomes kind "plan") while delegating transcript navigation queries
 * [POS]: Read-only query layer beneath the ChatRepository facade
 */

import { truncateUtf8 } from "../../../../../shared/truncate-utf8";
import type {
  ChatMessage,
  ChatOutlineCursor,
  ChatRecord,
  ChatTimelineAroundInput,
  ChatTimelineCursor,
  ChatTimelinePage,
  PersistedSubagent,
  SupersededChatBranch,
} from "../../../../../shared/chats-ipc";
import { MESSAGE_BYTE_LIMIT } from "../../../../../shared/chats-ipc";
import type {
  ForeignProcessStep,
  ForeignToolEvent,
} from "../../../../../shared/history-import-ipc";
import { projectForeignParts } from "../import/foreign-projection";
import {
  assertSubagentBudget,
  chatRecordSchema,
  messageSchema,
  readonlyChatRecordSchema,
  subagentsSchema,
} from "../../chat-schema";
import { metadataOf, type ChatMetadata } from "../../chat-summary";
import type { DatabaseCommand } from "../database-protocol";
import type { SqliteDatabase } from "../connection";
import {
  messageFromRow,
  parseJson,
  type Row,
} from "./codec";
import {
  IMPORTED_ENTRY_SELECT,
  IMPORTED_MESSAGE_BYTE_LIMIT,
} from "./imported-sql";
import { ChatOutlineReader } from "./outline";
import { assertFullAggregateBudget } from "./readers/aggregate-budget";

const TIMELINE_PAGE_BYTE_LIMIT = 512 * 1024;

const messageBytes = (message: ChatMessage) =>
  Buffer.byteLength(JSON.stringify(message), "utf8");

/* 'unknown' 与 'false' 都不是「确实丢了尾巴」；只有确凿的 true 才提示。 */
const incompleteTailOf = (row: Row) =>
  row.active_generation_incomplete_tail === "true";

function readonlyStartState(row: Row): ChatRecord["startState"] {
  if (row.first_imported_seq === null || row.first_imported_seq === undefined) {
    return { kind: "unstarted" };
  }
  return {
    kind: "started-exact",
    firstUserMessageAt: Number(row.first_imported_created_at ?? row.created_at),
    firstUserMessageSeq: Number(row.first_imported_seq),
  };
}

function boundedNewest(
  rows: Row[],
  limit: number,
  project: (row: Row) => ChatMessage
) {
  const messages: ChatMessage[] = [];
  let bytes = 0;
  for (const row of rows.slice(0, limit)) {
    const message = project(row);
    const next = messageBytes(message);
    if (messages.length && bytes + next > TIMELINE_PAGE_BYTE_LIMIT) break;
    messages.push(message);
    bytes += next;
  }
  return messages;
}

function boundedAround(messages: ChatMessage[], targetSeq: number) {
  const bounded = [...messages];
  let bytes = bounded.reduce((total, message) => total + messageBytes(message), 0);
  while (bounded.length > 1 && bytes > TIMELINE_PAGE_BYTE_LIMIT) {
    const target = bounded.findIndex((message) => message.seq === targetSeq);
    const removeFromStart = target > bounded.length - target - 1;
    const [removed] = removeFromStart ? bounded.splice(0, 1) : bounded.splice(-1, 1);
    bytes -= messageBytes(removed!);
  }
  return bounded;
}

export class ChatRepositoryReader {
  private readonly outline: ChatOutlineReader;

  constructor(private readonly database: SqliteDatabase) {
    this.outline = new ChatOutlineReader(database);
  }

  /* 刷新一条就只查一条：一次外源同步刷新一条 Chat，却把全部 Chat
     的元数据连同子查询重算一遍，是启动同步里最贵的那笔冤枉钱。

     没有活跃代的只读 Chat 一行都不投影：投影它必然抛错，而 listMetadata
     是整库的投影——一条中断的导入不该让整个 ChatStore 起不来。启动 reaper
     负责把这种残行清掉，这里只是永不为一行而全盘皆输的那道防线。 */
  listMetadata(deviceId: string, chatId?: string): ChatMetadata[] {
    const rows = this.database.prepare(
      `SELECT c.*,
              a.aggregate_revision, a.timeline_revision,
              m.local_project_id, m.visibility_state,
              m.archived_at local_archived_at,
              b.state binding_state, b.home_dir, b.session_backend, b.session_id,
              b.session_tool_plan_json, b.start_state_json,
              b.execution_dir, b.execution_kind,
              u.app_role, u.context_json, u.grants_json, u.grant_revision,
              u.read_only_reason, t.job_json,
              o.source_kind, o.storage_fingerprint, o.canonical_native_id,
              o.aliases_json, o.resume_alias, o.original_cwd, o.history_revision,
              o.adoption_snapshot_id, o.snapshot_digest, o.source_size, o.source_mtime_ns,
              o.source_status,
              g.generation_id active_generation_id,
              g.entry_count active_generation_entry_count,
              g.incomplete_tail active_generation_incomplete_tail,
              (SELECT payload_json FROM chat_messages cm
                WHERE cm.chat_id = c.id ORDER BY cm.seq DESC LIMIT 1) last_message_json,
              (SELECT v.payload_json
                 FROM chat_import_generation_entries ge
                 JOIN chat_import_entry_versions v ON v.entry_version_id = ge.entry_version_id
                WHERE ge.chat_id = c.id AND ge.generation_id = g.generation_id
                ORDER BY ge.delivery_seq DESC LIMIT 1) last_imported_payload_json,
              (SELECT ge.delivery_seq FROM chat_import_generation_entries ge
                WHERE ge.chat_id = c.id AND ge.generation_id = g.generation_id
                ORDER BY ge.delivery_seq LIMIT 1) first_imported_seq,
              (SELECT v.created_at
                 FROM chat_import_generation_entries ge
                 JOIN chat_import_entry_versions v ON v.entry_version_id = ge.entry_version_id
                WHERE ge.chat_id = c.id AND ge.generation_id = g.generation_id
                ORDER BY ge.delivery_seq LIMIT 1) first_imported_created_at
         FROM chats c
         JOIN chat_local_aggregate_state a ON a.chat_id = c.id AND a.device_id = ?
         JOIN chat_local_memberships m ON m.chat_id = c.id AND m.device_id = ?
         LEFT JOIN chat_device_bindings b ON b.chat_id = c.id AND b.device_id = ?
         LEFT JOIN chat_local_authorities u ON u.chat_id = c.id AND u.device_id = ?
         LEFT JOIN chat_title_jobs t ON t.chat_id = c.id AND t.device_id = ?
         LEFT JOIN chat_import_origins o ON o.chat_id = c.id
         LEFT JOIN chat_active_import_generations ag ON ag.chat_id = c.id
         LEFT JOIN chat_import_generations g
           ON g.chat_id = ag.chat_id AND g.generation_id = ag.generation_id
        WHERE (c.lifecycle_kind <> 'external-readonly' OR g.generation_id IS NOT NULL)
        ${chatId === undefined ? "" : "AND c.id = ?"}
        ORDER BY c.updated_at DESC, c.created_at DESC, c.id`
    ).all(
      deviceId, deviceId, deviceId, deviceId, deviceId,
      ...(chatId === undefined ? [] : [chatId])
    ) as Row[];
    return rows.map((row) => this.metadataFromRow(row));
  }

  private metadataFromRow(row: Row): ChatMetadata {
    if (row.lifecycle_kind === "external-readonly") {
      return this.readonlyMetadataFromRow(row);
    }
    const lastMessage = row.last_message_json
      ? messageSchema.parse(parseJson(row.last_message_json, "last message"))
      : null;
    if (!lastMessage) throw new Error("native Chat metadata has no retained message");
    const session = row.session_backend && row.session_id
      ? {
          backend: row.session_backend,
          id: row.session_id,
          ...(row.session_tool_plan_json
            ? { toolPlan: parseJson(row.session_tool_plan_json, "session tool plan") }
            : {}),
        }
      : null;
    const importOrigin = row.source_kind
      ? {
          sourceKind: row.source_kind,
          storageFingerprint: row.storage_fingerprint,
          canonicalNativeId: row.canonical_native_id,
          aliases: parseJson(row.aliases_json, "import aliases"),
          resumeAlias: row.resume_alias,
          originalCwd: row.original_cwd,
          historyRevision: row.history_revision,
          ...(row.adoption_snapshot_id
            ? { adoptionSnapshotId: row.adoption_snapshot_id }
            : {}),
          sourceSize: row.source_size,
          sourceMtimeNs: row.source_mtime_ns,
          sourceStatus: row.source_status,
          incompleteTail: incompleteTailOf(row),
        }
      : null;
    const record = chatRecordSchema.parse({
      id: row.id,
      incarnationId: row.incarnation_id,
      title: row.title,
      agent: row.agent,
      session,
      importOrigin,
      snapshotDigest: row.snapshot_digest ?? null,
      parentChatId: row.parent_chat_id ?? null,
      parentIncarnationId: row.parent_incarnation_id ?? null,
      parentMessageId: row.parent_message_id ?? null,
      inheritedThroughSeq: row.inherited_through_seq ?? null,
      executionDir: row.binding_state === "ready" ? row.execution_dir ?? null : null,
      executionKind: row.binding_state === "ready" ? row.execution_kind ?? null : null,
      projectId: row.local_project_id ?? null,
      appRole: row.app_role ?? null,
      context: parseJson(row.context_json, "authority context"),
      startState: parseJson(row.start_state_json, "binding start state"),
      titleSource: row.title_source,
      titleJob: parseJson(row.job_json, "title job"),
      readOnlyReason: row.read_only_reason ?? undefined,
      chatRecordRevision: row.aggregate_revision,
      chatMessageRevision: row.native_message_revision,
      grants: parseJson(row.grants_json, "authority grants"),
      grantRevision: row.grant_revision,
      homeDir: row.home_dir,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      archivedAt: row.local_archived_at ?? row.archived_at ?? undefined,
      nextSeq: row.next_seq,
      trimmedThroughSeq: row.trimmed_through_seq || undefined,
      messages: [lastMessage],
    });
    return metadataOf(record);
  }

  private readonlyMetadataFromRow(row: Row): ChatMetadata {
    if (!row.active_generation_id) {
      throw new Error("external-readonly Chat has no active generation");
    }
    const payload = row.last_imported_payload_json
      ? parseJson(row.last_imported_payload_json, "imported preview")
      : null;
    const preview = payload && typeof payload === "object" && "preview" in payload
      ? String((payload as { preview: unknown }).preview) || null
      : null;
    const importOrigin = this.readonlyImportOrigin(row);
    return {
      id: String(row.id),
      incarnationId: String(row.incarnation_id),
      title: row.title === null ? null : String(row.title),
      agent: row.agent as ChatRecord["agent"],
      session: null,
      importOrigin,
      snapshotDigest: null,
      parentChatId: null,
      parentIncarnationId: null,
      parentMessageId: null,
      inheritedThroughSeq: null,
      executionDir: null,
      executionKind: null,
      projectId: row.local_project_id === null ? null : String(row.local_project_id),
      appRole: null,
      context: { kind: "ordinary" },
      /* 导入的会话是「说过话的」会话：判成 unstarted 会让它同时从全局搜索
         与历史可见性里消失——第一条 entry 就是它的开场，如实报出来。 */
      startState: readonlyStartState(row),
      titleSource: row.title_source as ChatRecord["titleSource"],
      titleJob: { state: "none" },
      readOnlyReason: "external-readonly",
      chatRecordRevision: Number(row.aggregate_revision),
      chatMessageRevision: Number(row.timeline_revision),
      grants: [],
      grantRevision: 0,
      homeDir: null,
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
      ...(row.local_archived_at === null && row.archived_at === null
        ? {}
        : { archivedAt: Number(row.local_archived_at ?? row.archived_at) }),
      nextSeq: 1,
      preview,
    };
  }

  getRecord(chatId: string, deviceId: string): ChatRecord | null {
    const core = this.database.prepare(
      `SELECT c.*,
              a.aggregate_revision, a.timeline_revision, m.local_project_id,
              m.archived_at local_archived_at,
              b.state binding_state, b.home_dir, b.session_backend, b.session_id,
              b.execution_dir, b.execution_kind, b.session_tool_plan_json,
              b.start_state_json, u.app_role, u.context_json, u.grants_json,
              u.grant_revision, u.read_only_reason, t.job_json,
              o.source_kind, o.storage_fingerprint, o.canonical_native_id,
              o.aliases_json, o.resume_alias, o.original_cwd, o.history_revision,
              o.adoption_snapshot_id, o.snapshot_digest, o.source_size, o.source_mtime_ns,
              o.source_status,
              g.generation_id active_generation_id, g.entry_count active_generation_entry_count,
              g.incomplete_tail active_generation_incomplete_tail,
              g.byte_size active_generation_byte_size
         FROM chats c
         JOIN chat_local_aggregate_state a ON a.chat_id = c.id AND a.device_id = ?
         JOIN chat_local_memberships m ON m.chat_id = c.id AND m.device_id = ?
         LEFT JOIN chat_device_bindings b ON b.chat_id = c.id AND b.device_id = ?
         LEFT JOIN chat_local_authorities u ON u.chat_id = c.id AND u.device_id = ?
         LEFT JOIN chat_title_jobs t ON t.chat_id = c.id AND t.device_id = ?
         LEFT JOIN chat_import_origins o ON o.chat_id = c.id
         LEFT JOIN chat_active_import_generations ag ON ag.chat_id = c.id
         LEFT JOIN chat_import_generations g
           ON g.chat_id = ag.chat_id AND g.generation_id = ag.generation_id
        WHERE c.id = ?`
    ).get(deviceId, deviceId, deviceId, deviceId, deviceId, chatId) as Row | undefined;
    if (!core) return null;
    assertFullAggregateBudget(this.database, core, chatId);
    if (core.lifecycle_kind === "external-readonly") {
      return this.readonlyRecordFromRow(core);
    }
    const rows = this.database.prepare(
      "SELECT * FROM chat_messages WHERE chat_id = ? ORDER BY seq"
    ).all(chatId) as Row[];
    const subagents = this.readSubagents(chatId);
    const branches = this.readBranches(chatId);
    const session = core.session_backend && core.session_id
      ? {
          backend: core.session_backend,
          id: core.session_id,
          ...(core.session_tool_plan_json
            ? { toolPlan: parseJson(core.session_tool_plan_json, "session tool plan") }
            : {}),
        }
      : null;
    const importOrigin = core.source_kind
      ? {
          sourceKind: core.source_kind,
          storageFingerprint: core.storage_fingerprint,
          canonicalNativeId: core.canonical_native_id,
          aliases: parseJson(core.aliases_json, "import aliases"),
          resumeAlias: core.resume_alias,
          originalCwd: core.original_cwd,
          historyRevision: core.history_revision,
          ...(core.adoption_snapshot_id
            ? { adoptionSnapshotId: core.adoption_snapshot_id }
            : {}),
          sourceSize: core.source_size,
          sourceMtimeNs: core.source_mtime_ns,
          sourceStatus: core.source_status,
          incompleteTail: incompleteTailOf(core),
        }
      : null;
    return chatRecordSchema.parse({
      id: core.id,
      incarnationId: core.incarnation_id,
      title: core.title,
      agent: core.agent,
      session,
      importOrigin,
      snapshotDigest: core.snapshot_digest ?? null,
      parentChatId: core.parent_chat_id ?? null,
      parentIncarnationId: core.parent_incarnation_id ?? null,
      parentMessageId: core.parent_message_id ?? null,
      inheritedThroughSeq: core.inherited_through_seq ?? null,
      executionDir: core.binding_state === "ready" ? core.execution_dir ?? null : null,
      executionKind: core.binding_state === "ready" ? core.execution_kind ?? null : null,
      projectId: core.local_project_id ?? null,
      appRole: core.app_role ?? null,
      context: parseJson(core.context_json, "authority context"),
      startState: parseJson(core.start_state_json, "binding start state"),
      titleSource: core.title_source,
      titleJob: parseJson(core.job_json, "title job"),
      ...(core.read_only_reason ? { readOnlyReason: core.read_only_reason } : {}),
      chatRecordRevision: core.aggregate_revision,
      chatMessageRevision: core.native_message_revision,
      grants: parseJson(core.grants_json, "authority grants"),
      grantRevision: core.grant_revision,
      homeDir: core.home_dir,
      createdAt: core.created_at,
      updatedAt: core.updated_at,
      ...(core.local_archived_at === null && core.archived_at === null
        ? {}
        : { archivedAt: core.local_archived_at ?? core.archived_at }),
      nextSeq: core.next_seq,
      ...(Number(core.trimmed_through_seq) > 0
        ? { trimmedThroughSeq: core.trimmed_through_seq }
        : {}),
      ...(branches.length ? { supersededBranches: branches } : {}),
      ...(Number(core.branches_trimmed_through_seq) > 0
        ? { supersededBranchesTrimmedThroughSeq: core.branches_trimmed_through_seq }
        : {}),
      messages: rows.map(messageFromRow),
      ...(Object.keys(subagents).length ? { subagents } : {}),
    });
  }

  private readonlyRecordFromRow(core: Row): ChatRecord {
    if (!core.active_generation_id) {
      throw new Error("external-readonly Chat has no active generation");
    }
    const rows = this.database.prepare(
      `${IMPORTED_ENTRY_SELECT}
        WHERE e.chat_id = ? AND e.generation_id = ?
        ORDER BY e.delivery_seq`
    ).all(String(core.id), String(core.active_generation_id)) as Row[];
    const messages = rows.map((row) => this.importedMessage(row));
    /* 空的源文件也是一份诚实的历史：只读段允许零条消息，原生段的
       messages.min(1) 不该把「这次导入什么都没有」判成非法记录。 */
    return readonlyChatRecordSchema.parse({
      id: String(core.id),
      incarnationId: String(core.incarnation_id),
      title: core.title === null ? null : String(core.title),
      agent: core.agent,
      session: null,
      importOrigin: this.readonlyImportOrigin(core),
      snapshotDigest: null,
      parentChatId: null,
      parentIncarnationId: null,
      parentMessageId: null,
      inheritedThroughSeq: null,
      executionDir: null,
      executionKind: null,
      projectId: core.local_project_id === null ? null : String(core.local_project_id),
      appRole: null,
      context: { kind: "ordinary" },
      startState: messages.length
        ? {
            kind: "started-exact",
            firstUserMessageAt: messages[0]!.createdAt,
            firstUserMessageSeq: messages[0]!.seq,
          }
        : { kind: "unstarted" },
      titleSource: core.title_source,
      titleJob: { state: "none" },
      readOnlyReason: "external-readonly",
      chatRecordRevision: Number(core.aggregate_revision),
      chatMessageRevision: Number(core.timeline_revision),
      grants: [],
      grantRevision: 0,
      homeDir: null,
      createdAt: Number(core.created_at),
      updatedAt: Number(core.updated_at),
      ...(core.local_archived_at === null && core.archived_at === null
        ? {}
        : { archivedAt: Number(core.local_archived_at ?? core.archived_at) }),
      nextSeq: Math.max(1, (messages.at(-1)?.seq ?? 0) + 1),
      messages,
    });
  }

  private readonlyImportOrigin(row: Row): NonNullable<ChatRecord["importOrigin"]> {
    const aliases = parseJson(row.aliases_json, "readonly import aliases");
    if (!Array.isArray(aliases) || aliases.some((value) => typeof value !== "string")) {
      throw new Error("readonly import aliases are invalid");
    }
    return {
      sourceKind: row.source_kind as NonNullable<ChatRecord["importOrigin"]>["sourceKind"],
      storageFingerprint: String(row.storage_fingerprint),
      canonicalNativeId: String(row.canonical_native_id),
      aliases,
      resumeAlias: String(row.resume_alias),
      originalCwd: String(row.original_cwd),
      historyRevision: String(row.history_revision),
      sourceSize: Number(row.source_size),
      sourceMtimeNs: String(row.source_mtime_ns),
      sourceStatus: row.source_status as NonNullable<ChatRecord["importOrigin"]>["sourceStatus"],
      incompleteTail: incompleteTailOf(row),
    };
  }

  getTimelinePage(
    input: { chatId: string; cursor?: ChatTimelineCursor | null; limit?: number },
    deviceId: string
  ): ChatTimelinePage | null {
    const fence = this.timelineFence(input.chatId, deviceId);
    if (!fence) return null;
    if (input.cursor) this.assertTimelineCursor(fence, input.cursor);
    const limit = Math.max(1, Math.min(200, input.limit ?? 50));
    if (input.cursor?.segment === "imported" || fence.lifecycle_kind === "external-readonly") {
      return this.importedTimelinePage(input.chatId, fence, input.cursor?.beforeSeq, limit);
    }
    const before = input.cursor?.beforeSeq ?? Number.MAX_SAFE_INTEGER;
    const rows = this.database.prepare(
      `SELECT * FROM chat_messages
        WHERE chat_id = ? AND seq < ?
        ORDER BY seq DESC LIMIT ?`
    ).all(input.chatId, before, limit + 1) as Row[];
    return this.timelinePageOf(input.chatId, fence, rows, limit);
  }

  getTimelineAround(
    input: ChatTimelineAroundInput,
    deviceId: string
  ): ChatTimelinePage | null {
    const fence = this.timelineFence(input.chatId, deviceId);
    if (!fence) return null;
    if (input.fence) {
      this.assertTimelineCursor(fence, {
        ...input.fence,
        segment: fence.lifecycle_kind === "external-readonly" ? "imported" : "native",
        beforeSeq: Number.MAX_SAFE_INTEGER,
      });
    }
    const target = this.database.prepare(
      "SELECT seq FROM chat_messages WHERE chat_id = ? AND message_id = ?"
    ).get(input.chatId, input.messageId) as Row | undefined;
    if (!target) return this.importedTimelineAround(input.chatId, input.messageId, fence, input.radius);
    const radius = Math.max(1, Math.min(100, input.radius ?? 25));
    const before = this.database.prepare(
      `SELECT * FROM chat_messages
        WHERE chat_id = ? AND seq < ? ORDER BY seq DESC LIMIT ?`
    ).all(input.chatId, Number(target.seq), radius) as Row[];
    const center = this.database.prepare(
      "SELECT * FROM chat_messages WHERE chat_id = ? AND seq = ?"
    ).get(input.chatId, Number(target.seq)) as Row;
    const after = this.database.prepare(
      `SELECT * FROM chat_messages
        WHERE chat_id = ? AND seq > ? ORDER BY seq LIMIT ?`
    ).all(input.chatId, Number(target.seq), radius) as Row[];
    const rows = [...before.reverse(), center, ...after];
    const messages = boundedAround(rows.map(messageFromRow), Number(target.seq));
    const firstSeq = messages[0]?.seq ?? 1;
    const hasMoreBefore = Boolean(this.database.prepare(
      "SELECT 1 FROM chat_messages WHERE chat_id = ? AND seq < ? LIMIT 1"
    ).get(input.chatId, firstSeq));
    return this.pageOf(input.chatId, fence, messages, hasMoreBefore, firstSeq);
  }

  getOutlinePage(
    chatId: string,
    cursor: ChatOutlineCursor | undefined,
    limitInput: number,
    deviceId: string
  ) {
    return this.outline.getPage(chatId, cursor, limitInput, deviceId);
  }

  findMessages(input: Extract<DatabaseCommand, { kind: "find-messages" }>) {
    return this.outline.findMessages(input);
  }

  private timelineFence(chatId: string, deviceId: string) {
    return this.database.prepare(
      `SELECT c.incarnation_id, c.native_message_revision,
              c.lifecycle_kind,
              g.generation_id active_generation_id
         FROM chats c
         JOIN chat_local_memberships m ON m.chat_id = c.id AND m.device_id = ?
         LEFT JOIN chat_active_import_generations g ON g.chat_id = c.id
        WHERE c.id = ?`
    ).get(deviceId, chatId) as Row | undefined;
  }

  private assertTimelineCursor(row: Row, cursor: ChatTimelineCursor) {
    if (
      cursor.incarnationId !== String(row.incarnation_id) ||
      cursor.nativeMessageRevision !== Number(row.native_message_revision) ||
      cursor.activeGenerationId !== this.activeGeneration(row)
    ) {
      throw new Error("CHAT_TIMELINE_STALE");
    }
  }

  private activeGeneration(row: Row) {
    return row.active_generation_id === null
      ? null
      : String(row.active_generation_id);
  }

  private timelinePageOf(
    chatId: string,
    fence: Row,
    rows: Row[],
    limit: number
  ): ChatTimelinePage {
    const newest = boundedNewest(rows, limit, messageFromRow);
    const messages = newest.reverse();
    const firstSeq = messages[0]?.seq ?? 1;
    const hasNativeBefore = rows.length > newest.length;
    const hasImportedBefore = !hasNativeBefore && Boolean(fence.active_generation_id);
    if (hasImportedBefore) {
      const activeGenerationId = this.activeGeneration(fence);
      return {
        chatId,
        incarnationId: String(fence.incarnation_id),
        nativeMessageRevision: Number(fence.native_message_revision),
        activeGenerationId,
        messages,
        hasMoreBefore: true,
        olderCursor: {
          segment: "imported",
          beforeSeq: Number.MAX_SAFE_INTEGER,
          incarnationId: String(fence.incarnation_id),
          nativeMessageRevision: Number(fence.native_message_revision),
          activeGenerationId,
        },
      };
    }
    return this.pageOf(chatId, fence, messages, hasNativeBefore, firstSeq);
  }

  private pageOf(
    chatId: string,
    fence: Row,
    messages: ChatMessage[],
    hasMoreBefore: boolean,
    firstSeq: number,
    segment: ChatTimelineCursor["segment"] = "native"
  ): ChatTimelinePage {
    const activeGenerationId = this.activeGeneration(fence);
    return {
      chatId,
      incarnationId: String(fence.incarnation_id),
      nativeMessageRevision: Number(fence.native_message_revision),
      activeGenerationId,
      messages,
      hasMoreBefore,
      olderCursor: hasMoreBefore
        ? {
            segment,
            beforeSeq: firstSeq,
            incarnationId: String(fence.incarnation_id),
            nativeMessageRevision: Number(fence.native_message_revision),
            activeGenerationId,
          }
        : null,
    };
  }

  private importedTimelinePage(
    chatId: string,
    fence: Row,
    beforeSeq: number | undefined,
    limit: number
  ) {
    if (!fence.active_generation_id) return this.pageOf(chatId, fence, [], false, 1, "imported");
    const rows = this.database.prepare(
      `${IMPORTED_ENTRY_SELECT}
        WHERE e.chat_id = ? AND e.generation_id = ? AND e.delivery_seq < ?
        ORDER BY e.delivery_seq DESC LIMIT ?`
    ).all(
      chatId,
      fence.active_generation_id as string,
      beforeSeq ?? Number.MAX_SAFE_INTEGER,
      limit + 1
    ) as Row[];
    const newest = boundedNewest(rows, limit, (row) => this.importedMessage(row));
    const messages = newest.reverse();
    const firstSeq = messages[0]?.seq ?? 1;
    return this.pageOf(chatId, fence, messages, rows.length > newest.length, firstSeq, "imported");
  }

  private importedTimelineAround(
    chatId: string,
    messageId: string,
    fence: Row,
    radiusInput: number | undefined
  ) {
    if (!fence.active_generation_id) return null;
    const target = this.database.prepare(
      `SELECT e.delivery_seq
         FROM chat_import_generation_entries e
         JOIN chat_import_entry_versions v ON v.entry_version_id = e.entry_version_id
        WHERE e.chat_id = ? AND e.generation_id = ?
          AND (v.entry_version_id = ? OR v.source_message_id = ?)
        LIMIT 1`
    ).get(chatId, fence.active_generation_id as string, messageId, messageId) as Row | undefined;
    if (!target) return null;
    const radius = Math.max(1, Math.min(100, radiusInput ?? 25));
    const seq = Number(target.delivery_seq);
    const preceding = this.database.prepare(
      `SELECT delivery_seq FROM chat_import_generation_entries
        WHERE chat_id = ? AND generation_id = ? AND delivery_seq < ?
        ORDER BY delivery_seq DESC LIMIT ?`
    ).all(chatId, fence.active_generation_id as string, seq, radius) as Row[];
    const following = this.database.prepare(
      `SELECT delivery_seq FROM chat_import_generation_entries
        WHERE chat_id = ? AND generation_id = ? AND delivery_seq > ?
        ORDER BY delivery_seq LIMIT ?`
    ).all(chatId, fence.active_generation_id as string, seq, radius) as Row[];
    const sequences = [
      ...preceding.reverse().map((row) => Number(row.delivery_seq)),
      seq,
      ...following.map((row) => Number(row.delivery_seq)),
    ];
    const placeholders = sequences.map(() => "?").join(", ");
    const rows = this.database.prepare(
      `${IMPORTED_ENTRY_SELECT}
        WHERE e.chat_id = ? AND e.generation_id = ?
          AND e.delivery_seq IN (${placeholders})
        ORDER BY e.delivery_seq`
    ).all(
      chatId,
      fence.active_generation_id as string,
      ...sequences
    ) as Row[];
    const messages = boundedAround(
      rows.map((row) => this.importedMessage(row)),
      seq
    );
    const firstSeq = messages[0]?.seq ?? 1;
    const hasMoreBefore = Boolean(this.database.prepare(
      `SELECT 1 FROM chat_import_generation_entries
        WHERE chat_id = ? AND generation_id = ? AND delivery_seq < ? LIMIT 1`
    ).get(chatId, fence.active_generation_id as string, firstSeq));
    return this.pageOf(chatId, fence, messages, hasMoreBefore, firstSeq, "imported");
  }

  /* 导入的一条 entry 与原生一条消息说同一种话：工具事件投影成 parts、
     源生工时落到 durationMs，于是 ChatTurn 照常画出「已处理 ›」折叠头。
     segment 是投影位，只从这里出，落盘侧永不写。 */
  private importedMessage(row: Row): ChatMessage {
    const content = this.importedContent(row);
    const common = {
      id: String(row.entry_version_id),
      content,
      createdAt: row.created_at === null || row.created_at === undefined
        ? 0
        : Number(row.created_at),
      seq: Number(row.delivery_seq),
      segment: "imported" as const,
    };
    if (row.role === "user") return { ...common, role: "user" };
    const payload = parseJson(row.payload_json, "imported payload") as {
      tools?: unknown;
      workedForMs?: unknown;
      process?: unknown;
      plan?: unknown;
    };
    /* 一 turn 一条 assistant：被折进来的中间陈述逐条摊开（每步先它之前那些
       工具、再它的陈述），末条自己的工具殿后——与产品 TurnParts 逐结构
       同构，渲染层零分支。 */
    const parts = projectForeignParts({
      process: Array.isArray(payload.process)
        ? payload.process as ForeignProcessStep[]
        : undefined,
      tools: Array.isArray(payload.tools) ? payload.tools as ForeignToolEvent[] : undefined,
      budgetBytes: Math.max(0, MESSAGE_BYTE_LIMIT - Buffer.byteLength(content, "utf8")),
      itemIdPrefix: String(row.entry_version_id),
    });
    return {
      ...common,
      role: "assistant",
      ...(parts.length ? { parts } : {}),
      /* 计划正文是本轮权威产出：与原生 planMessageKind 同律，空正文不成卡片。 */
      ...(payload.plan === true && content.trim() ? { kind: "plan" as const } : {}),
      ...(typeof payload.workedForMs === "number" && payload.workedForMs >= 0
        ? { durationMs: Math.trunc(payload.workedForMs) }
        : {}),
    };
  }

  private importedContent(row: Row) {
    if (Number(row.byte_size) <= IMPORTED_MESSAGE_BYTE_LIMIT) {
      return String(row.content_text ?? "");
    }
    const payload = parseJson(row.payload_json, "imported payload") as { preview?: unknown };
    const preview = truncateUtf8(String(payload.preview ?? ""), IMPORTED_MESSAGE_BYTE_LIMIT / 2, "…").value;
    return `${preview}\n\n[Imported content retained outside the renderer: ${Number(row.byte_size)} bytes]`;
  }

  private readSubagents(chatId: string): Record<string, PersistedSubagent> {
    const value = Object.fromEntries((this.database.prepare(
      "SELECT agent_thread_id, meta_json, parts_json FROM chat_subagents WHERE chat_id = ? ORDER BY agent_thread_id"
    ).all(chatId) as Row[]).map((row) => [
      String(row.agent_thread_id),
      {
        meta: parseJson(row.meta_json, "subagent meta"),
        parts: parseJson(row.parts_json, "subagent parts"),
      },
    ]));
    const parsed = subagentsSchema.parse(value);
    assertSubagentBudget(parsed);
    return parsed;
  }

  private readBranches(chatId: string): SupersededChatBranch[] {
    return (this.database.prepare(
      "SELECT * FROM chat_superseded_branches WHERE chat_id = ? ORDER BY ordinal"
    ).all(chatId) as Row[]).map((branch) => ({
      intentId: String(branch.intent_id),
      supersededAt: Number(branch.superseded_at),
      supersedesUserMessageId: String(branch.supersedes_user_message_id),
      throughSeqEnd: Number(branch.through_seq_end),
      messages: (this.database.prepare(
        "SELECT message_json FROM chat_branch_messages WHERE chat_id = ? AND branch_intent_id = ? ORDER BY ordinal"
      ).all(chatId, branch.intent_id as string) as Row[]).map((row) =>
        messageSchema.parse(parseJson(row.message_json, "branch message"))
      ),
    }));
  }
}
