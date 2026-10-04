/**
 * [INPUT]: Depends on scoped outbox rows, retained deletion sources and exact receipt validation.
 * [OUTPUT]: Rejects unrelated acknowledgements before a permanent deletion leaves the existing outbox.
 * [POS]: SQLite deletion checkpoint guard; retained archive custody remains independent of delivery.
 */
import type { SqliteDatabase } from "../../connection";
import type { Row } from "../../repository/codec";
import type { ChatDeliveryCheckpoint } from "../delivery/contracts";
import { readRetainedSource } from "../inventory/source";
import { assertDeletionReceipt, chatDeletionOperation } from "./model";
export function validateDeletionCheckpoint(db: SqliteDatabase, item: Row, checkpoint: ChatDeliveryCheckpoint) {
  if (checkpoint.kind !== "deletion-receipt") return;
  if (item.kind !== "delete-chat" || item.entity_kind !== "tombstone") throw new Error("DELETION_OUTBOX_REQUIRED");
  const manifest = JSON.parse(String(item.payload_json));
  const operation = chatDeletionOperation(String(item.id), String(manifest.chatId), readRetainedSource(db, manifest.sources[0]));
  assertDeletionReceipt(operation, checkpoint.receipt);
}
