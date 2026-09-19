/**
 * [INPUT]: Depends on published Base metadata, original private synchronization envelopes and authenticated cloud snapshots.
 * [OUTPUT]: Describes missing generations or a departed owner and repairs a partial folder only after preserving its original files and pending operations.
 * [POS]: Incomplete Base recovery beneath the sole Store queue; it never presents missing rows as an empty editable Base.
 */
import { basename } from "node:path";
import { createHash } from "node:crypto";
import type { BaseMeta } from "../../../../../shared/bases-ipc";
import { canonicalJson, sameScope, type SyncScope } from "../../../../../shared/local-storage/contracts";
import { storedBase, validateStoredBase } from "../../base-store-model";
import { baseMetaSchema } from "../../../../../shared/bases-schema";
import { durableReplaceFile, isErrnoCode } from "../../../persistence/durable-json";
import type { BaseStoreFiles } from "../base-files";
import { galleryOwnerId } from "../base-files";
import { emptyGalleryLedger } from "../gallery-ledger";
import { emptyHistoryLedger } from "../history-ledger";
import { baseSyncEnvelopeSchema, emptyBaseSync, type BaseOperationReceipt, type ConfirmedBase } from "../sync/model";
import { readSync, serializeSync, syncPath } from "../sync/files";
import { reconcileBase } from "../sync/queue";
import { projectBase } from "../sync/projection";
/** "content" is a missing or unreadable generation; the other two keep readable content whose owner is gone. */
export type IncompleteBaseReason = "content" | "project-missing" | "owner-incarnation-changed";
export type IncompleteBase = { meta: BaseMeta | null; files: string[]; reason: IncompleteBaseReason };
export async function describeIncompleteBase(files: BaseStoreFiles, ownerKey: string): Promise<IncompleteBase> {
  const meta = await files.readMetaIfPresent(ownerKey).catch(() => null);
  if (!meta) return { meta, files: [basename(files.metaPath(ownerKey))], reason: "content" };
  const missing: string[] = [];
  for (const [path, read] of [[files.rowsPath(ownerKey, meta.rowsGeneration), () => files.readRows(meta)],
    [files.galleryPath(ownerKey, meta.galleryGeneration), () => files.readGallery(meta)],
    [files.historyPath(ownerKey, meta.historyGeneration), () => files.readHistory(meta)]] as const) {
    try { await read(); } catch { missing.push(basename(path)); }
  }
  return { meta, files: missing.length ? missing : [basename(files.metaPath(ownerKey))], reason: "content" };
}
export type BaseRepairProof = { scope: SyncScope; confirmed: ConfirmedBase; receipts: BaseOperationReceipt[]; tombstones: string[] };
export async function repairIncompleteBase(files: BaseStoreFiles, ownerKey: string, original: IncompleteBase, proof: BaseRepairProof, current: () => void) {
  current(); const prior = await files.readMetaIfPresent(ownerKey); current();
  if (!prior || !original.meta || canonicalJson(prior) !== canonicalJson(original.meta) || prior.ownerInstanceId !== proof.confirmed.meta.ownerInstanceId ||
    canonicalJson(prior.owner) !== canonicalJson(proof.confirmed.meta.owner)) throw new Error("BASE_FOLDER_REPAIR_CHANGED");
  const envelope = await readSync(files, files.root, prior); current();
  if (envelope.scope && !sameScope(envelope.scope, proof.scope)) throw new Error("BASE_SYNC_SCOPE_UNAVAILABLE");
  const sync = envelope.scope ? reconcileBase(envelope, proof.confirmed, proof.receipts, proof.tombstones, String(proof.confirmed.cloudRevision)) :
    baseSyncEnvelopeSchema.parse({ ...emptyBaseSync(prior.ownerInstanceId), cloudState: "mirror", scope: proof.scope, confirmed: proof.confirmed,
      tombstones: proof.tombstones, cursor: String(proof.confirmed.cloudRevision), detachedInitialCiphertexts: [
        ...envelope.detachedInitialCiphertexts ?? [], ...envelope.initialCiphertext ? [envelope.initialCiphertext] : []] });
  const projection = projectBase(sync), encoded = serializeSync(sync), revision = Math.max(Date.now(), prior.revision + 1);
  const meta = baseMetaSchema.parse({ ...projection.meta, revision, rowsGeneration: revision, galleryGeneration: revision,
    historyGeneration: revision, syncGeneration: Math.max(revision, (prior.syncGeneration ?? 0) + 1), syncHash: encoded.hash });
  const gallery = await files.readGallery(prior).catch(() => emptyGalleryLedger(galleryOwnerId(meta), meta.ownerInstanceId));
  const history = await files.readHistory(prior).catch(() => emptyHistoryLedger());
  validateStoredBase(meta, projection.rows, gallery, { meta: value => files.serializeMeta(value), rows: value => files.serializeRows(value), gallery: value => files.serializeGallery(value) });
  const backup = createHash("sha256").update(canonicalJson(prior)).digest("hex").slice(0, 24);
  for (const path of [files.metaPath(ownerKey), files.rowsPath(ownerKey, prior.rowsGeneration), files.galleryPath(ownerKey, prior.galleryGeneration), files.historyPath(ownerKey, prior.historyGeneration)]) {
    try { const content = await files.readBounded(path, 64 * 1024 * 1024); current(); await durableReplaceFile(`${path}.recovery-${backup}`, content); }
    catch (error) { if (!isErrnoCode(error, "ENOENT")) throw error; }
  }
  current(); await files.atomicWrite(files.rowsPath(ownerKey, revision), files.serializeRows(projection.rows));
  await files.atomicWrite(files.galleryPath(ownerKey, revision), files.serializeGallery(gallery));
  await files.atomicWrite(files.historyPath(ownerKey, revision), files.serializeHistory(history));
  await files.atomicWrite(syncPath(files.syncRoot, ownerKey, meta.syncGeneration!), encoded.content);
  current(); await files.atomicWrite(files.metaPath(ownerKey), files.serializeMeta(meta));
  return storedBase({ meta, rows: projection.rows, gallery, history, sync });
}
