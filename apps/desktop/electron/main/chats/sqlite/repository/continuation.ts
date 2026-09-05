/**
 * [INPUT]: Depends on crypto, continuation commands, canonical Chat schemas, SQLite rows, and search projection writer
 * [OUTPUT]: Provides durable continuation input, Home evidence, identity-fenced atomic finalization that upserts every per-device row a renamed readonly Chat already owns, precommit failure, reconciliation reads, and committed-orphan isolation
 * [POS]: Cross-store continuation saga state machine beneath ChatRepository; committed Home evidence is never compensated by this layer
 */

import { randomUUID } from "node:crypto";
import { messageSchema } from "../../chat-schema";
import { adoptInputSchema } from "../../chat-input";
import type {
  ContinuationSagaSnapshot,
  DatabaseCommand,
} from "../database-protocol";
import type { SqliteDatabase } from "../connection";
import {
  changes,
  json,
  messageSearchText,
  parseJson,
  persistedMessagePayload,
  type Row,
} from "./codec";
import { ChatRecordWriter } from "./writer";

export class ContinuationSagaRepository {
  private readonly writer: ChatRecordWriter;

  constructor(
    private readonly database: SqliteDatabase,
    private readonly now: () => number
  ) {
    this.writer = new ChatRecordWriter(database, now);
  }

  begin(command: Extract<DatabaseCommand, { kind: "begin-continuation-saga" }>) {
    const active = this.database.prepare(
      `SELECT * FROM chat_continuation_sagas
        WHERE chat_id = ? AND state NOT IN ('completed', 'committed-orphan', 'failed')
        ORDER BY updated_at DESC LIMIT 1`
    ).get(command.chatId) as Row | undefined;
    if (active) throw new Error("A continuation saga is already active for this Chat");
    const source = this.database.prepare(
      `SELECT c.lifecycle_kind, o.can_resume, a.generation_id
         FROM chats c
         JOIN chat_import_origins o ON o.chat_id = c.id
         JOIN chat_active_import_generations a ON a.chat_id = c.id
        WHERE c.id = ?`
    ).get(command.chatId) as Row | undefined;
    if (
      !source ||
      source.lifecycle_kind !== "external-readonly" ||
      Number(source.can_resume) !== 1 ||
      source.generation_id !== command.generationId
    ) {
      throw new Error("Continuation source is not a resumable readonly generation");
    }
    const sagaId = `continuation_${randomUUID().replaceAll("-", "")}`;
    const continuationInput = adoptInputSchema.parse(command.continuationInput);
    if (continuationInput.id !== command.chatId) {
      throw new Error("Continuation input does not match its readonly Chat");
    }
    this.database.prepare(
      `INSERT INTO chat_continuation_sagas(
         saga_id, chat_id, generation_id, device_id,
         home_intent_id, continuation_input_json, home_receipt_json, home_dir_identity_json,
         intent_operation_id, finalize_operation_id, state, last_error, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, 'intent-written', NULL, ?)`
    ).run(
      sagaId,
      command.chatId,
      command.generationId,
      command.deviceId,
      command.homeIntentId,
      json(continuationInput),
      command.operationId,
      command.finalizeOperationId,
      command.now
    );
    return this.require(sagaId);
  }

  markHomePreparing(
    command: Extract<DatabaseCommand, { kind: "mark-continuation-home-preparing" }>
  ) {
    const updated = this.database.prepare(
      `UPDATE chat_continuation_sagas SET state = 'home-preparing', updated_at = ?
        WHERE saga_id = ? AND state = 'intent-written'`
    ).run(command.now, command.sagaId);
    if (changes(updated) !== 1) throw new Error("Continuation saga cannot prepare Home");
    return this.require(command.sagaId);
  }

