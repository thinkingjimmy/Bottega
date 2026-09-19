/**
 * [INPUT]: Depends on immutable retained business payloads and exact option receipt identities.
 * [OUTPUT]: Validates option acknowledgements without replacing their original execution baseline.
 * [POS]: Worker checkpoint guard shared by explicit retirement and turn settlement.
 */
import { validateEncryptedOptions } from "@ai-chat/cloud-protocol/chats/encrypted/options";
import { chatOptionsOperationSchema, hashChatOptionsOperation, chatOptionsReceiptSchema } from "@ai-chat/cloud-protocol/chats/options-sync";
import type { SqliteDatabase } from "../../../connection";
import type { Row } from "../../../repository/codec";
import { readRetainedSource } from "../../inventory/source";
import type { ChatDeliveryCheckpoint } from "../contracts";
export function validateOptionsCheckpoint(db: SqliteDatabase, item: Row, checkpoint: ChatDeliveryCheckpoint) {
  if (checkpoint.kind !== "options-receipt" && checkpoint.kind !== "encrypted-chat-options") return;
  const source = readRetainedSource(db, JSON.parse(String(item.payload_json)).sources[0]) as { optionsOperation?: unknown };
  const operation = chatOptionsOperationSchema.parse(source.optionsOperation);
  if (checkpoint.kind === "encrypted-chat-options") {
    const wire = validateEncryptedOptions(checkpoint.encryptedSpace.scope, checkpoint.transport);
    if (operation.payloadHash !== checkpoint.plaintextHash || hashChatOptionsOperation(operation) !== checkpoint.plaintextHash ||
      operation.operationId !== wire.operationId || operation.chatId !== wire.chatId || operation.incarnationId !== wire.incarnationId ||
      operation.executionEpoch !== wire.executionEpoch || operation.agentRevision !== wire.agentRevision || operation.afterUserSeq !== wire.afterUserSeq ||
      operation.options.backend !== wire.backend) throw new Error("OPTIONS_CIPHER_IDENTITY_MISMATCH");
    return;
  }
  const receipt = checkpoint.receipt;
  if (hashChatOptionsOperation(operation) !== operation.payloadHash || operation.operationId !== receipt.operationId ||
    operation.payloadHash !== receipt.payloadHash || operation.chatId !== receipt.chatId) throw new Error("OPTIONS_RECEIPT_IDENTITY_MISMATCH");
}
export function optionsConfirmed(db: SqliteDatabase, item: Row, source: { optionsOperation?: unknown }) {
  if (!source.optionsOperation) return true;
  const row = db.prepare(`SELECT s.source_id,s.digest FROM cloud_outbox_checkpoints c JOIN chat_retained_sources s ON s.source_id=c.source_id
    WHERE c.outbox_id=? AND c.checkpoint_key='options-receipt'`).get(String(item.id)) as Row | undefined;
  if (!row) return false;
  const checkpoint = readRetainedSource(db, { sourceId: String(row.source_id), digest: String(row.digest) }) as { receipt?: unknown };
  const receipt = chatOptionsReceiptSchema.parse(checkpoint.receipt);
  return ["applied", "converged", "superseded"].includes(receipt.status);
}
