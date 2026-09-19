/**
 * [INPUT]: Depends on original turn receipts and immutable user/admission outbox sources.
 * [OUTPUT]: Resolves the producing execution epoch without substituting a later confirmed executor.
 * [POS]: Worker evidence lookup shared by late assistant capture and terminal Home snapshots.
 */
import type { SyncScope } from "../../../../../../shared/local-storage/contracts";
import type { SqliteDatabase } from "../../connection";
import type { Row } from "../../repository/codec";
import { readRetainedSource } from "../inventory/source";
export function originalExecutionEpoch(db: SqliteDatabase, scope: SyncScope, chatId: string, turnId: string | undefined, userSeq: number, userId?: string) {
  if (turnId) {
    const receipt = db.prepare("SELECT receipt_json FROM cloud_turn_receipts WHERE environment=? AND user_id=? AND chat_id=? AND turn_id=?")
      .get(scope.environment, scope.userId, chatId, turnId) as Row | undefined;
    if (receipt) { const value = JSON.parse(String(receipt.receipt_json));
      if (value.userSeq === userSeq && (!userId || value.userMessageId === userId)) return Number(value.executionEpoch); }
    const admission = db.prepare("SELECT payload_json,execution_epoch FROM cloud_outbox WHERE environment=? AND user_id=? AND entity_kind='turn' AND entity_id=? AND kind='live-turn' AND json_extract(payload_json,'$.chatId')=?")
      .get(scope.environment, scope.userId, turnId, chatId) as Row | undefined;
    if (admission) {
      const value = readRetainedSource(db, JSON.parse(String(admission.payload_json)).sources[0]) as { user: { id: string; seq: number } };
      if (value.user.seq === userSeq && (!userId || value.user.id === userId)) return Number(admission.execution_epoch);
    }
  }
  const candidates = db.prepare(`SELECT payload_json,execution_epoch,kind FROM cloud_outbox WHERE environment=? AND user_id=?
    AND entity_kind IN ('message','chat') AND json_extract(payload_json,'$.chatId')=? ORDER BY created_at,id`)
    .iterate(scope.environment, scope.userId, chatId) as Iterable<Row>;
  for (const row of candidates) {
    const reference = JSON.parse(String(row.payload_json)).sources[0], source = readRetainedSource(db, reference) as { message?: unknown; messages?: unknown[] };
    if ([source.message, ...(source.messages ?? [])].some(value => {
      const message = value as { role?: string; seq?: number; id?: string } | undefined;
      return message?.role === "user" && message.seq === userSeq && (!userId || message.id === userId);
    })) return Number(row.execution_epoch ?? 1);
  }
  return null;
}
