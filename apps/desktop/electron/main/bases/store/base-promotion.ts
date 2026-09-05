/**
 * [INPUT]: Depends on shared Base schema, BaseStoreFiles/AttachmentStore and Gallery ownership ledger; Received verified source state, projectId/intentId and meta release feedback
 * [OUTPUT]: Provides prepareProjectBase, re-bind and retain attachment ownership, copy blob/generation, publish project meta, and mount the promoted state frozen and id-indexed like every other Store entry
 * [POS]: The promotion leaf steps of bases/store; No touching lifecycle journal, no backing up to Store
 */

import {
  type BaseOwner,
} from "../../../../shared/bases-ipc";
import {
  baseMetaSchema,
} from "../../../../shared/bases-schema";
import { storedBase, type StoredBase } from "../base-store-model";
import type { BaseAttachmentStore } from "./attachments";
import { ownerFileStem, type BaseStoreFiles } from "./base-files";

export async function prepareProjectBase(input: {
  source: StoredBase;
  fromKey: string;
  toKey: string;
  projectId: string;
  intentId: string;
  files: BaseStoreFiles;
  attachments: BaseAttachmentStore;
  writeMeta(ownerKey: string, content: string): Promise<void>;
}): Promise<StoredBase> {
  const owner: BaseOwner = {
    kind: "project",
    projectId: input.projectId,
  };
  const meta = baseMetaSchema.parse({
    ...structuredClone(input.source.meta),
    owner,
    ownerInstanceId: input.intentId,
    // 升格产物回到 Project 容器；根可见性由用户后续显式动作决定。
    navigation: { kind: "project-contained", projectId: input.projectId },
    revision: 0,
    rowsGeneration: 0,
    galleryGeneration: 0,
    historyGeneration: 0,
  });
  const rows = structuredClone(input.source.rows);
  const gallery = {
    ...structuredClone(input.source.gallery),
    chatId: ownerFileStem(input.toKey),
    incarnationId: input.intentId,
  };
  const history = structuredClone(input.source.history);
  await input.attachments.copyFamily(
    ownerFileStem(input.fromKey),
    input.source.meta.ownerInstanceId,
    ownerFileStem(input.toKey),
    input.intentId
  );
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
  await input.writeMeta(input.toKey, input.files.serializeMeta(meta));
  return storedBase({ meta, rows, gallery, history });
}
