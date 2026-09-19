/**
 * [INPUT]: Depends on the sole Chat SQLite connection, frozen source roots and validated delivery checkpoints.
 * [OUTPUT]: Completes one initial Chat only after native/imported/Home receipts and records durable manifest evidence.
 * [POS]: Initial synchronization commit; queue removal, completion proof and source release share one transaction.
 */
import { z } from "zod";
import { canonicalJson, type SyncScope } from "../../../../../../shared/local-storage/contracts";
import type { SqliteDatabase } from "../../connection";
import { digest, type Row } from "../../repository/codec";
import { readCheckpoint, requireOutbox } from "../delivery/checkpoints";
import { chatDeliveryCheckpointSchema, retainedSourceRefSchema } from "../delivery/contracts";
import { releaseRoot } from "../retention";
import { readRetainedSource as source } from "../inventory/source";
export function completeInitialChat(db: SqliteDatabase, scope: SyncScope, id: string, payloadDigest: string, now: number) {
  const item = requireOutbox(db, scope, id, payloadDigest); if (item.kind !== "initialize") throw new Error("INITIAL_OUTBOX_REQUIRED");
  const input = z.object({ version: z.literal(1), chatId: z.string(), sources: z.tuple([retainedSourceRefSchema]) }).strict().parse(JSON.parse(String(item.payload_json)));
  const snapshot = source(db, input.sources[0]) as { imported?: unknown };
  const read = (key: string) => { const reference = readCheckpoint(db, scope, id, key);
    if (!reference) throw new Error("INITIAL_COMPONENT_RECEIPT_REQUIRED"); return { reference, checkpoint: chatDeliveryCheckpointSchema.parse(source(db, reference)) }; };
  const metadata = read("metadata-receipt"), native = read("native-complete");
  if (metadata.checkpoint.kind !== "metadata-receipt" || metadata.checkpoint.receipt.status !== "applied" || !metadata.checkpoint.receipt.head ||
    native.checkpoint.kind !== "native-complete") throw new Error("INITIAL_COMPONENT_RECEIPT_REQUIRED");
  const head = metadata.checkpoint.receipt.head, proof: Record<string, string> = { source: input.sources[0].digest,
    metadata: metadata.reference.digest, native: native.reference.digest };
  if (snapshot.imported) {
    const imported = read("import-complete"); if (imported.checkpoint.kind !== "import-complete") throw new Error("INITIAL_COMPONENT_RECEIPT_REQUIRED");
    proof.imported = imported.reference.digest;
  }
  if (head.kind !== "external-readonly" && head.chat.classification.conversationKind === "ordinary") {
    const home = read("home-complete"); if (home.checkpoint.kind !== "home-complete") throw new Error("INITIAL_COMPONENT_RECEIPT_REQUIRED");
    proof.home = home.reference.digest;
    db.prepare("UPDATE chats SET cloud_home_snapshot_id=? WHERE id=? AND incarnation_id=? AND cloud_environment=? AND cloud_user_id=?")
      .run(home.checkpoint.status.manifest.snapshotId, input.chatId, head.chat.incarnationId, scope.environment, scope.userId);
  }
  const evidenceHash = digest(canonicalJson(proof));
  completeInitialEvidence(db, scope, input.chatId, input.sources[0].sourceId, evidenceHash, now);
  db.prepare("DELETE FROM cloud_outbox WHERE id=?").run(id); releaseRoot(db, `outbox:${id}`);
  return { chatId: input.chatId, evidenceHash };
}
export function completeInitialEvidence(db: SqliteDatabase, scope: SyncScope, chatId: string, sourceId: string, evidenceHash: string, now: number) {
  const state = db.prepare("SELECT initial_manifest_json FROM cloud_sync_state WHERE environment=? AND user_id=?").get(scope.environment, scope.userId) as Row;
  if (state.initial_manifest_json) {
    const manifest = JSON.parse(String(state.initial_manifest_json)) as { manifestId: string; state: string; entries: Array<{ chatId: string; sourceId: string; completionHash?: string }> };
    const entry = manifest.entries.find(entry => entry.chatId === chatId && entry.sourceId === sourceId);
    if (entry) {
      if (entry.completionHash && entry.completionHash !== evidenceHash) throw new Error("INITIAL_COMPLETION_CHANGED"); entry.completionHash = evidenceHash;
      if (manifest.entries.every(entry => entry.completionHash)) manifest.state = "complete";
      db.prepare("UPDATE cloud_sync_state SET initial_manifest_json=?,updated_at=? WHERE environment=? AND user_id=?")
        .run(canonicalJson(manifest), now, scope.environment, scope.userId);
      if (manifest.state === "complete") releaseRoot(db, `manifest:${manifest.manifestId}`);
    }
  }
}
