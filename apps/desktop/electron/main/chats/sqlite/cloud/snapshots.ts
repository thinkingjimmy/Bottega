/**
 * [INPUT]: Depends on SQLite canonical facts, immutable source retention and portable allowlists.
 * [OUTPUT]: Provides recoverable initialization manifests and durable deletion custody.
 * [POS]: Snapshot boundary runs inside one worker transaction; subsequent edits join the same outbox.
 */
import type { SqliteDatabase } from "../connection";
import type { ChatRepositoryReader } from "../repository/reader";
import { digest, json, type Row } from "../repository/codec";
import { portableChatSchema, projectChatClassification, type SyncScope } from "../../../../../shared/local-storage/contracts";
import { enqueueSource, retainSource, retainImportedHistory } from "./retention";
import type { ChatFacts } from "../../chat-summary";

export function portableFacts(facts: ChatFacts, cloudRevision: number) {
  return portableChatSchema.parse({ id: facts.id, incarnationId: facts.incarnationId, title: facts.title,
    agent: facts.agent, options: facts.options, agentRevision: facts.agentRevision,
    classification: projectChatClassification(facts), cloudRevision, createdAt: facts.createdAt, updatedAt: facts.updatedAt });
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
  const entries: Array<{ chatId: string; revision: number; sourceId: string; digest: string }> = [];
  for (const facts of reader.listMetadata(deviceId)) {
    const row = db.prepare("SELECT cloud_state,cloud_environment,cloud_user_id FROM chats WHERE id=?").get(facts.id) as Row;
    if (row.cloud_state !== "local-only" && (row.cloud_environment !== scope.environment || row.cloud_user_id !== scope.userId)) throw new Error("CHAT_SCOPE_CONFLICT");
    const record = facts.readOnlyReason === "external-readonly" ? null : reader.getRecord(facts.id, deviceId);
    if (!record && facts.readOnlyReason !== "external-readonly") throw new Error("Snapshot source is unavailable");
    const payload = { chat: portableFacts(facts, 0), messages: record?.messages ?? [], subagents: record?.subagents ?? {},
      branches: record?.supersededBranches ?? [], imported: retainImportedHistory(db, facts.id, `manifest:${manifestId}`, now, scope) };
    const source = enqueueSource(db, { id: digest(`${manifestId}\0${facts.id}`), scope, chatId: facts.id, entityKind: "chat",
      kind: "initialize", revision: facts.chatRecordRevision, executionEpoch: null, payload, now });
    db.prepare("INSERT OR IGNORE INTO chat_retention_roots(root_id,source_id) VALUES(?,?)").run(`manifest:${manifestId}`, source.sourceId);
    entries.push({ chatId: facts.id, revision: facts.chatRecordRevision, ...source });
    db.prepare("UPDATE chats SET cloud_state='synced',cloud_environment=?,cloud_user_id=?,cloud_revision=0 WHERE id=?")
      .run(scope.environment, scope.userId, facts.id);
  }
  const manifest = { version: 1, manifestId, scope, capturedAt: now, state: "captured", entries };
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
    payload: { record, facts, imported: retainImportedHistory(db, chatId, `deletion:${operationId}`, now) }, deviceId, rootId: `deletion:${operationId}`, now });
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
