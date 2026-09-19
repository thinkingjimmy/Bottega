/**
 * [INPUT]: Depends on the existing Base Store queue ports, complete promotion generations and verified attachment custody.
 * [OUTPUT]: Preserves and revalidates an unpublished Base in its recovery Project before adopting a unique canonical remote owner identity.
 * [POS]: Initial identity convergence leaf; complete metadata is the commit point and no source file is deleted.
 */
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { canonicalJson } from "../../../../../../shared/local-storage/contracts";
import { baseMetaSchema } from "../../../../../../shared/bases-schema";
import { readBlobMetadata, verifyBlob } from "../../../../persistence/logical-blob";
import { storedBase, validateStoredBase, type StoredBase } from "../../../base-store-model";
import type { BaseAttachmentStore } from "../../attachments";
import { ownerFileStem, type BaseStoreFiles } from "../../base-files";
import { prepareProjectBase } from "../../promotion/generation";
import { emptyGalleryLedger } from "../../gallery-ledger";
import { emptyHistoryLedger } from "../../history-ledger";
import { baseSyncEnvelopeSchema, emptyBaseSync, type ConfirmedBase } from "../model";
import { serializeSync, syncPath } from "../files";
import type { InitialIdentityRecoveryPlan } from "./model";
import { logicalBaseSnapshot } from "@ai-chat/base-ui/metadata/logical-snapshot";
type Ports = { states: Map<string, StoredBase>; files: BaseStoreFiles; attachments: BaseAttachmentStore; block(ownerKey: string): void };
export async function recoverInitialIdentity(ports: Ports, source: StoredBase, plan: InitialIdentityRecoveryPlan, confirmed: ConfirmedBase | null, tombstones: string[]) {
  const { states, files, attachments } = ports, ownerKey = plan.provenance.ownerKey, targetKey = `project:${plan.projectId}`;
  for (const [key, state] of states) {
    if (key !== ownerKey && state.meta.ownerInstanceId === confirmed?.meta.ownerInstanceId) throw new Error("BASE_OWNER_TRANSFER_REQUIRED");
    if (key !== targetKey && state.meta.ownerInstanceId === plan.baseId) throw new Error("BASE_INITIAL_RECOVERY_TARGET_CHANGED");
  }
  const verifyImages = async () => {
    for (const blobId of source.attachmentBlobIds) {
      const sourcePath = join(attachments.familyPath(ownerFileStem(ownerKey), source.meta.ownerInstanceId), blobId);
      const copiedPath = join(attachments.familyPath(ownerFileStem(targetKey), plan.baseId), blobId);
      const original = await readBlobMetadata(sourcePath, `${ownerFileStem(ownerKey)}:${source.meta.ownerInstanceId}`);
      const copied = await readBlobMetadata(copiedPath, `${ownerFileStem(targetKey)}:${plan.baseId}`);
      if (canonicalJson(original) !== canonicalJson(copied)) throw new Error("BASE_INITIAL_RECOVERY_IMAGE_CHANGED");
      verifyBlob(await readFile(copiedPath), original);
    }
  };
  if (plan.copyNeeded) {
  const copy = states.get(targetKey);
  if (copy) {
    if (copy.meta.ownerInstanceId !== plan.baseId || canonicalJson(copy.sync.initialIdentityRecovery) !== canonicalJson(plan.provenance) ||
      copy.sync.tombstones.includes("base")) throw new Error("BASE_INITIAL_RECOVERY_TARGET_CHANGED");
    const expected = { meta: { ...source.meta, owner: { kind: "project" as const, projectId: plan.projectId }, ownerInstanceId: plan.baseId,
      name: plan.name, navigation: { kind: "project-contained" as const, projectId: plan.projectId } }, rows: source.rows };
    if (canonicalJson(logicalBaseSnapshot(copy)) !== canonicalJson(logicalBaseSnapshot(expected)) ||
      canonicalJson(copy.gallery) !== canonicalJson({ ...source.gallery, chatId: ownerFileStem(targetKey), incarnationId: plan.baseId }) ||
      canonicalJson(copy.history) !== canonicalJson(source.history) || copy.sync.scope && canonicalJson(copy.sync.scope) !== canonicalJson(plan.provenance.scope)) {
      throw new Error("BASE_INITIAL_RECOVERY_CONTENT_CHANGED");
    }
    await verifyImages();
  } else {
    if (await files.readMetaIfPresent(targetKey)) throw new Error("BASE_INITIAL_RECOVERY_REOPEN_REQUIRED");
    const sync = baseSyncEnvelopeSchema.parse({ ...source.sync, baseId: plan.baseId, initialIdentityRecovery: plan.provenance,
      initialCiphertext: undefined, detachedInitialCiphertexts: [...source.sync.detachedInitialCiphertexts ?? [],
        ...source.sync.initialCiphertext ? [source.sync.initialCiphertext] : []] });
    const target = await prepareProjectBase({ source, fromKey: ownerKey, toKey: targetKey, projectId: plan.projectId, intentId: plan.baseId,
      recovery: { sync, name: plan.name }, files, attachments, writeMeta: async (key, content) => {
        await verifyImages();
        await files.atomicWrite(files.metaPath(key), content);
      } });
    states.set(targetKey, target);
  }
  }
  if (!confirmed) return { meta: source.meta, rows: source.rows };
  const sync = baseSyncEnvelopeSchema.parse({ ...emptyBaseSync(confirmed.meta.ownerInstanceId), cloudState: "mirror",
    scope: plan.provenance.scope, confirmed, tombstones, cursor: String(confirmed.cloudRevision) });
  const encoded = serializeSync(sync), meta = baseMetaSchema.parse({ ...confirmed.meta, revision: source.meta.revision + 1,
    rowsGeneration: source.meta.rowsGeneration + 1, galleryGeneration: source.meta.galleryGeneration + 1,
    historyGeneration: source.meta.historyGeneration + 1, syncGeneration: (source.meta.syncGeneration ?? 0) + 1, syncHash: encoded.hash });
  const rows = structuredClone(confirmed.rows), gallery = emptyGalleryLedger(ownerFileStem(ownerKey), meta.ownerInstanceId), history = emptyHistoryLedger();
  validateStoredBase(meta, rows, gallery, { meta: value => files.serializeMeta(value), rows: value => files.serializeRows(value), gallery: value => files.serializeGallery(value) });
  await files.atomicWrite(files.rowsPath(ownerKey, meta.rowsGeneration), files.serializeRows(rows));
  await files.atomicWrite(files.galleryPath(ownerKey, meta.galleryGeneration), files.serializeGallery(gallery));
  await files.atomicWrite(files.historyPath(ownerKey, meta.historyGeneration), files.serializeHistory(history));
  await files.atomicWrite(syncPath(files.syncRoot, ownerKey, meta.syncGeneration!), encoded.content);
  try { await files.atomicWrite(files.metaPath(ownerKey), files.serializeMeta(meta)); }
  catch (error) {
    const durable = await files.readMetaIfPresent(ownerKey).catch(() => null);
    if (!durable || durable.revision !== source.meta.revision || durable.ownerInstanceId !== source.meta.ownerInstanceId) ports.block(ownerKey);
    throw error;
  }
  states.set(ownerKey, storedBase({ meta, rows, gallery, history, sync }));
  return { meta, rows };
}
