/**
 * [INPUT]: Depends on confirmed Chat identity, the preceding Home tail marker and existing outbox/source retention.
 * [OUTPUT]: Creates immutable terminal Home jobs and preserves causal predecessors; nothing supersedes a job, so none is ever retired.
 * [POS]: Worker-only Home scheduling; snapshot bytes are copied by the main process before later local writes.
 */
import { hashChatContent } from "@ai-chat/cloud-protocol/chats/transcript/body";
import type { SyncScope } from "../../../../../../shared/local-storage/contracts";
import type { SqliteDatabase } from "../../connection";
import type { Row } from "../../repository/codec";
import { enqueueSource, releaseRoot, retainSource } from "../retention";
import { readRetainedSource } from "../inventory/source";
import { readMetadataState } from "../delivery/metadata-confirm";
import { homeJobSchema, type HomeTurn, type HomeJob } from "./contracts";
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
  const rootId = `home-tail:${hashChatContent([scope, turn.chatId])}`;
  const marker = db.prepare("SELECT s.source_id,s.digest FROM chat_retention_roots r JOIN chat_retained_sources s ON s.source_id=r.source_id WHERE r.root_id=? AND s.kind='home-tail'").get(rootId) as Row | undefined;
  const previous = marker ? homeJobSchema.parse(readRetainedSource(db, { sourceId: String(marker.source_id), digest: String(marker.digest) })) : null;
  if (previous?.id === id) return sameTurn(previous, turn);
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
export function assertHomeCaptured(db: SqliteDatabase, chatId: string) {
  if (db.prepare(`SELECT 1 FROM cloud_outbox o WHERE o.entity_kind='home-snapshot' AND json_extract(o.payload_json,'$.chatId')=?
    AND NOT EXISTS(SELECT 1 FROM cloud_outbox_checkpoints c WHERE c.outbox_id=o.id AND c.checkpoint_key='home-manifest') LIMIT 1`).get(chatId)) throw new Error("HOME_SNAPSHOT_CAPTURE_PENDING");
}
