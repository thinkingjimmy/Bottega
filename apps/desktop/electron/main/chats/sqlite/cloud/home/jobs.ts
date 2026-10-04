/**
 * [INPUT]: Depends on confirmed Chat identity, the preceding Home tail marker and existing outbox/source retention.
 * [OUTPUT]: Creates immutable terminal Home jobs and preserves causal predecessors; a job that was never frozen can be skipped, which hands its chain position back and records the turn as having no files.
 * [POS]: Worker-only Home scheduling; snapshot bytes are copied by the main process before later local writes.
 */
import { hashChatContent } from "@ai-chat/cloud-protocol/chats/transcript/body";
import type { SyncScope } from "../../../../../../shared/local-storage/contracts";
import type { SqliteDatabase } from "../../connection";
import type { Row } from "../../repository/codec";
import { enqueueSource, releaseRoot, retainSource } from "../retention";
import { readCheckpoint } from "../delivery/checkpoints";
import { readRetainedSource } from "../inventory/source";
import { readMetadataState } from "../delivery/metadata-confirm";
import { homeJobSchema, homeTailSchema, type HomeTurn, type HomeJob } from "./contracts";
import { preserveRecoveryHomeJob } from "../recovery/home";
function sameTurn(job: HomeJob, turn: HomeTurn) {
  if (job.turnId !== turn.turnId || job.chatId !== turn.chatId || job.userMessageId !== turn.userMessageId || job.userSeq !== turn.userSeq || job.throughSeq !== turn.assistantSeq) throw new Error("HOME_TURN_IDENTITY_CHANGED");
  return job;
}
export function captureHomeJob(db: SqliteDatabase, scope: SyncScope, deviceId: string, turn: HomeTurn, now: number) {
  const row = db.prepare("SELECT * FROM chats WHERE id=? AND cloud_environment=? AND cloud_user_id=?")
    .get(turn.chatId, scope.environment, scope.userId) as Row | undefined;
  if (!row || row.cloud_state !== "synced" || row.conversation_kind !== "ordinary" || row.lifecycle_kind === "external-readonly") return null;
  const id = hashChatContent(["home-turn", scope, turn.chatId, row.incarnation_id, turn.userMessageId]);
  const existing = db.prepare("SELECT payload_json FROM cloud_outbox WHERE id=?").get(id) as Row | undefined;
  if (existing) return sameTurn(homeJobSchema.parse(readRetainedSource(db, JSON.parse(String(existing.payload_json)).sources[0])), turn);
  const rootId = tailRoot(scope, turn.chatId), previous = readTail(db, rootId);
  if (previous?.id === id) return sameTurn(homeJobSchema.parse(previous), turn);
  const head = readMetadataState(db, scope, turn.chatId).head;
  const initial = db.prepare("SELECT id FROM cloud_outbox WHERE environment=? AND user_id=? AND kind='initialize' AND json_extract(payload_json,'$.chatId')=? LIMIT 1")
    .get(scope.environment, scope.userId, turn.chatId) as Row | undefined;
  if (previous && previous.userSeq >= turn.userSeq) throw new Error("HOME_TURN_ORDER_CHANGED");
  const { assistantSeq, ...identity } = turn;
  const job = homeJobSchema.parse({ id, ...identity, throughSeq: assistantSeq, incarnationId: row.incarnation_id,
    sourceDeviceId: deviceId, snapshotId: hashChatContent([scope, id, "home"]),
    expectedSnapshotId: previous ? previous.snapshotId : head?.homeSnapshotId ?? (initial ? hashChatContent([scope, initial.id, "home"]) : null) });
  const source = enqueueSource(db, { id, scope, chatId: turn.chatId, entityId: job.snapshotId, entityKind: "home-snapshot", kind: "terminal-home",
    revision: turn.assistantSeq, payload: job, now });
  preserveRecoveryHomeJob(db, scope, job, source, now);
  if (!head || head.ownerDeviceId === deviceId) {
    releaseRoot(db, rootId); retainSource(db, { chatId: turn.chatId, scope, kind: "home-tail", revision: turn.assistantSeq, payload: job, rootId, now });
  }
  return job;
}
const tailRoot = (scope: SyncScope, chatId: string) => `home-tail:${hashChatContent([scope, chatId])}`;
const skipRoot = (scope: SyncScope, chatId: string) => `home-skipped:${hashChatContent([scope, chatId])}`;
function readTail(db: SqliteDatabase, rootId: string) {
  const marker = db.prepare("SELECT s.source_id,s.digest FROM chat_retention_roots r JOIN chat_retained_sources s ON s.source_id=r.source_id WHERE r.root_id=? AND s.kind='home-tail'").get(rootId) as Row | undefined;
  return marker ? homeTailSchema.parse(readRetainedSource(db, { sourceId: String(marker.source_id), digest: String(marker.digest) })) : null;
}
/* F-14: only a job of the named Chat without a frozen manifest can be skipped. The publisher never begins a snapshot without one, so the server has not
   seen it, and the capture fence means no later job of this Chat exists yet. Rolling the tail back keeps the next job's expected snapshot
   equal to what the server holds. */
