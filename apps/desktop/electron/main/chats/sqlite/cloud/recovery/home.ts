/**
 * [INPUT]: Depends on immutable Home job identities, rooted native branches and existing outbox checkpoints.
 * [OUTPUT]: Pins recovery-related Home sources and their manifest proof before upload acknowledgements release custody.
 * [POS]: SQLite recovery leaf shared by canonical settlement, execution replacement and Home delivery.
 */
import { hashChatContent } from "@ai-chat/cloud-protocol/chats/transcript/body";
import type { ChatMessage } from "../../../../../../shared/chats-ipc";
import type { SyncScope } from "../../../../../../shared/local-storage/contracts";
import type { SqliteDatabase } from "../../connection";
import type { Row } from "../../repository/codec";
import { retainSource } from "../retention";
import { retainedSourceRefSchema } from "../delivery/contracts";
import { homeJobSchema, type HomeJob } from "../home/contracts";
import { readRetainedSource } from "../inventory/source";
import type { z } from "zod";
type Source = z.infer<typeof retainedSourceRefSchema>;
function owners(db: SqliteDatabase, scope: SyncScope, chatId: string, jobId: string) {
  return db.prepare(`SELECT DISTINCT r.root_id FROM chat_retained_sources s JOIN chat_retention_roots r ON r.source_id=s.source_id
    WHERE s.chat_id=? AND s.environment=? AND s.user_id=? AND s.kind='recovery-home-owner' AND json_extract(s.payload_json,'$.jobId')=?`)
    .all(chatId, scope.environment, scope.userId, jobId) as Row[];
}
export function recoveryHomeRetained(db: SqliteDatabase, scope: SyncScope, chatId: string, jobId: string) { return owners(db, scope, chatId, jobId).length > 0; }
export function retainHomeArchive(db: SqliteDatabase, scope: SyncScope, job: HomeJob, source: Source, rootId: string, now: number) {
  const checkpoint = db.prepare(`SELECT c.source_id,c.digest FROM cloud_outbox_checkpoints c JOIN cloud_outbox o ON o.id=c.outbox_id
    WHERE o.id=? AND o.environment=? AND o.user_id=? AND c.checkpoint_key='home-manifest'
    ORDER BY c.checkpoint_key LIMIT 1`).get(job.id, scope.environment, scope.userId) as Row | undefined;
  const previous = checkpoint ? undefined : db.prepare(`SELECT payload_json FROM chat_retained_sources s WHERE chat_id=? AND environment=? AND user_id=?
    AND kind='superseded-home-archive' AND json_extract(payload_json,'$.job.id')=? AND EXISTS(SELECT 1 FROM chat_retention_roots r WHERE r.source_id=s.source_id) LIMIT 1`)
    .get(job.chatId, scope.environment, scope.userId, job.id) as Row | undefined;
  const manifest = checkpoint ? { sourceId: String(checkpoint.source_id), digest: String(checkpoint.digest) }
    : previous ? retainedSourceRefSchema.safeParse(JSON.parse(String(previous.payload_json)).manifest).data ?? null : null;
  db.prepare("INSERT OR IGNORE INTO chat_retention_roots(root_id,source_id) VALUES(?,?)").run(rootId, source.sourceId);
  db.prepare("INSERT OR IGNORE INTO chat_retention_roots(root_id,source_id) SELECT ?,source_id FROM chat_retention_roots WHERE root_id=?").run(rootId, `outbox:${job.id}`);
  if (manifest) retainSource(db, { scope, chatId: job.chatId, rootId, kind: "superseded-home-archive", revision: job.throughSeq, payload: { job, source, manifest }, now });
}
export function preserveRecoveryHomeJob(db: SqliteDatabase, scope: SyncScope, job: HomeJob, source: Source, now: number) {
  for (const row of owners(db, scope, job.chatId, job.id)) retainHomeArchive(db, scope, job, source, String(row.root_id), now);
}
export function pinRecoveryHome(db: SqliteDatabase, scope: SyncScope, chatId: string, incarnationId: string, messages: ChatMessage[], rootId: string, now: number) {
  for (const message of messages) {
    if (message.role !== "user") continue;
    const jobId = hashChatContent(["home-turn", scope, chatId, incarnationId, message.id]);
    retainSource(db, { scope, chatId, rootId, kind: "recovery-home-owner", revision: message.seq,
      payload: { jobId, userMessageId: message.id, userSeq: message.seq, incarnationId }, now });
    const row = db.prepare(`SELECT source_id,digest FROM chat_retained_sources WHERE chat_id=? AND environment=? AND user_id=?
      AND kind='terminal-home' AND json_extract(payload_json,'$.id')=? LIMIT 1`).get(chatId, scope.environment, scope.userId, jobId) as Row | undefined;
    if (!row) continue;
    const source = { sourceId: String(row.source_id), digest: String(row.digest) }, job = homeJobSchema.parse(readRetainedSource(db, source));
    if (job.incarnationId !== incarnationId || job.userMessageId !== message.id || job.userSeq !== message.seq) throw new Error("RECOVERY_HOME_IDENTITY_CHANGED");
    retainHomeArchive(db, scope, job, source, rootId, now);
  }
}
