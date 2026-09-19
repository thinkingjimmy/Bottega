/**
 * [INPUT]: Depends on the worker connection and canonical serialization.
 * [OUTPUT]: Provides frozen native/imported source custody, role/timestamp fidelity, attachment roots, outbox publication and source-bounded root release.
 * [POS]: SQLite leaf used inside the caller's existing transaction; it never owns a second connection.
 */
import type { SqliteDatabase } from "../connection";
import { digest, json, type Row } from "../repository/codec";
import { canonicalJson, projectChatClassification, type SyncScope } from "../../../../../shared/local-storage/contracts";
import type { ChatFacts } from "../../chat-summary";

export function retainSource(db: SqliteDatabase, input: {
  chatId: string; kind: string; revision: number; payload: unknown; rootId: string; now: number; scope?: SyncScope; deviceId?: string;
}): { sourceId: string; digest: string } {
  const payload = canonicalJson(input.payload);
  if (Buffer.byteLength(payload) > 3 * 1024 * 1024) {
    const sources = [];
    for (let offset = 0; offset < payload.length; offset += 256 * 1024) {
      sources.push(retainSource(db, { ...input, kind: "payload-chunk", payload: { ordinal: sources.length, text: payload.slice(offset, offset + 256 * 1024) } }));
    }
    const source = retainSource(db, { ...input, payload: { encoding: "canonical-json-chunks-v1", contentDigest: digest(payload), bytes: Buffer.byteLength(payload), sources } });
    for (const attachmentId of attachmentIds(input.payload)) db.prepare("INSERT OR IGNORE INTO chat_retained_attachments(source_id,attachment_id) VALUES(?,?)").run(source.sourceId, attachmentId);
    return source;
  }
  const hash = digest(payload);
  const chat = db.prepare("SELECT cloud_environment,cloud_user_id FROM chats WHERE id=?").get(input.chatId) as Row | undefined;
  const environment = input.scope?.environment ?? chat?.cloud_environment ?? null;
  const userId = input.scope?.userId ?? chat?.cloud_user_id ?? null;
  const localDevice = input.deviceId ?? (db.prepare("SELECT device_id FROM chat_device_bindings WHERE chat_id=? LIMIT 1").get(input.chatId) as Row | undefined)?.device_id ?? null;
  const sourceId = digest(`${environment}\0${userId}\0${input.chatId}\0${input.kind}\0${input.revision}\0${hash}`);
  db.prepare(`INSERT OR IGNORE INTO chat_retained_sources(source_id,chat_id,kind,revision,payload_json,digest,created_at,environment,user_id,local_device_id)
    VALUES(?,?,?,?,?,?,?,?,?,?)`).run(sourceId, input.chatId, input.kind, input.revision, payload, hash, input.now, environment === null ? null : String(environment), userId === null ? null : String(userId), localDevice === null ? null : String(localDevice));
  db.prepare("INSERT OR IGNORE INTO chat_retention_roots(root_id,source_id) VALUES(?,?)").run(input.rootId, sourceId);
  for (const attachmentId of attachmentIds(input.payload)) {
    db.prepare("INSERT OR IGNORE INTO chat_retained_attachments(source_id,attachment_id) VALUES(?,?)").run(sourceId, attachmentId);
  }
  return { sourceId, digest: hash };
}
function attachmentIds(payload: unknown): Set<string> {
  const ids = new Set<string>();
  const visit = (value: unknown) => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) { value.forEach(visit); return; }
    const item = value as Record<string, unknown>;
    if (typeof item.id === "string" && typeof item.mediaType === "string" && typeof item.byteSize === "number") ids.add(item.id);
    for (const child of Object.values(item)) visit(child);
  };
  visit(payload);
  return ids;
}
export function enqueueSource(db: SqliteDatabase, input: {
  id: string; scope: SyncScope; chatId: string; entityKind: string; entityId?: string;
  kind: string; revision: number; executionEpoch: number | null; payload: unknown; now: number;
}) {
  const source = retainSource(db, { chatId: input.chatId, kind: input.kind, revision: input.revision,
    payload: input.payload, scope: input.scope, rootId: `outbox:${input.id}`, now: input.now });
  const manifest = json({ version: 1, chatId: input.chatId, sources: [source] });
  db.prepare(`INSERT INTO cloud_outbox(id,environment,user_id,entity_kind,entity_id,kind,seq_or_revision,
    execution_epoch,payload_json,payload_digest,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(
    input.id, input.scope.environment, input.scope.userId, input.entityKind, input.entityId ?? input.chatId,
    input.kind, input.revision, input.executionEpoch, manifest, digest(manifest), input.now);
  return source;
}
export function assertClassification(db: SqliteDatabase, facts: ChatFacts, allowChange = false) {
  const projected = projectChatClassification(facts);
  const row = db.prepare("SELECT conversation_kind,portable_app_id,portable_project_id FROM chats WHERE id=?").get(facts.id) as Row | undefined;
  if (row && !allowChange && (row.conversation_kind !== projected.conversationKind ||
      row.portable_app_id !== projected.appId || row.portable_project_id !== projected.projectId)) {
    throw new Error("CHAT_CLASSIFICATION_CHANGE_REQUIRES_LIFECYCLE");
  }
  return projected;
}
export function writeClassification(db: SqliteDatabase, facts: ChatFacts) {
  const value = projectChatClassification(facts);
  db.prepare("UPDATE chats SET conversation_kind=?,portable_app_id=?,portable_project_id=? WHERE id=?")
    .run(value.conversationKind, value.appId, value.projectId, facts.id);
}
export function collectRetainedAttachmentIds(db: SqliteDatabase) {
  const ids = new Set((db.prepare(`SELECT attachment_id FROM chat_retained_attachments a
    WHERE EXISTS(SELECT 1 FROM chat_retention_roots r WHERE r.source_id=a.source_id)`).all() as Row[]).map(row => String(row.attachment_id)));
  for (const row of db.prepare("SELECT message_json FROM chat_branch_messages").iterate() as Iterable<Row>) {
    for (const id of attachmentIds(JSON.parse(String(row.message_json)))) ids.add(id);
  }
  return ids;
}
export function releaseRoot(db: SqliteDatabase, rootId: string) {
  const sources = db.prepare("SELECT source_id FROM chat_retention_roots WHERE root_id=?").all(rootId) as Row[];
  db.prepare("DELETE FROM chat_retention_roots WHERE root_id=?").run(rootId);
  const remove = db.prepare("DELETE FROM chat_retained_sources WHERE source_id=? AND NOT EXISTS(SELECT 1 FROM chat_retention_roots r WHERE r.source_id=chat_retained_sources.source_id)");
  for (const source of sources) remove.run(String(source.source_id));
}

export function releaseMirrorArchiveRoots(db: SqliteDatabase, scope: SyncScope, chatId: string) {
  const roots = db.prepare(`SELECT r.root_id,r.source_id FROM chat_retention_roots r
    JOIN chat_retained_sources s ON s.source_id=r.source_id
    JOIN chats c ON c.id=s.chat_id
    WHERE c.id=? AND c.cloud_state='mirror' AND s.environment=? AND s.user_id=?
      AND (r.root_id LIKE 'mirror:%' OR r.root_id LIKE 'settlement:%')`)
    .all(chatId, scope.environment, scope.userId) as Row[];
  for (const root of roots) {
    db.prepare("DELETE FROM chat_retention_roots WHERE root_id=? AND source_id=?")
      .run(String(root.root_id), String(root.source_id));
    db.prepare(`DELETE FROM chat_retained_sources WHERE source_id=?
      AND NOT EXISTS(SELECT 1 FROM chat_retention_roots r WHERE r.source_id=chat_retained_sources.source_id)`)
      .run(String(root.source_id));
  }
}

/** Freeze immutable import content before generation or Chat reclamation can remove it. */
export function retainImportedHistory(db: SqliteDatabase, chatId: string, rootId: string, now: number, scope?: SyncScope) {
  const generation = db.prepare(`SELECT g.generation_id,g.content_digest,g.digest_codec_version,g.incomplete_tail,g.entry_count,o.source_kind
    FROM chat_active_import_generations a JOIN chat_import_generations g ON g.generation_id=a.generation_id
    JOIN chat_import_origins o ON o.chat_id=a.chat_id WHERE a.chat_id=?`).get(chatId) as Row | undefined;
  if (!generation) return null;
  const sources: Array<{ sourceId: string; digest: string }> = [];
  const keep = (payload: unknown, revision: number) => {
    const source = retainSource(db, { chatId, rootId, now, scope, payload, revision, kind: "import-snapshot" });
    sources.push(source);
    return source;
  };
  for (const entry of db.prepare(`SELECT e.delivery_seq,v.entry_version_id,v.payload_json,v.content_digest,v.digest_codec_version,v.role,v.created_at
    FROM chat_import_generation_entries e JOIN chat_import_entry_versions v ON v.entry_version_id=e.entry_version_id
    WHERE e.chat_id=? AND e.generation_id=? ORDER BY e.delivery_seq`).iterate(chatId, String(generation.generation_id)) as Iterable<Row>) {
    const source = keep({ entryVersionId: entry.entry_version_id, deliverySeq: entry.delivery_seq,
      contentDigest: entry.content_digest, digestCodecVersion: entry.digest_codec_version, role: entry.role, createdAt: entry.created_at,
      payload: JSON.parse(String(entry.payload_json)) }, Number(entry.delivery_seq));
    for (const chunk of db.prepare("SELECT field_kind,ordinal,content,byte_size,content_digest FROM chat_import_entry_version_chunks WHERE entry_version_id=? ORDER BY field_kind,ordinal").iterate(String(entry.entry_version_id)) as Iterable<Row>) {
      keep({ entryVersionId: entry.entry_version_id, chunk }, Number(entry.delivery_seq));
    }
    for (const blob of db.prepare(`SELECT e.field_kind,b.content_digest,b.byte_size FROM chat_import_entry_blobs e
      JOIN chat_import_blobs b ON b.content_digest=e.content_digest WHERE e.entry_version_id=?`).iterate(String(entry.entry_version_id)) as Iterable<Row>) {
      db.prepare("INSERT OR IGNORE INTO chat_retained_import_blobs(source_id,content_digest) VALUES(?,?)").run(source.sourceId, String(blob.content_digest));
      keep({ entryVersionId: entry.entry_version_id, fieldKind: blob.field_kind, blob: { sha256: blob.content_digest, bytes: blob.byte_size, mime: "text/plain" } }, Number(entry.delivery_seq));
    }
  }
  return { generation: { ...generation, incomplete_tail: generation.incomplete_tail === "true" }, sources };
}