export function skipHomeJob(db: SqliteDatabase, scope: SyncScope, id: string, payloadDigest: string, chatId: string, now: number) {
  const item = db.prepare("SELECT * FROM cloud_outbox WHERE id=? AND environment=? AND user_id=?").get(id, scope.environment, scope.userId) as Row | undefined;
  if (!item || item.payload_digest !== payloadDigest) throw new Error("OUTBOX_IDENTITY_MISMATCH");
  if (item.entity_kind !== "home-snapshot") throw new Error("HOME_JOB_UNAVAILABLE");
  const job = homeJobSchema.parse(readRetainedSource(db, JSON.parse(String(item.payload_json)).sources[0]));
  if (job.chatId !== chatId) throw new Error("HOME_JOB_UNAVAILABLE");
  if (readCheckpoint(db, scope, id, "home-manifest")) throw new Error("HOME_SKIP_AFTER_CAPTURE");
  const later = db.prepare(`SELECT 1 FROM cloud_outbox WHERE environment=? AND user_id=? AND entity_kind='home-snapshot' AND id<>?
    AND json_extract(payload_json,'$.chatId')=? AND seq_or_revision>? LIMIT 1`).get(scope.environment, scope.userId, id, job.chatId, Number(item.seq_or_revision));
  if (later) throw new Error("HOME_SKIP_NOT_LATEST");
  const rootId = tailRoot(scope, job.chatId);
  if (readTail(db, rootId)?.id === job.id) {
    releaseRoot(db, rootId);
    retainSource(db, { chatId: job.chatId, scope, kind: "home-tail", revision: job.throughSeq, payload: { ...job, snapshotId: job.expectedSnapshotId }, rootId, now });
  }
  retainSource(db, { chatId: job.chatId, scope, kind: "home-skipped", revision: job.userSeq, rootId: skipRoot(scope, job.chatId), now,
    payload: { jobId: job.id, chatId: job.chatId, userMessageId: job.userMessageId, userSeq: job.userSeq, skippedAt: now } });
  db.prepare("DELETE FROM cloud_outbox WHERE id=?").run(id);
  releaseRoot(db, `outbox:${id}`);
  return { id };
}
export function homeJobSkipped(db: SqliteDatabase, scope: SyncScope, chatId: string, jobId: string) {
  return Boolean(db.prepare(`SELECT 1 FROM chat_retained_sources s WHERE s.chat_id=? AND s.environment=? AND s.user_id=? AND s.kind='home-skipped'
    AND json_extract(s.payload_json,'$.jobId')=? AND EXISTS(SELECT 1 FROM chat_retention_roots r WHERE r.source_id=s.source_id) LIMIT 1`).get(chatId, scope.environment, scope.userId, jobId));
}
export function assertHomeCaptured(db: SqliteDatabase, chatId: string) {
  if (db.prepare(`SELECT 1 FROM cloud_outbox o WHERE o.entity_kind='home-snapshot' AND json_extract(o.payload_json,'$.chatId')=?
    AND NOT EXISTS(SELECT 1 FROM cloud_outbox_checkpoints c WHERE c.outbox_id=o.id AND c.checkpoint_key='home-manifest') LIMIT 1`).get(chatId)) throw new Error("HOME_SNAPSHOT_CAPTURE_PENDING");
}
