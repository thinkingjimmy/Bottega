/**
 * [INPUT]: Depends on saved SQLite messages, verified mirror bodies and device/account authority.
 * [OUTPUT]: Reads bounded revision-fenced pages of complete native history and one-statement mirror catalog pages, independent of the execution window.
 * [POS]: Worker-only folder export adapter; remote content never acquires local execution authority.
 */
import type { CloudChatHead } from "@ai-chat/cloud-protocol/chats/model";
import type { ChatMessage, ChatRecord } from "../../../../shared/chats-ipc";
import type { SyncScope } from "../../../../shared/local-storage/contracts";
import type { SqliteDatabase } from "../../chats/sqlite/connection";
import { messageFromRow, parseJson, type Row } from "../../chats/sqlite/repository/codec";
import { mirrorReferences, readMirrorBody } from "../../chats/sqlite/cloud/mirror/references";
import { readMirrorDownload } from "../../chats/sqlite/cloud/mirror/downloads";
import { retainSource, releaseRoot } from "../../chats/sqlite/cloud/retention";
import { readRetainedSource } from "../../chats/sqlite/cloud/inventory/source";
import { readImportDownload } from "../../chats/sqlite/cloud/imported/state";

export type NativeLibraryPage = {
  revision: string; messages: ChatMessage[]; subagents: NonNullable<ChatRecord["subagents"]>;
};
export function readSavedNative(db: SqliteDatabase, record: ChatRecord): ChatRecord {
  const messages = (db.prepare("SELECT * FROM chat_messages WHERE chat_id=? ORDER BY seq").all(record.id) as Row[]).map(messageFromRow);
  const subagents: NativeLibraryPage["subagents"] = { ...record.subagents };
  for (const message of [...messages, ...(record.supersededBranches ?? []).flatMap(branch => branch.messages)]) {
    if (message.role !== "assistant") continue;
    for (const part of message.parts ?? []) {
      if (part.type !== "subagent" || subagents[part.agentThreadId]) continue;
      const saved = readSavedSubagent(db, record.id, part.agentThreadId);
      if (saved) subagents[part.agentThreadId] = saved;
    }
  }
  const pending = Object.values(subagents);
  for (let index = 0; index < pending.length; index++) for (const part of pending[index]!.parts) {
    if (part.type !== "subagent" || subagents[part.agentThreadId]) continue;
    const saved = readSavedSubagent(db, record.id, part.agentThreadId);
    if (saved) { subagents[part.agentThreadId] = saved; pending.push(saved); }
  }
  return { ...record, messages, subagents };
}
function readSavedSubagent(db: SqliteDatabase, chatId: string, agentId: string) {
  const saved = db.prepare("SELECT meta_json,parts_json FROM chat_subagents WHERE chat_id=? AND agent_thread_id=?").get(chatId, agentId) as Row | undefined;
  if (saved) return { meta: parseJson(saved.meta_json, "subagent meta"), parts: parseJson(saved.parts_json, "subagent parts") } as NativeLibraryPage["subagents"][string];
  const retained = db.prepare(`SELECT s.source_id,s.digest FROM chat_retention_roots r
    JOIN chat_retained_sources s ON s.source_id=r.source_id WHERE r.root_id=? AND s.kind='library-subagent'`)
    .get(`library:${chatId}:subagent:${agentId}`) as Row | undefined;
  return retained ? readRetainedSource(db, { sourceId: String(retained.source_id), digest: String(retained.digest) }) as NativeLibraryPage["subagents"][string] : undefined;
}
export function readLibraryNative(db: SqliteDatabase, input: { chatId: string; deviceId: string; afterSeq: number; limit?: number }, scope: SyncScope | null): NativeLibraryPage {
  const limit = Math.min(Math.max(Math.trunc(input.limit ?? 50), 1), 500);
  const row = db.prepare(`SELECT c.*,m.device_id FROM chats c LEFT JOIN chat_local_memberships m
    ON m.chat_id=c.id AND m.device_id=? WHERE c.id=?`).get(input.deviceId, input.chatId) as Row | undefined;
  const scoped = row && scope && row.cloud_environment === scope.environment && row.cloud_user_id === scope.userId;
  if (!row || !row.device_id && (!scoped || row.cloud_state !== "mirror")) throw new Error("LIBRARY_CHAT_UNAVAILABLE");
  const download = scoped ? readMirrorDownload(db, scope, input.chatId) : null;
  const bodies = scoped ? mirrorReferences(db, scope, input.chatId, input.afterSeq, limit, "after").map(ref => readMirrorBody(db, ref)) : [];
  const native = row.device_id ? (db.prepare("SELECT * FROM chat_messages WHERE chat_id=? AND seq>? ORDER BY seq LIMIT ?")
    .all(input.chatId, input.afterSeq, limit) as Row[]).map(messageFromRow) : [];
  const messages = [...new Map([...bodies.map(body => body.message), ...native].map(message => [message.seq, message])).values()]
    .sort((a, b) => a.seq - b.seq).slice(0, limit);
  const subagents: NativeLibraryPage["subagents"] = {};
  for (const message of messages) {
    if (message.role !== "assistant") continue;
    for (const part of message.parts ?? []) {
      if (part.type !== "subagent") continue;
      const value = (row.device_id ? readSavedSubagent(db, input.chatId, part.agentThreadId) : undefined)
        ?? bodies.find(body => body.message.seq === message.seq)?.subagents?.[part.agentThreadId];
      if (value) subagents[part.agentThreadId] = value as NativeLibraryPage["subagents"][string];
    }
  }
  const pending = Object.values(subagents);
  for (let index = 0; index < pending.length; index++) for (const part of pending[index]!.parts) {
    if (part.type !== "subagent" || subagents[part.agentThreadId]) continue;
    const value = (row.device_id ? readSavedSubagent(db, input.chatId, part.agentThreadId) : undefined)
      ?? bodies.flatMap(body => body.subagents?.[part.agentThreadId] ? [body.subagents[part.agentThreadId]] : [])[0];
    if (value) { subagents[part.agentThreadId] = value; pending.push(value); }
  }
  return { revision: `${row.incarnation_id}:${row.native_message_revision}:${download?.bodyRevision ?? 0}`, messages, subagents };
}

