/**
 * [INPUT]: Depends on SQLite canonical facts, immutable source retention and portable allowlists.
 * [OUTPUT]: Provides immutable native snapshots with lifecycle, archive, sequence, local-commit and message-count evidence, plus deletion custody.
 * [POS]: Snapshot boundary runs inside one worker transaction; subsequent edits join the same outbox.
 */
import type { SqliteDatabase } from "../connection";
import type { ChatRepositoryReader } from "../repository/reader";
import { digest, json, type Row } from "../repository/codec";
import { readSavedNative } from "../../../library/mirrors/native-source";
import { portableChatSchema, projectChatClassification, type SyncScope } from "../../../../../shared/local-storage/contracts";
import { enqueueSource, retainSource, retainImportedHistory } from "./retention";
import type { ChatFacts } from "../../chat-summary";
import { portableForkLineage } from "@ai-chat/cloud-protocol/chats/model";
import { captureInitialMetadata } from "./delivery/metadata-capture";

export function portableFacts(facts: ChatFacts, cloudRevision: number) {
  return portableChatSchema.parse({ id: facts.id, incarnationId: facts.incarnationId, title: facts.title,
    agent: facts.agent, options: facts.options, agentRevision: facts.agentRevision,
    classification: projectChatClassification(facts), cloudRevision, createdAt: facts.createdAt, updatedAt: facts.updatedAt,
    ...portableForkLineage(facts), ...(facts.sortKey === undefined ? {} : { sortKey: facts.sortKey }) });
}
export function frozenChatSource(db: SqliteDatabase, facts: ChatFacts, record: ReturnType<ChatRepositoryReader["getRecord"]>,
  cloudRevision: number) {
  const row = db.prepare("SELECT lifecycle_kind,next_seq FROM chats WHERE id=?").get(facts.id) as Row;
  const saved = record ? readSavedNative(db, record) : null, messages = saved?.messages ?? [];
  // Fork/import prefixes establish reading history, never a local user-commit baseline.
  const firstUserSeq = facts.startState.kind === "started-exact" ? facts.startState.firstUserMessageSeq : null;
  const committed = firstUserSeq !== null ? messages.filter(message => message.role === "user" &&
    message.seq >= firstUserSeq && message.seq > (facts.inheritedThroughSeq ?? 0)).at(-1) : undefined;
  return { chat: portableFacts(facts, cloudRevision), lifecycleKind: String(row.lifecycle_kind), archivedAt: facts.archivedAt ?? null,
    nextSeq: row.next_seq === null ? 1 : Number(row.next_seq), lastCommittedUserSeq: committed?.seq ?? null,
    messages, subagents: saved?.subagents ?? {}, branches: record?.supersededBranches ?? [] };
}
export function captureInitial(db: SqliteDatabase, reader: ChatRepositoryReader, scope: SyncScope, deviceId: string, manifestId: string, now: number) {
  const state = db.prepare("SELECT initial_manifest_json FROM cloud_sync_state WHERE environment=? AND user_id=?")
    .get(scope.environment, scope.userId) as Row;
  if (state.initial_manifest_json) {
    const manifest = JSON.parse(String(state.initial_manifest_json)) as { manifestId: string };
    if (manifest.manifestId !== manifestId) throw new Error("INITIALIZATION_ALREADY_CAPTURED");
    return manifest;
  }
  if (db.prepare("SELECT 1 FROM history_import_runs WHERE state='running' LIMIT 1").get()) throw new Error("HISTORY_IMPORT_MUST_SETTLE_BEFORE_SNAPSHOT");
  const entries: Array<{ chatId: string; revision: number; messages: number; sourceId: string; digest: string }> = [];
  for (const facts of reader.listMetadata(deviceId)) {
    if (db.prepare("SELECT 1 FROM cloud_tombstones WHERE environment=? AND user_id=? AND chat_id=?").get(scope.environment, scope.userId, facts.id)) continue;
    const row = db.prepare("SELECT cloud_state,cloud_environment,cloud_user_id FROM chats WHERE id=?").get(facts.id) as Row;
    if (row.cloud_state !== "local-only" && (row.cloud_environment !== scope.environment || row.cloud_user_id !== scope.userId)) throw new Error("CHAT_SCOPE_CONFLICT");
    const record = facts.readOnlyReason === "external-readonly" ? null : reader.getRecord(facts.id, deviceId);
    if (!record && facts.readOnlyReason !== "external-readonly") throw new Error("Snapshot source is unavailable");
    const payload = { ...frozenChatSource(db, facts, record, 0),
      imported: retainImportedHistory(db, facts.id, `manifest:${manifestId}`, now, scope) };
    const source = enqueueSource(db, { id: digest(`${manifestId}\0${facts.id}`), scope, chatId: facts.id, entityKind: "chat",
      kind: "initialize", revision: facts.chatRecordRevision, payload, now });
    captureInitialMetadata(db, scope, digest(`${manifestId}\0${facts.id}`), {
      chat: payload.chat, lifecycleKind: payload.lifecycleKind, archivedAt: payload.archivedAt });
    db.prepare("INSERT OR IGNORE INTO chat_retention_roots(root_id,source_id) VALUES(?,?)").run(`manifest:${manifestId}`, source.sourceId);
    // The upload orders itself by this count: a body costs two round trips and nine checkpoint reads per message.
    entries.push({ chatId: facts.id, revision: facts.chatRecordRevision, messages: payload.messages.length, ...source });
    db.prepare("UPDATE chats SET cloud_state='synced',cloud_environment=?,cloud_user_id=?,cloud_revision=0 WHERE id=?")
      .run(scope.environment, scope.userId, facts.id);
  }
  const manifest = { version: 1, manifestId, scope, capturedAt: now, state: entries.length ? "captured" : "complete", entries };
  if (Buffer.byteLength(json(manifest)) > 4 * 1024 * 1024) throw new Error("Initialization manifest exceeds 4 MiB");
  db.prepare("UPDATE cloud_sync_state SET initial_manifest_json=?,updated_at=? WHERE environment=? AND user_id=?")
    .run(json(manifest), now, scope.environment, scope.userId);
  return manifest;
}
export function archiveDeletion(db: SqliteDatabase, reader: ChatRepositoryReader, chatId: string, incarnationId: string,
  deviceId: string, operationId: string, now: number) {
  const existing = db.prepare("SELECT * FROM chat_deletion_custody WHERE operation_id=?").get(operationId) as Row | undefined;
  if (existing) {
    if (existing.chat_id !== chatId || existing.incarnation_id !== incarnationId) throw new Error("Deletion intent identity changed");
    return { chatId, sourceIds: JSON.parse(String(existing.source_ids_json)) as string[] };
  }
  const facts = reader.listMetadata(deviceId, chatId)[0];
  const record = facts?.readOnlyReason === "external-readonly" ? null : reader.getRecord(chatId, deviceId);
  if (!facts || facts.incarnationId !== incarnationId || (!record && facts.readOnlyReason !== "external-readonly")) throw new Error("INCARNATION_MISMATCH");
  const source = retainSource(db, { chatId, kind: "deletion-custody", revision: facts.chatRecordRevision,
    payload: { record: record ? { ...record, ...readSavedNative(db, record) } : null, facts,
      imported: retainImportedHistory(db, chatId, `deletion:${operationId}`, now) }, deviceId, rootId: `deletion:${operationId}`, now });
  const sourceIds = [source.sourceId];
  for (const pending of db.prepare("SELECT DISTINCT s.source_id FROM chat_retained_sources s JOIN chat_retention_roots r ON r.source_id=s.source_id WHERE s.chat_id=? AND r.root_id LIKE 'outbox:%'").all(chatId) as Row[]) {
    db.prepare("INSERT OR IGNORE INTO chat_retention_roots(root_id,source_id) VALUES(?,?)").run(`deletion:${operationId}`, String(pending.source_id));
    if (!sourceIds.includes(String(pending.source_id))) sourceIds.push(String(pending.source_id));
  }
  const classification = projectChatClassification(facts);
  db.prepare(`INSERT INTO chat_deletion_custody(operation_id,chat_id,incarnation_id,classification_json,source_ids_json,created_at)
    VALUES(?,?,?,?,?,?)`).run(operationId, chatId, incarnationId, json(classification), json(sourceIds), now);
  return { chatId, sourceIds };
}
