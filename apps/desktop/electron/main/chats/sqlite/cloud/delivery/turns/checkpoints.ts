/**
 * [INPUT]: Depends on scoped existing outbox rows and immutable checkpoint source hashes.
 * [OUTPUT]: Validates contiguous local turn chunks and reads their durable high sequence.
 * [POS]: SQLite delivery leaf; checkpoint rows remain subordinate to the original outbox item.
 */
import type { SyncScope } from "../../../../../../../shared/local-storage/contracts";
import type { SqliteDatabase } from "../../../connection";
import { requireOutbox } from "../checkpoints";
import { hashTurnChunk } from "@ai-chat/cloud-protocol/turns/live";
import type { ChatDeliveryCheckpoint } from "../contracts";
export function turnDeliveryProgress(db: SqliteDatabase, scope: SyncScope, id: string) {
  requireOutbox(db, scope, id);
  const result = db.prepare("SELECT COALESCE(MAX(CAST(SUBSTR(checkpoint_key,12) AS INTEGER)),0) highSeq FROM cloud_outbox_checkpoints WHERE outbox_id=? AND checkpoint_key LIKE 'turn-chunk:%'")
    .get(id) as { highSeq: number };
  return { highSeq: result.highSeq };
}
export function validateTurnCheckpoint(db: SqliteDatabase, scope: SyncScope, id: string, chatId: string, checkpoint: ChatDeliveryCheckpoint) {
  if (checkpoint.kind === "turn-chunk") {
    if (checkpoint.chunk.payloadHash !== hashTurnChunk(checkpoint.chunk) || checkpoint.chunk.seq !== turnDeliveryProgress(db, scope, id).highSeq + 1) throw new Error("TURN_CHUNK_SEQUENCE_CONFLICT");
  }
  const identity = checkpoint.kind === "turn-start" ? checkpoint.start : checkpoint.kind === "turn-final" ? checkpoint.final : checkpoint.kind === "turn-settled" ? checkpoint.receipt : null;
  if (identity && identity.chatId !== chatId) throw new Error("CHECKPOINT_CHAT_MISMATCH");
}
