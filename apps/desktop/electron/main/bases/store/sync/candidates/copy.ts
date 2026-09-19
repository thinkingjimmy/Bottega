/**
 * [INPUT]: Depends on the original Store queue, digest-bound generation files, candidate plan and attachment custody.
 * [OUTPUT]: Publishes an independently identified recovery Base and returns the original target after an interrupted response.
 * [POS]: BaseStore copy leaf; its destination metadata is the commit point, and source tombstones remain untouched.
 */
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { isBaseAttachmentValue } from "../../../../../../shared/bases-ipc";
import { readBlobMetadata, verifyBlob } from "../../../../persistence/logical-blob";
import { canonicalJson } from "../../../../../../shared/local-storage/contracts";
import { storedBase, validateBaseShape, validateStoredRows, type StoredBase } from "../../../base-store-model";
import { emptyBaseSync, type BaseSyncEnvelope } from "../model";
import { serializeSync, syncPath } from "../files";
import { emptyGalleryLedger } from "../../gallery-ledger";
import { emptyHistoryLedger } from "../../history-ledger";
import { ownerFileStem, type BaseStoreFiles } from "../../base-files";
import type { BaseAttachmentStore } from "../../attachments";
import { copyCandidateSnapshot, type BaseCandidateCopyPlan } from "./copy-model";
export async function publishCandidateCopy(ports: { states: Map<string, StoredBase>; files: BaseStoreFiles; attachments: BaseAttachmentStore }, plan: BaseCandidateCopyPlan) {
  const ownerKey = `project:${plan.projectId}`, existing = ports.states.get(ownerKey);
  if (existing) {
    if (existing.meta.ownerInstanceId !== plan.baseId || canonicalJson(existing.sync.recoveredFrom) !== canonicalJson(plan.provenance)) throw new Error("BASE_CANDIDATE_COPY_TARGET_CHANGED");
    if (existing.sync.tombstones.includes("base")) throw new Error("BASE_CANDIDATE_COPY_WAS_DELETED");
    return { meta: existing.meta, rows: existing.rows };
  }
  if (await ports.files.readMetaIfPresent(ownerKey)) throw new Error("BASE_CANDIDATE_COPY_REOPEN_REQUIRED");
  if (plan.candidate.copiedTo) throw new Error("BASE_CANDIDATE_COPY_WAS_DELETED");
  const snapshot = copyCandidateSnapshot(plan), sync: BaseSyncEnvelope = { ...emptyBaseSync(plan.baseId), recoveredFrom: plan.provenance };
  validateBaseShape(snapshot.meta, snapshot.rows.length); validateStoredRows(snapshot.rows, new Set(snapshot.meta.columns.map(column => column.id)));
  const encoded = serializeSync(sync), meta = { ...snapshot.meta, syncHash: encoded.hash };
  const gallery = emptyGalleryLedger(ownerFileStem(ownerKey), plan.baseId), history = emptyHistoryLedger();
  const { files, attachments } = ports;
  const rowsText = files.serializeRows(snapshot.rows), metaText = files.serializeMeta(meta);
  const images = new Map(snapshot.rows.flatMap(row => Object.values(row.values)).filter(isBaseAttachmentValue).map(value => [value.blobId, value]));
  for (const image of images.values()) {
    const path = join(attachments.familyPath(ownerFileStem(plan.provenance.ownerKey), plan.provenance.baseId), image.blobId);
    const metadata = await readBlobMetadata(path, `${ownerFileStem(plan.provenance.ownerKey)}:${plan.provenance.baseId}`);
    if (metadata.blobId !== image.blobId || metadata.bytes !== image.byteLength || metadata.mime !== image.mediaType) throw new Error("BASE_CANDIDATE_COPY_IMAGE_CHANGED");
    const bytes = await readFile(path); verifyBlob(bytes, metadata);
    // The ordinary attachment writer reserves capacity and atomically renames complete bytes before its sidecar.
    await attachments.put({ chatId: ownerFileStem(ownerKey), incarnationId: plan.baseId, filename: image.filename, bytes,
      sourceRevision: image.revision, ...(image.localAvailability ? { localAvailability: image.localAvailability } : {}) });
  }
  await files.atomicWrite(files.rowsPath(ownerKey, 0), rowsText);
  await files.atomicWrite(files.galleryPath(ownerKey, 0), files.serializeGallery(gallery));
  await files.atomicWrite(files.historyPath(ownerKey, 0), files.serializeHistory(history));
  await files.atomicWrite(syncPath(files.syncRoot, ownerKey, 0), encoded.content);
  await files.atomicWrite(files.metaPath(ownerKey), metaText);
  const state = storedBase({ meta, rows: snapshot.rows, gallery, history, sync });
  ports.states.set(ownerKey, state); return { meta: state.meta, rows: state.rows };
}