export function retainLibrarySubagent(db: SqliteDatabase, chatId: string, agentId: string, now: number) {
  const row = db.prepare("SELECT meta_json,parts_json FROM chat_subagents WHERE chat_id=? AND agent_thread_id=?").get(chatId, agentId) as Row;
  saveLibrarySubagent(db, chatId, agentId, { meta: parseJson(row.meta_json, "subagent meta"), parts: parseJson(row.parts_json, "subagent parts") } as NativeLibraryPage["subagents"][string], now);
}
export function saveLibrarySubagent(db: SqliteDatabase, chatId: string, agentId: string, payload: NativeLibraryPage["subagents"][string], now: number) {
  const rootId = `library:${chatId}:subagent:${agentId}`;
  releaseRoot(db, rootId);
  retainSource(db, { chatId, kind: "library-subagent", revision: 1, rootId, now, payload });
}

export type LibraryMirrorRow = { chatId: string; revision: string; head: CloudChatHead | null; complete: boolean };
/* One statement carries the confirmed head and its revision; a caller that already
   exported that exact revision gets the identity back without parsing the head or
   reading download custody, so an unchanged account costs one query per page. */
export function listLibraryMirrors(db: SqliteDatabase, scope: SyncScope | null, afterId: string | null,
  known: Readonly<Record<string, string>> = {}): LibraryMirrorRow[] {
  if (!scope) return [];
  return (db.prepare(`SELECT c.id,s.confirmed_json,
      json_extract(s.confirmed_json,'$.bodyRevision') body_revision,
      json_extract(s.confirmed_json,'$.chat.cloudRevision') cloud_revision
    FROM chats c JOIN cloud_chat_metadata_state s ON s.chat_id=c.id AND s.environment=? AND s.user_id=?
    WHERE c.cloud_state='mirror' AND c.cloud_environment=? AND c.cloud_user_id=? AND c.id>?
      AND s.confirmed_json IS NOT NULL
      AND NOT EXISTS(SELECT 1 FROM cloud_tombstones t WHERE t.chat_id=c.id AND t.environment=? AND t.user_id=?)
    ORDER BY c.id LIMIT 100`).all(scope.environment, scope.userId, scope.environment, scope.userId,
      afterId ?? "", scope.environment, scope.userId) as Row[]).map(row => {
    const chatId = String(row.id), revision = `cloud:${row.body_revision}:${row.cloud_revision}`;
    if (known[chatId] === revision) return { chatId, revision, head: null, complete: true };
    const head = JSON.parse(String(row.confirmed_json)) as CloudChatHead;
    const native = readMirrorDownload(db, scope, chatId);
    const imported = head.kind !== "native" ? readImportDownload(db, scope, chatId) : null;
    return { chatId, revision: `cloud:${head.bodyRevision}:${head.chat.cloudRevision}`, head,
      complete: native?.complete === true && native.bodyRevision === head.bodyRevision &&
        (head.kind === "native" || imported?.complete === true && imported.bodyRevision === head.bodyRevision) };
  });
}
