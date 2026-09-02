/**
 * [INPUT]: Depends on shared Base schema, BaseStoreFiles/AttachmentStore and Gallery ownership ledger; Received verified source state, projectId/intentId and meta release feedback
 * [OUTPUT]: Provides prepareProjectBase, re-bind and retain attachment ownership, copy blob/generation and publish project meta local promotion Submit original language
 * [POS]: The promotion leaf steps of bases; No touching lifecycle journal, no backing up to Store
 */

import {
  type BaseOwner,
} from "../../../shared/bases-ipc";
import {
  baseMetaSchema,
} from "../../../shared/bases-schema";
import type { StoredBase } from "./base-store-model";
import type { BaseAttachmentStore } from "./store/attachments";
import { ownerFileStem, type BaseStoreFiles } from "./store/base-files";

const clone = <T>(value: T): T => structuredClone(value);

export async function prepareProjectBase(input: {
  source: StoredBase;
  fromKey: string;
  toKey: string;
  projectId: string;
  intentId: string;
  files: BaseStoreFiles;
  attachments: BaseAttachmentStore;
  publishMeta(ownerKey: string, content: string): Promise<void>;
}): Promise<StoredBase> {
  const owner: BaseOwner = {
    kind: "project",
    projectId: input.projectId,
  };
  const meta = baseMetaSchema.parse({
    ...clone(input.source.meta),
    owner,
    ownerInstanceId: input.intentId,
    // pin 已冻结为存量 chat base 专用展示：升格产物带着 pinned 会重新钻进
    // Sidebar「Bases」组，且没有任何 unpin 入口能把它弄出去
    pinned: false,
    navigation: { kind: "project-contained", projectId: input.projectId },
    revision: 0,
    rowsGeneration: 0,
    galleryGeneration: 0,
    historyGeneration: 0,
  });
  const rows = clone(input.source.rows);
  const gallery = {
    ...clone(input.source.gallery),
    chatId: ownerFileStem(input.toKey),
    incarnationId: input.intentId,
  };
  const history = clone(input.source.history);
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
  await input.publishMeta(input.toKey, input.files.serializeMeta(meta));
  return { meta, rows, gallery, history };
}
