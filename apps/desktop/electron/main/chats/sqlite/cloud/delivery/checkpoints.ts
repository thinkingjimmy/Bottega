/**
 * [INPUT]: Depends on the sole SQLite connection, scoped outbox rows and immutable source retention.
 * [OUTPUT]: Validates immutable delivery checkpoints and predecessor-bound incomplete-initialization recovery claims.
 * [POS]: Outbox detail persistence; acknowledgement releases its sources with the owning outbox root.
 */
import { validateInitialEncryptionCheckpoint } from "./encryption/initial";
import { validateImportedEncryptionCheckpoint } from "./encryption/imported";
import { validateEncryptionCheckpoint } from "./encryption/checkpoints";
import { validateHomeEncryptionCheckpoint } from "./home";
import { verifyFrozenClassification } from "@ai-chat/cloud-protocol/chats/encrypted/classification/client";
import { chatClassificationOperationSchema } from "@ai-chat/cloud-protocol/chats/classification";
import { canonicalJson, type SyncScope } from "../../../../../../shared/local-storage/contracts";
import { hashChatContent } from "@ai-chat/cloud-protocol/chats/transcript/body";
import { hashChatMetadataOperation } from "@ai-chat/cloud-protocol/chats/metadata";
import { importedEntryHash } from "@ai-chat/cloud-protocol/chats/imported/model";
import type { SqliteDatabase } from "../../connection";
import { digest, type Row } from "../../repository/codec";
import { retainSource } from "../retention";
import { chatDeliveryCheckpointSchema, checkpointKey, type ChatDeliveryCheckpoint } from "./contracts";
import { validateMetadataOperation } from "./metadata-confirm";
import { validateTurnCheckpoint } from "./turns/checkpoints";
import { validateTurnEncryptionCheckpoint } from "./turns/encryption";
import { validateHomeCheckpoint } from "../home/checkpoints";
import { validateOptionsCheckpoint } from "./options/checkpoints";
import { validateDeletionCheckpoint } from "../deletion/checkpoints";
import { settleDeletedInitialization } from "../deletion/markers";
import { recordDeletionResult } from "../deletion/intent";

