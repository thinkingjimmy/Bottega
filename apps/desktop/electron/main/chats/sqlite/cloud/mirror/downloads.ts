/**
 * [INPUT]: Depends on scoped mirror identities, indexed body custody and bounded native writers.
 * [OUTPUT]: Stages complete cloud histories across restarts and atomically publishes bounded execution windows.
 * [POS]: Download transaction leaf; confirmed pages remain independent of native authority and offline tails.
 */
import { z } from "zod";
import type { EncryptedTurnPrefix } from "@ai-chat/cloud-protocol/turns/encrypted/model";
import { validateTurnPrefix } from "@ai-chat/cloud-protocol/turns/encrypted/wire";
import type { CloudChatHead } from "@ai-chat/cloud-protocol/chats/model";
import { chatBodySchema, hashChatContent, type ChatBody } from "@ai-chat/cloud-protocol/chats/transcript/body";
import type { ChatRecord } from "../../../../../../shared/chats-ipc";
import type { SyncScope } from "../../../../../../shared/local-storage/contracts";
import type { SqliteDatabase } from "../../connection";
import type { ChatRecordWriter } from "../../repository/writer";
import { type Row } from "../../repository/codec";
import { retainSource, releaseRoot } from "../retention";
import { readRetainedSource } from "../inventory/source";
import { readMetadataState } from "../delivery/metadata-confirm";
import { mirrorBodyReferenceSchema, mirrorDownloadSchema } from "./contracts";
import { writeMirrorFiles } from "./files";
import { markerRoot, bodySourceRoot, clearMirrorBodies, hasMirrorMessage, indexMirrorBody, mirrorReferences, readMirrorBody, type MirrorBodyReference } from "./references";
import { mirrorExecutionWindow } from "./window";
import { indexConfirmedMirror } from "../../search/mirrors";
type Download = z.infer<typeof mirrorDownloadSchema>;
const legacyDownloadSchema = mirrorDownloadSchema.omit({ sourceCount: true }).extend({ sources: z.array(mirrorBodyReferenceSchema).max(2000) }).strict();
function persistedDownload(db: SqliteDatabase, scope: SyncScope, chatId: string): { download: Download; legacy: MirrorBodyReference[] | null } | null {
  const rows = db.prepare(`SELECT s.source_id,s.digest FROM chat_retention_roots r JOIN chat_retained_sources s ON s.source_id=r.source_id
    WHERE r.root_id=? AND s.environment=? AND s.user_id=? AND s.kind='mirror-download'`).all(markerRoot(scope, chatId), scope.environment, scope.userId) as Row[];
  if (rows.length > 1) throw new Error("MIRROR_DOWNLOAD_IDENTITY_CONFLICT");
  if (!rows[0]) return null;
  const value = readRetainedSource(db, { sourceId: String(rows[0].source_id), digest: String(rows[0].digest) });
  const modern = mirrorDownloadSchema.safeParse(value);
  if (modern.success) return { download: modern.data, legacy: null };
  const { sources, ...legacy } = legacyDownloadSchema.parse(value);
  return { download: { ...legacy, sourceCount: sources.length }, legacy: sources };
}
export function readMirrorDownload(db: SqliteDatabase, scope: SyncScope, chatId: string): Download | null {
  return persistedDownload(db, scope, chatId)?.download ?? null;
}
function save(db: SqliteDatabase, scope: SyncScope, chatId: string, value: Download, now: number) {
  const payload = mirrorDownloadSchema.parse(value), rootId = markerRoot(scope, chatId);
  releaseRoot(db, rootId);
  retainSource(db, { chatId, scope, kind: "mirror-download", revision: value.bodyRevision, payload, rootId, now });
  return payload;
}
function indexedDownload(db: SqliteDatabase, scope: SyncScope, chatId: string, now: number) {
  const state = persistedDownload(db, scope, chatId);
  if (state?.legacy) {
    for (const reference of state.legacy) {
      const body = readMirrorBody(db, reference);
      indexMirrorBody(db, scope, chatId, state.download.bodyRevision, reference, now);
      writeMirrorFiles(db, scope, chatId, reference.messageId, { attachments: body.attachments, media: body.media }, now);
    }
    state.download = { ...state.download, complete: false };
    save(db, scope, chatId, state.download, now);
  }
  return state?.download ?? null;
}
function requireMirror(db: SqliteDatabase, scope: SyncScope, chatId: string) {
  const row = db.prepare("SELECT * FROM chats WHERE id=? AND cloud_environment=? AND cloud_user_id=? AND cloud_state IN ('mirror','synced')").get(chatId, scope.environment, scope.userId) as Row | undefined;
  if (!row) throw new Error("MIRROR_IDENTITY_REQUIRED");
  const head = readMetadataState(db, scope, chatId).head as CloudChatHead | null;
  if (!head || head.chat.incarnationId !== row.incarnation_id) throw new Error("MIRROR_HEAD_UNAVAILABLE");
  return head;
}
export function beginMirrorBody(db: SqliteDatabase, scope: SyncScope, head: CloudChatHead, now: number, writer: ChatRecordWriter) {
  const current = requireMirror(db, scope, head.chat.id);
  if (current.bodyRevision !== head.bodyRevision || current.chat.incarnationId !== head.chat.incarnationId) throw new Error("MIRROR_HEAD_CHANGED");
  const previous = indexedDownload(db, scope, head.chat.id, now);
  if (previous?.bodyRevision === head.bodyRevision && (!previous.complete || previous.sourceCount + previous.emptyCount > 0 || head.headSeq === 0)) {
    const row = db.prepare("SELECT cloud_state FROM chats WHERE id=?").get(head.chat.id) as Row;
    if (previous.complete && row.cloud_state === "mirror") indexConfirmedMirror(db, writer, scope, head.chat.id);
    return previous;
  }
  clearMirrorBodies(db, scope, head.chat.id);
  return save(db, scope, head.chat.id, { bodyRevision: head.bodyRevision, beforeSeq: head.headSeq + 1, complete: false, head, sourceCount: 0, emptyCount: 0 }, now);
}
export function stageMirrorBody(db: SqliteDatabase, scope: SyncScope, chatId: string, bodyRevision: number, beforeSeq: number, bodyHash: string, input: ChatBody, now: number) {
  const head = requireMirror(db, scope, chatId), value = indexedDownload(db, scope, chatId, now), body = chatBodySchema.parse(input);
  if (!value || value.complete || value.bodyRevision !== bodyRevision || head.bodyRevision !== bodyRevision || value.beforeSeq !== beforeSeq) throw new Error("MIRROR_BODY_CURSOR_CHANGED");
  if (hashChatContent(body) !== bodyHash || body.message.segment || body.message.seq >= beforeSeq || body.message.seq > value.head.headSeq ||
      hasMirrorMessage(db, scope, chatId, body.message.id)) throw new Error("MIRROR_BODY_INVALID");
  const source = retainSource(db, { chatId, scope, kind: "mirror-body", revision: bodyRevision, payload: body, rootId: bodySourceRoot(scope, chatId, body.message.seq), now });
  indexMirrorBody(db, scope, chatId, bodyRevision, { ...source, messageId: body.message.id, seq: body.message.seq }, now);
  writeMirrorFiles(db, scope, chatId, body.message.id, { attachments: body.attachments, media: body.media }, now);
  return save(db, scope, chatId, { ...value, beforeSeq: body.message.seq, sourceCount: value.sourceCount + 1 }, now);
}
export function stageMirrorEmpty(db: SqliteDatabase, scope: SyncScope, chatId: string, bodyRevision: number, beforeSeq: number, input: EncryptedTurnPrefix, now: number) {
  const head = requireMirror(db, scope, chatId), value = indexedDownload(db, scope, chatId, now);
  if (!value || value.complete || value.bodyRevision !== bodyRevision || head.bodyRevision !== bodyRevision || value.beforeSeq !== beforeSeq) throw new Error("MIRROR_BODY_CURSOR_CHANGED");
  const prefix = validateTurnPrefix(input.encryptedSpace.scope, input), start = prefix.start;
  if (start.chatId !== chatId || start.incarnationId !== head.chat.incarnationId ||       start.assistantSeq >= beforeSeq || start.assistantSeq > value.head.headSeq || hasMirrorMessage(db, scope, chatId, start.assistantMessageId)) throw new Error("MIRROR_EMPTY_PREFIX_INVALID");
  // The admitted client replayed every authenticated frame; retain that exact source without inventing a message.
  retainSource(db, { chatId, scope, kind: "mirror-empty-prefix", revision: bodyRevision, payload: prefix,
    rootId: bodySourceRoot(scope, chatId, start.assistantSeq), now });
  return save(db, scope, chatId, { ...value, beforeSeq: start.assistantSeq, emptyCount: value.emptyCount + 1 }, now);
}
export function completeMirrorBody(db: SqliteDatabase, writer: ChatRecordWriter, scope: SyncScope, chatId: string, bodyRevision: number, beforeSeq: number, now: number) {
  const head = requireMirror(db, scope, chatId), value = indexedDownload(db, scope, chatId, now);
  if (!value || value.bodyRevision !== bodyRevision || head.bodyRevision !== bodyRevision || value.beforeSeq !== beforeSeq) throw new Error("MIRROR_BODY_CURSOR_CHANGED");
  const row = db.prepare("SELECT cloud_state FROM chats WHERE id=?").get(chatId) as Row;
  if (value.complete) {
    if (row.cloud_state === "mirror") indexConfirmedMirror(db, writer, scope, chatId);
    return value;
  }
  if (row.cloud_state === "mirror") {
    const window = mirrorExecutionWindow(db, scope, chatId);
    writer.writeMessages({ id: chatId, messages: window.messages } as ChatRecord); writer.writeSubagentSnapshot(chatId, window.subagents);
    writer.writeSearchDocuments({ id: chatId, title: head.chat.title, messages: [] } as unknown as ChatRecord);
    indexConfirmedMirror(db, writer, scope, chatId);
    db.prepare("UPDATE chats SET next_seq=?,trimmed_through_seq=?,core_revision=core_revision+1,native_message_revision=native_message_revision+1 WHERE id=?")
      .run(value.head.reservedThroughSeq + 1, window.trimmedThroughSeq, chatId);
  }
  // A native owner keeps its offline tail; readers use the independent confirmed body sources.
  return save(db, scope, chatId, { ...value, complete: true }, now);
}
export function confirmedBodyPage(db: SqliteDatabase, scope: SyncScope, chatId: string, revision: number, beforeSeq: number | null, limit: number) {
  const head = requireMirror(db, scope, chatId), state = persistedDownload(db, scope, chatId), value = state?.download;
  if (head.bodyRevision !== revision) throw new Error("MIRROR_HEAD_CHANGED");
  if (!value?.complete || value.bodyRevision !== revision || !value.sourceCount && !value.emptyCount && head.headSeq > 0) return { ready: false, messages: [], cursor: null, complete: false };
  const candidates = state?.legacy
    ? state.legacy.filter(source => beforeSeq === null || source.seq < beforeSeq).sort((a, b) => b.seq - a.seq).slice(0, limit + 1)
    : mirrorReferences(db, scope, chatId, beforeSeq, limit + 1);
  const messages: ChatBody[] = []; let bytes = 0;
  for (const source of candidates.slice(0, limit)) {
    const body = readMirrorBody(db, source), size = Buffer.byteLength(JSON.stringify(body));
    if (messages.length && bytes + size > 4 * 1024 * 1024) break;
    messages.push(body); bytes += size;
  }
  const complete = messages.length === candidates.length;
  return { ready: true, messages, cursor: complete ? null : messages.at(-1)!.message.seq, complete };
}