  recordHomeCommitted(
    command: Extract<DatabaseCommand, { kind: "record-continuation-home-committed" }>
  ) {
    const current = this.require(command.sagaId);
    const receipt = command.homeReceipt;
    const identity = command.homeDirIdentity;
    if (
      receipt.phase !== "committed" ||
      receipt.chatId !== current.chatId ||
      receipt.intentId !== current.homeIntentId ||
      !/^[a-f0-9]{32}$/.test(receipt.incarnationId) ||
      !receipt.homeDir ||
      !identity.root.dev || !identity.root.ino ||
      !identity.home.dev || !identity.home.ino
    ) {
      throw new Error("Committed Home evidence does not match the continuation intent");
    }
    if (current.state === "home-committed") {
      if (
        json(current.homeReceipt) !== json(command.homeReceipt) ||
        json(current.homeDirIdentity) !== json(command.homeDirIdentity)
      ) {
        throw new Error("Committed Home evidence changed");
      }
      return current;
    }
    const updated = this.database.prepare(
      `UPDATE chat_continuation_sagas
          SET state = 'home-committed', home_receipt_json = ?,
              home_dir_identity_json = ?, updated_at = ?
        WHERE saga_id = ? AND state = 'home-preparing'`
    ).run(
      json(command.homeReceipt),
      json(command.homeDirIdentity),
      command.now,
      command.sagaId
    );
    if (changes(updated) !== 1) throw new Error("Continuation Home commit is out of order");
    return this.require(command.sagaId);
  }