export function requireOutbox(db: SqliteDatabase, scope: SyncScope, id: string, payloadDigest?: string) {
  const item = db.prepare("SELECT * FROM cloud_outbox WHERE id=? AND environment=? AND user_id=?")
    .get(id, scope.environment, scope.userId) as Row | undefined;
  if (!item || payloadDigest !== undefined && item.payload_digest !== payloadDigest) throw new Error("OUTBOX_IDENTITY_MISMATCH");
  return item;
}
export function readCheckpoint(db: SqliteDatabase, scope: SyncScope, id: string, key: string) {
  requireOutbox(db, scope, id);
  const row = db.prepare("SELECT source_id,digest FROM cloud_outbox_checkpoints WHERE outbox_id=? AND checkpoint_key=?")
    .get(id, key) as Row | undefined;
  return row ? { sourceId: String(row.source_id), digest: String(row.digest) } : null;
}
export function saveCheckpoint(db: SqliteDatabase, scope: SyncScope, id: string, payloadDigest: string,
  checkpoint: ChatDeliveryCheckpoint, now: number, confirmed: (item: Row, receipt: Extract<ChatDeliveryCheckpoint, { kind: "metadata-receipt" }>["receipt"]) => void) {
  const item = requireOutbox(db, scope, id, payloadDigest);
  const chatId = String((JSON.parse(String(item.payload_json)) as { chatId: string }).chatId);
  if ((checkpoint.kind === "native-recovery" || checkpoint.kind === "native-recovery-head") && (item.kind !== "initialize" || checkpoint.head.chat.id !== chatId)) throw new Error("CHECKPOINT_CHAT_MISMATCH");
  if (checkpoint.kind === "native-body" && hashChatContent(checkpoint.body) !== checkpoint.bodyHash) throw new Error("BODY_HASH_MISMATCH");
  if (checkpoint.kind === "body-storage" && (checkpoint.storage.kind === "inline" ? hashChatContent(checkpoint.storage.body) : checkpoint.storage.blob.sha256) !== checkpoint.bodyHash) throw new Error("BODY_STORAGE_HASH_MISMATCH");
  if (checkpoint.kind === "metadata-operation" && (checkpoint.operation.chatId !== chatId || hashChatMetadataOperation(checkpoint.operation) !== checkpoint.operation.payloadHash)) throw new Error("METADATA_OPERATION_MISMATCH");
  if (checkpoint.kind === "metadata-operation") validateMetadataOperation(item, checkpoint);
  if (checkpoint.kind === "metadata-receipt" && checkpoint.receipt.chatId !== chatId ||
    (checkpoint.kind === "native-manifest" || checkpoint.kind === "native-complete") && checkpoint.manifest.chatId !== chatId ||
    checkpoint.kind === "native-page" && checkpoint.receipt.chatId !== chatId) throw new Error("CHECKPOINT_CHAT_MISMATCH");
  const content = canonicalJson(checkpoint);
  if (Buffer.byteLength(content) > 3 * 1024 * 1024) throw new Error("OUTBOX_CHECKPOINT_BUDGET");
  const key = checkpointKey(checkpoint), hash = digest(content), prior = readCheckpoint(db, scope, id, key);
  if (prior) {
    if (prior.digest !== hash) throw new Error("OUTBOX_CHECKPOINT_CHANGED");
    return prior;
  }
  validateTurnCheckpoint(db, scope, id, chatId, checkpoint);
  validateOptionsCheckpoint(db, item, checkpoint);
  validateDeletionCheckpoint(db, item, checkpoint);
  validateHomeCheckpoint(db, scope, item, checkpoint);
  const priorValue = (key: string) => {
    const reference = readCheckpoint(db, scope, id, key);
    if (!reference) throw new Error("OUTBOX_CHECKPOINT_PREDECESSOR_REQUIRED");
    const source = db.prepare("SELECT payload_json FROM chat_retained_sources WHERE source_id=? AND digest=?").get(reference.sourceId, reference.digest) as Row | undefined;
    if (!source || digest(String(source.payload_json)) !== reference.digest) throw new Error("OUTBOX_CHECKPOINT_SOURCE_CORRUPT");
    return chatDeliveryCheckpointSchema.parse(JSON.parse(String(source.payload_json)));
  };
  validateEncryptionCheckpoint(checkpoint, chatId, scope.userId, priorValue);
  validateTurnEncryptionCheckpoint(checkpoint, chatId, priorValue);
  validateImportedEncryptionCheckpoint(checkpoint, chatId, scope.userId, priorValue);
  validateInitialEncryptionCheckpoint(db, id, chatId, checkpoint, priorValue);
  validateHomeEncryptionCheckpoint(checkpoint, chatId, priorValue);
  if (checkpoint.kind === "encrypted-chat-classification") {
    const candidate = db.prepare("SELECT operation_json FROM chat_classification_candidates WHERE operation_id=? AND chat_id=? AND environment=? AND user_id=?")
      .get(checkpoint.transport.lifecycleOperationId, chatId, scope.environment, scope.userId) as Row | undefined;
    if (item.kind !== "classification" || item.id !== checkpoint.transport.lifecycleOperationId || !candidate?.operation_json) throw new Error("CLASSIFICATION_CIPHER_SOURCE_REQUIRED");
    verifyFrozenClassification(checkpoint, chatClassificationOperationSchema.parse(JSON.parse(String(candidate.operation_json))));
  }
  if (checkpoint.kind === "native-recovery-head") {
    const basis = priorValue("native-recovery");
    if (basis.kind !== "native-recovery" || basis.head.chat.incarnationId !== checkpoint.head.chat.incarnationId) throw new Error("NATIVE_RECOVERY_HEAD_CHANGED");
  }
  if (checkpoint.kind === "metadata-receipt") {
    const predecessor = priorValue("metadata-operation"), receipt = checkpoint.receipt;
    if (predecessor.kind !== "metadata-operation" || predecessor.operation.operationId !== receipt.operationId || predecessor.operation.payloadHash !== receipt.payloadHash) throw new Error("METADATA_RECEIPT_IDENTITY_MISMATCH");
  }
  if (checkpoint.kind === "native-complete") {
    const predecessor = priorValue("native-manifest");
    if (predecessor.kind !== "native-manifest" || canonicalJson(predecessor.manifest) !== canonicalJson(checkpoint.manifest)) throw new Error("NATIVE_MANIFEST_CHANGED");
    if (checkpoint.manifest.messageCount > 0 && !db.prepare(`SELECT 1 FROM cloud_outbox_checkpoints c
      JOIN chat_retained_sources s ON s.source_id=c.source_id WHERE c.outbox_id=? AND c.checkpoint_key LIKE 'page:%'
      AND json_extract(s.payload_json,'$.receipt.state')='ready'
      AND json_extract(s.payload_json,'$.receipt.manifestId')=?
      AND json_extract(s.payload_json,'$.receipt.receivedCount')=? LIMIT 1`)
      .get(id, checkpoint.manifest.manifestId, checkpoint.manifest.messageCount)) throw new Error("NATIVE_FINAL_RECEIPT_REQUIRED");
  }
  if (checkpoint.kind === "home-page" && checkpoint.receipt.chatId !== chatId ||
    checkpoint.kind === "home-complete" && checkpoint.status.manifest.chatId !== chatId) throw new Error("CHECKPOINT_CHAT_MISMATCH");
  if (checkpoint.kind === "home-complete") {
    const source = priorValue("home-manifest");
    const manifest = source.kind === "home-manifest" ? source.manifest : null;
    if (!manifest || canonicalJson(manifest) !== canonicalJson(checkpoint.status.manifest) ||
      checkpoint.status.receivedCount !== manifest.entryCount || checkpoint.status.receivedDigest !== manifest.digest) throw new Error("HOME_MANIFEST_CHANGED");
  }
  if (checkpoint.kind === "import-entry" && checkpoint.entry.entryVersionId !== importedEntryHash(checkpoint.entry)) throw new Error("IMPORT_ENTRY_HASH_MISMATCH");
  if (checkpoint.kind === "import-manifest" && checkpoint.manifest.chatId !== chatId ||
    checkpoint.kind === "import-page" && checkpoint.receipt.chatId !== chatId ||
    checkpoint.kind === "import-complete" && checkpoint.status.manifest.chatId !== chatId) throw new Error("CHECKPOINT_CHAT_MISMATCH");
  if (checkpoint.kind === "import-complete") {
    const manifest = priorValue("import-manifest");
    if (manifest.kind !== "import-manifest" || canonicalJson(manifest.manifest) !== canonicalJson(checkpoint.status.manifest) ||
      checkpoint.status.receivedCount !== manifest.manifest.entryCount || checkpoint.status.receivedDigest !== manifest.manifest.digest) throw new Error("IMPORT_MANIFEST_CHANGED");
  }
  const source = retainSource(db, { chatId, kind: `delivery:${key}`, revision: Number(item.seq_or_revision),
    payload: checkpoint, scope, rootId: `outbox:${id}`, now });
  db.prepare("INSERT INTO cloud_outbox_checkpoints(outbox_id,checkpoint_key,source_id,digest) VALUES(?,?,?,?)")
    .run(id, key, source.sourceId, source.digest);
  if (checkpoint.kind === "metadata-receipt") confirmed(item, checkpoint.receipt);
  if (checkpoint.kind === "deletion-receipt") {
    recordDeletionResult(db, scope, item, checkpoint.receipt, now);
    if (checkpoint.receipt.status !== "conflicted") settleDeletedInitialization(db, scope, checkpoint.receipt.tombstone, now);
  }
  return source;
}
