/**
 * [INPUT]: Depends on proven original turn epochs, confirmed Chat identity and existing outbox/source retention.
 * [OUTPUT]: Creates immutable terminal Home jobs, preserves causal predecessors and archives superseded file custody.
 * [POS]: Worker-only Home scheduling; snapshot bytes are copied by the main process before later local writes.
 */
import { hashChatContent } from "@ai-chat/cloud-protocol/chats/transcript/body";
import type { SyncScope } from "../../../../../../shared/local-storage/contracts";
import type { SqliteDatabase } from "../../connection";
import type { Row } from "../../repository/codec";
import { enqueueSource, releaseRoot, retainSource } from "../retention";
import { readRetainedSource } from "../inventory/source";
import { requireOutbox } from "../delivery/checkpoints";
import { readMetadataState } from "../delivery/metadata-confirm";
import { originalExecutionEpoch } from "../execution/origin";
import { homeJobSchema, type HomeTurn, type HomeJob } from "./contracts";
import { preserveRecoveryHomeJob, retainHomeArchive } from "../recovery/home";
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
  const rootId = `home-tail:${hashChatContent([scope, turn.chatId])}`;
  const marker = db.prepare("SELECT s.source_id,s.digest FROM chat_retention_roots r JOIN chat_retained_sources s ON s.source_id=r.source_id WHERE r.root_id=? AND s.kind='home-tail'").get(rootId) as Row | undefined;
  const previous = marker ? homeJobSchema.parse(readRetainedSource(db, { sourceId: String(marker.source_id), digest: String(marker.digest) })) : null;
  if (previous?.id === id) return sameTurn(previous, turn);
  const epoch = originalExecutionEpoch(db, scope, turn.chatId, turn.turnId, turn.userSeq, turn.userMessageId);
  if (!epoch) throw new Error("HOME_ORIGINAL_EXECUTION_UNAVAILABLE");
  const head = readMetadataState(db, scope, turn.chatId).head;
  const initial = db.prepare("SELECT id FROM cloud_outbox WHERE environment=? AND user_id=? AND kind='initialize' AND json_extract(payload_json,'$.chatId')=? LIMIT 1")
    .get(scope.environment, scope.userId, turn.chatId) as Row | undefined;
  if (previous?.executionEpoch === epoch && previous.userSeq >= turn.userSeq) throw new Error("HOME_TURN_ORDER_CHANGED");
  const { assistantSeq, ...identity } = turn;
  const job = homeJobSchema.parse({ id, ...identity, throughSeq: assistantSeq, incarnationId: row.incarnation_id,
    sourceDeviceId: deviceId, executionEpoch: epoch, snapshotId: hashChatContent([scope, id, "home"]),
    expectedSnapshotId: previous?.executionEpoch === epoch ? previous.snapshotId : head?.homeSnapshotId ?? (initial ? hashChatContent([scope, initial.id, "home"]) : null) });
  const source = enqueueSource(db, { id, scope, chatId: turn.chatId, entityId: job.snapshotId, entityKind: "home-snapshot", kind: "terminal-home",
    executionEpoch: epoch, revision: turn.assistantSeq, payload: job, now });
  preserveRecoveryHomeJob(db, scope, job, source, now);
  if (!head || head.executionEpoch === epoch && head.executorDeviceId === deviceId) {
    releaseRoot(db, rootId); retainSource(db, { chatId: turn.chatId, scope, kind: "home-tail", revision: turn.assistantSeq, payload: job, rootId, now });
  }
  return job;
}
export function assertHomeCaptured(db: SqliteDatabase, chatId: string) {
  if (db.prepare(`SELECT 1 FROM cloud_outbox o WHERE o.entity_kind='home-snapshot' AND json_extract(o.payload_json,'$.chatId')=?
    AND NOT EXISTS(SELECT 1 FROM cloud_outbox_checkpoints c WHERE c.outbox_id=o.id AND c.checkpoint_key='home-manifest') LIMIT 1`).get(chatId)) throw new Error("HOME_SNAPSHOT_CAPTURE_PENDING");
}
export function archiveHomeJob(db: SqliteDatabase, scope: SyncScope, id: string, payloadDigest: string, now: number) {
  const item = requireOutbox(db, scope, id, payloadDigest), source = JSON.parse(String(item.payload_json)).sources[0];
  if (item.entity_kind !== "home-snapshot") throw new Error("HOME_JOB_REQUIRED");
  if (!db.prepare("SELECT 1 FROM cloud_outbox_checkpoints WHERE outbox_id=? AND checkpoint_key='home-manifest'").get(id)) throw new Error("HOME_SNAPSHOT_CAPTURE_PENDING");
  const job = homeJobSchema.parse(readRetainedSource(db, source)), head = readMetadataState(db, scope, job.chatId).head;
  if (!head || head.executionEpoch <= job.executionEpoch) throw new Error("HOME_JOB_STILL_CURRENT");
  const rootId = `settlement:${job.chatId}:home:${id}`;
  retainHomeArchive(db, scope, job, source, rootId, now);
  db.prepare("DELETE FROM cloud_outbox WHERE id=?").run(id); releaseRoot(db, `outbox:${id}`); return { id };
}
