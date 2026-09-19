/**
 * [INPUT]: Depends on shared Base schema, BaseStoreFiles/AttachmentStore, frozen ciphertext sidecars and verified transfer provenance.
 * [OUTPUT]: Publishes complete local recovery copies, receipt-confirmed or remotely observed transfers with original data and attachment custody.
 * [POS]: Generation writer in bases/store/promotion; consumes verified transfer evidence without managing the lifecycle journal.
 */

import { serializeSync, syncPath } from "../sync/files";
import { emptyBaseSync, type BaseSyncEnvelope } from "../sync/model";
import { projectBase } from "../sync/projection";
import { transferredRemoteEnvelope } from "./remote";
import { transferBaseEnvelope, type ConfirmedBasePromotion } from "./cloud";

import { type BaseOwner } from "@ai-chat/base-ui/model/owner-key";
import {
  baseMetaSchema,
} from "../../../../../shared/bases-schema";
import { storedBase, type StoredBase } from "../../base-store-model";
import type { BaseAttachmentStore } from "../attachments";
import { ownerFileStem, type BaseStoreFiles } from "../base-files";

export async function prepareProjectBase(input: {
  source: StoredBase;
  fromKey: string;
  toKey: string;
  projectId: string;
  intentId: string;
  cloud?: ConfirmedBasePromotion;
  remote?: boolean;
  recovery?: { sync: BaseSyncEnvelope; name: string };
  files: BaseStoreFiles;
  attachments: BaseAttachmentStore;
  writeMeta(ownerKey: string, content: string): Promise<void>;
}): Promise<StoredBase> {
  if ((input.source.sync.cloudState !== "local-only") !== Boolean(input.cloud || input.remote)) throw new Error("Synchronized Base promotion requires a confirmed lifecycle receipt");
  if (input.recovery && (input.cloud || input.remote || input.recovery.sync.cloudState !== "local-only" || input.recovery.sync.baseId !== input.intentId)) throw new Error("BASE_INITIAL_RECOVERY_UNAVAILABLE");
  const sync = input.remote ? transferredRemoteEnvelope(input.source, input.fromKey, input.projectId, input.intentId) : input.cloud ? transferBaseEnvelope(input.source, input.fromKey, input.projectId, input.intentId, input.cloud) : input.recovery?.sync ?? emptyBaseSync(input.intentId);
  const projected = input.cloud || input.remote ? projectBase(sync) : input.source;
  const instanceId = sync.baseId;
  const syncFile = serializeSync(sync);
  const owner: BaseOwner = {
    kind: "project",
    projectId: input.projectId,
  };
  const meta = baseMetaSchema.parse({
    ...structuredClone(projected.meta),
    name: input.recovery?.name ?? projected.meta.name,
    owner,
    ownerInstanceId: instanceId,
    // Local promotion returns to the Project container; root visibility requires a later explicit action.
    navigation: input.cloud || input.remote ? projected.meta.navigation : { kind: "project-contained", projectId: input.projectId },
    syncGeneration: 0, syncHash: syncFile.hash,
    revision: 0,
    rowsGeneration: 0,
    galleryGeneration: 0,
    historyGeneration: 0,
  });
  const rows = structuredClone(projected.rows);
  const gallery = {
    ...structuredClone(input.source.gallery),
    chatId: ownerFileStem(input.toKey),
    incarnationId: instanceId,
  };
  const history = structuredClone(input.source.history);
  await input.attachments.copyFamily(
    ownerFileStem(input.fromKey),
    input.source.meta.ownerInstanceId,
    ownerFileStem(input.toKey),
    instanceId
  );
  const cipherHashes = new Set([sync.encryptionFiles, ...sync.detachedCustody.map(custody => custody.encryptionFiles)]
    .flatMap(custody => Object.values(custody?.records ?? {}).map(record => record.hash)));
  await input.files.copyCiphertext(input.fromKey, input.toKey, cipherHashes);
  await input.files.atomicWrite(
    input.files.rowsPath(input.toKey, 0),
    input.files.serializeRows(rows)
  );
  await input.files.atomicWrite(
    input.files.galleryPath(input.toKey, 0),
    input.files.serializeGallery(gallery)
  );
  await input.files.atomicWrite(
    input.files.historyPath(input.toKey, 0),
    input.files.serializeHistory(history)
  );
  await input.files.atomicWrite(syncPath(input.files.syncRoot, input.toKey, 0), syncFile.content);
  await input.writeMeta(input.toKey, input.files.serializeMeta(meta));
  return storedBase({ meta, rows, gallery, history, sync });
}