  finalize(command: Extract<DatabaseCommand, { kind: "finalize-continuation-saga" }>) {
    const saga = this.require(command.sagaId);
    if (
      saga.state !== "home-committed" ||
      saga.finalizeOperationId !== command.operationId ||
      saga.deviceId !== command.deviceId ||
      saga.generationId !== command.expectedGenerationId ||
      saga.homeReceipt === null ||
      saga.homeDirIdentity === null ||
      saga.continuationInput === null
    ) {
      throw new Error("Continuation finalization fence is stale");
    }
    const homeReceipt = saga.homeReceipt as import("../database-protocol").ContinuationHomeEvidence["receipt"];
    const intent = adoptInputSchema.parse(saga.continuationInput);
    if (
      homeReceipt.chatId !== saga.chatId ||
      homeReceipt.incarnationId !== command.incarnationId ||
      homeReceipt.homeDir !== command.homeDir ||
      intent.id !== saga.chatId ||
      intent.incarnationId !== command.incarnationId ||
      /* 只比会话身份：toolPlan 是派发时冻结的，intent 写下时它还不存在，
         比整个 session 会把每一次正常收养都判成证据不符。 */
      intent.session.backend !== command.session.backend ||
      intent.session.id !== command.session.id ||
      intent.snapshotDigest !== command.snapshotDigest ||
      intent.importOrigin.adoptionSnapshotId !== command.adoptionSnapshotId ||
      intent.firstMessage.id !== command.firstMessage.id ||
      intent.firstMessage.content !== command.firstMessage.content ||
      intent.firstMessage.createdAt !== command.firstMessage.createdAt ||
      !/^adopt_[a-f0-9]{64}$/.test(command.adoptionSnapshotId) ||
      !/^[a-f0-9]{64}$/.test(command.snapshotDigest)
    ) {
      throw new Error("Continuation finalization does not match committed Home evidence");
    }
    const chat = this.database.prepare(
      `SELECT c.lifecycle_kind, c.incarnation_id, c.core_revision,
              c.native_message_revision,
              a.aggregate_revision, a.timeline_revision,
              g.generation_id active_generation_id
         FROM chats c
         JOIN chat_local_aggregate_state a
           ON a.chat_id = c.id AND a.device_id = ?
         JOIN chat_active_import_generations g ON g.chat_id = c.id
        WHERE c.id = ?`
    ).get(command.deviceId, saga.chatId) as Row | undefined;
    if (
      !chat ||
      chat.lifecycle_kind !== "external-readonly" ||
      chat.active_generation_id !== command.expectedGenerationId
    ) {
      throw new Error("Readonly Chat changed before continuation finalization");
    }
    /* 续聊不换身份：只读 Chat 出生时就带着这个 incarnation，收养只是
       给它接上原生段。改写它等于让深链、AppGrant 与时间线游标同时失效。 */
    if (chat.incarnation_id !== command.incarnationId) {
      throw new Error("Continuation must keep the readonly Chat incarnation");
    }
    const message = messageSchema.parse(command.firstMessage);
    if (message.role !== "user" || message.seq !== 1) {
      throw new Error("Continuation must begin its native segment with user seq=1");
    }
    this.database.prepare(
      "UPDATE chat_continuation_sagas SET state = 'finalizing', updated_at = ? WHERE saga_id = ?"
    ).run(command.now, command.sagaId);
    const coreRevision = Number(chat.core_revision) + 1;
    /* 只读期每激活一代都会推高 timeline_revision，而 native_message_revision
       始终是 0：两者在这里必须合流成同一个数。原生 append 的 CAS 正是拿
       「timeline_revision == native_message_revision」当锁，错开一格之后
       收养完成的那条会话就再也写不进第二条消息。取两者较大者再加一，
       既恢复这条不变量，又不让 renderer 手里的版本号倒退。 */
    const messageRevision = Math.max(
      Number(chat.native_message_revision),
      Number(chat.timeline_revision)
    ) + 1;
    const aggregateRevision = Number(chat.aggregate_revision) + 1;
    const timelineRevision = messageRevision;
    this.database.prepare(
      `UPDATE chats
          SET lifecycle_kind = 'external-managed', next_seq = 2,
              updated_at = ?, core_revision = ?, native_message_revision = ?
        WHERE id = ? AND lifecycle_kind = 'external-readonly'`
    ).run(
      command.now,
      coreRevision,
      messageRevision,
      saga.chatId
    );
    this.database.prepare(
      `UPDATE chat_local_aggregate_state
          SET aggregate_revision = ?, timeline_revision = ?
        WHERE chat_id = ? AND device_id = ?`
    ).run(aggregateRevision, timelineRevision, saga.chatId, command.deviceId);
    this.database.prepare(
      `UPDATE chat_local_memberships
          SET membership_revision = membership_revision + 1, updated_at = ?
        WHERE chat_id = ? AND device_id = ?`
    ).run(command.now, saga.chatId, command.deviceId);
    /* 收养一条被改过名/归档过的只读 Chat 时，这三张按 (chat_id, device_id)
       建主键的表可能已经有行了：presentation 写过 title job，重放写过绑定。
       裸 INSERT 会在 Home 已提交之后撞 UNIQUE，把这次收养变成 committed-orphan。 */
    this.database.prepare(
      `INSERT INTO chat_device_bindings(
         chat_id, device_id, state, home_dir, session_backend, session_id,
         session_tool_plan_json, start_state_json, binding_revision,
         created_at, updated_at
       ) VALUES (?, ?, 'ready', ?, ?, ?, ?, ?, 1, ?, ?)
       ON CONFLICT(chat_id, device_id) DO UPDATE SET
         state = 'ready', home_dir = excluded.home_dir,
         session_backend = excluded.session_backend,
         session_id = excluded.session_id,
         session_tool_plan_json = excluded.session_tool_plan_json,
         start_state_json = excluded.start_state_json,
         binding_revision = chat_device_bindings.binding_revision + 1,
         updated_at = excluded.updated_at`
    ).run(
      saga.chatId,
      command.deviceId,
      command.homeDir,
      command.session.backend,
      command.session.id,
      command.session.toolPlan ? json(command.session.toolPlan) : null,
      json(command.startState),
      command.now,
      command.now
    );
    this.database.prepare(
      `INSERT INTO chat_local_authorities(
         chat_id, device_id, app_role, context_json, grants_json,
         grant_revision, read_only_reason, authority_revision
       ) VALUES (?, ?, ?, ?, ?, ?, NULL, 1)
       ON CONFLICT(chat_id, device_id) DO UPDATE SET
         app_role = excluded.app_role, context_json = excluded.context_json,
         grants_json = excluded.grants_json,
         grant_revision = excluded.grant_revision,
         read_only_reason = NULL,
         authority_revision = chat_local_authorities.authority_revision + 1`
    ).run(
      saga.chatId,
      command.deviceId,
      command.appRole,
      json(command.context),
      json(command.grants),
      command.grantRevision
    );
    this.database.prepare(
      `INSERT INTO chat_title_jobs(chat_id, device_id, state, job_json, updated_at)
       VALUES (?, ?, 'none', '{"state":"none"}', ?)
       ON CONFLICT(chat_id, device_id) DO UPDATE SET
         state = excluded.state, job_json = excluded.job_json,
         updated_at = excluded.updated_at`
    ).run(saga.chatId, command.deviceId, command.now);
    const rowId = this.insertFirstMessage(saga.chatId, message);
    this.writer.writeSearchDocument(
      saga.chatId,
      "native",
      String(rowId),
      messageSearchText(message)
    );
    this.database.prepare(
      `UPDATE chat_import_origins
          SET managed_at = ?, can_resume = 1,
              adoption_snapshot_id = ?, snapshot_digest = ?
        WHERE chat_id = ?`
    ).run(
      command.now,
      command.adoptionSnapshotId,
      command.snapshotDigest,
      saga.chatId
    );
    this.database.prepare(
      `UPDATE chat_continuation_sagas
          SET state = 'completed', continuation_input_json = NULL, updated_at = ?
        WHERE saga_id = ? AND state = 'finalizing'`
    ).run(command.now, command.sagaId);
    return {
      saga: this.require(command.sagaId),
      chatId: saga.chatId,
      aggregateRevision,
      nativeMessageRevision: messageRevision,
    };
  }

