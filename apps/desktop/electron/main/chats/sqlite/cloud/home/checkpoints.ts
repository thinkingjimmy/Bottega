/**
 * [INPUT]: Depends on immutable Home entry pages and original outbox source identities.
 * [OUTPUT]: Validates a complete local manifest and its exact terminal-job predecessor before publication.
 * [POS]: Worker Home proof; large inventories use bounded checkpoint pages rather than one IPC payload.
 */
import { canonicalJson, type SyncScope } from "../../../../../../shared/local-storage/contracts";
import type { SqliteDatabase } from "../../connection";
import type { Row } from "../../repository/codec";
import { EMPTY_HOME_DIGEST, extendHomeDigest } from "@ai-chat/cloud-protocol/chats/home/model";
import type { ChatDeliveryCheckpoint } from "../delivery/contracts";
import { readRetainedSource } from "../inventory/source";
import { homeJobSchema } from "./contracts";
export function validateHomeCheckpoint(db: SqliteDatabase, _scope: SyncScope, item: Row, checkpoint: ChatDeliveryCheckpoint) {
  if (checkpoint.kind !== "home-manifest") return;
  const manifest = checkpoint.manifest;
  if (manifest.chatId !== JSON.parse(String(item.payload_json)).chatId) throw new Error("CHECKPOINT_CHAT_MISMATCH");
  if (item.entity_kind === "home-snapshot") {
    const job = homeJobSchema.parse(readRetainedSource(db, JSON.parse(String(item.payload_json)).sources[0]));
    for (const key of ["chatId", "incarnationId", "executionEpoch", "snapshotId", "expectedSnapshotId", "throughSeq"] as const) {
      if (canonicalJson(manifest[key]) !== canonicalJson(job[key])) throw new Error("HOME_JOB_IDENTITY_CHANGED");
    }
  }
  let digest = EMPTY_HOME_DIGEST, count = 0, bytes = 0, omitted = 0, lastPath = "";
  for (let offset = 0; offset < manifest.entryCount; offset += 50) {
    const row = db.prepare("SELECT s.source_id,s.digest FROM cloud_outbox_checkpoints c JOIN chat_retained_sources s ON s.source_id=c.source_id WHERE c.outbox_id=? AND c.checkpoint_key=?")
      .get(String(item.id), `home-entries:${offset}`) as Row | undefined;
    if (!row) throw new Error("HOME_ENTRY_PAGE_MISSING");
    const page = readRetainedSource(db, { sourceId: String(row.source_id), digest: String(row.digest) }) as Extract<ChatDeliveryCheckpoint, { kind: "home-entries" }>;
    if (page.kind !== "home-entries" || page.offset !== offset || page.entries.length !== Math.min(50, manifest.entryCount - offset)) throw new Error("HOME_ENTRY_PAGE_INVALID");
    for (const entry of page.entries) {
      if (entry.path <= lastPath) throw new Error("HOME_ENTRY_ORDER_INVALID");
      digest = extendHomeDigest(digest, entry); count++; lastPath = entry.path;
      if (entry.kind === "file") bytes += entry.blob.bytes; else omitted++;
    }
  }
  if (manifest.digest !== digest || manifest.entryCount !== count || manifest.bytes !== bytes || manifest.omittedCount !== omitted) throw new Error("HOME_MANIFEST_CHANGED");
}