  isolateOrphan(
    command: Extract<DatabaseCommand, { kind: "isolate-continuation-orphan" }>
  ) {
    const updated = this.database.prepare(
      `UPDATE chat_continuation_sagas
          SET state = 'committed-orphan', last_error = ?, updated_at = ?
        WHERE saga_id = ? AND state IN ('home-committed', 'finalizing')`
    ).run(command.reason, command.now, command.sagaId);
    if (changes(updated) !== 1) {
      throw new Error("Only a committed, unfinalized Home may become an orphan");
    }
    return this.require(command.sagaId);
  }

  failPrecommit(
    command: Extract<DatabaseCommand, { kind: "fail-continuation-precommit" }>
  ) {
    const updated = this.database.prepare(
      `UPDATE chat_continuation_sagas
          SET state = 'failed', continuation_input_json = NULL,
              last_error = ?, updated_at = ?
        WHERE saga_id = ? AND state IN ('intent-written', 'home-preparing')`
    ).run(command.reason, command.now, command.sagaId);
    if (changes(updated) !== 1) {
      throw new Error("Only a pre-commit continuation may fail without isolation");
    }
    return this.require(command.sagaId);
  }

  get(sagaId: string) {
    const row = this.database.prepare(
      "SELECT * FROM chat_continuation_sagas WHERE saga_id = ?"
    ).get(sagaId) as Row | undefined;
    return row ? this.fromRow(row) : null;
  }

  listReconcilable() {
    return (this.database.prepare(
      `SELECT * FROM chat_continuation_sagas
        WHERE state IN ('intent-written', 'home-preparing', 'home-committed', 'finalizing')
        ORDER BY updated_at, saga_id`
    ).all() as Row[]).map((row) => this.fromRow(row));
  }

  private insertFirstMessage(
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
    const attachments = message.role === "user" ? message.attachments ?? [] : [];
    for (const [ordinal, attachment] of attachments.entries()) {
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
    return rowId;
  }

  private require(sagaId: string) {
    const saga = this.get(sagaId);
    if (!saga) throw new Error("Continuation saga does not exist");
    return saga;
  }

  private fromRow(row: Row): ContinuationSagaSnapshot {
    return {
      sagaId: String(row.saga_id),
      chatId: String(row.chat_id),
      generationId: String(row.generation_id),
      deviceId: String(row.device_id),
      homeIntentId: String(row.home_intent_id),
      continuationInput: row.continuation_input_json === null
        ? null
        : adoptInputSchema.parse(parseJson(row.continuation_input_json, "continuation input")),
      homeReceipt: row.home_receipt_json === null
        ? null
        : parseJson(row.home_receipt_json, "Home receipt"),
      homeDirIdentity: row.home_dir_identity_json === null
        ? null
        : parseJson(row.home_dir_identity_json, "Home directory identity"),
      intentOperationId: String(row.intent_operation_id),
      finalizeOperationId: String(row.finalize_operation_id),
      state: row.state as ContinuationSagaSnapshot["state"],
      lastError: row.last_error === null ? null : String(row.last_error),
      updatedAt: Number(row.updated_at),
    };
  }
}
