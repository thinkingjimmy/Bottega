/**
 * [INPUT]: Depends on BaseStoreFiles/BaseAttachmentStore, the strict Base meta schema, canonical chat identities and live Project ids
 * [OUTPUT]: Mounts only complete current Base generations, validates owner incarnation and fails closed on missing or corrupt published dependencies without an empty replacement.
 * [POS]: The load half of bases/store; BaseStore keeps the queue, transactions and commits, this file only turns disk into memory
 */

import { readSync } from "./sync/files";
import { syncAttachmentRoots, projectBase } from "./sync/projection";
import { canonicalJson } from "../../../../shared/local-storage/contracts";
import { mkdir, readdir } from "node:fs/promises";
import {
  BASE_META_BYTE_LIMIT,
  ownerKeyOf,
  type BaseMeta,
  } from "../../../../shared/bases-ipc";
import { baseMetaSchema } from "../../../../shared/bases-schema";
import { errorMessage } from "../../errors";
import {
  storedBase,
  type BaseIdentity,
  type StoredBase,
  validateStoredBase,
} from "../base-store-model";
import type { BaseAttachmentStore } from "./attachments";
import {
  ownerFileStem,
  ownerKeyFromStem,
  type BaseStoreFiles,
} from "./base-files";
import { collectRowAttachmentBlobIds } from "./gallery-ledger";

type StartupInput = {
  root: string;
  exportsRoot: string;
  files: BaseStoreFiles;
  attachments: BaseAttachmentStore;
  states: Map<string, StoredBase>;
  chats: ReadonlyMap<string, BaseIdentity>;
  projectIds: ReadonlySet<string>;
  now(): number;
};

export async function initializeBaseStoreStartup(input: StartupInput) {
  await mkdir(input.root, { recursive: true, mode: 0o700 });
  await mkdir(input.exportsRoot, { recursive: true, mode: 0o700 });
  await input.files.sweepTemporaryFiles();
  await input.attachments.initialize();
  input.states.clear();

  const entries = await readdir(input.root, { withFileTypes: true });
  const metaNames = entries
    .filter(
      (entry) =>
        entry.isFile() &&
        /^(?:chat|project)-[A-Za-z0-9_-]{1,128}\.json$/.test(entry.name)
    )
    .map((entry) => entry.name)
    .sort();

  for (const name of metaNames) {
    await loadOwner(input, ownerKeyFromStem(name.slice(0, -5)));
  }
}

/**
 * 加载一个 owner 只有三种结局：挂载、原样跳过（owner 状态未知）、隔离。
 * 任何读取/校验异常都走隔离——文件改名成 `.orphan-<ts>` 后 owner 即不存在，
 * `ensure` 可以就地重建一个空 Base，磁盘上的旧字节谁也不再碰。
 */
async function loadOwner(input: StartupInput, ownerKey: string) {
  let meta: BaseMeta;
  try {
    meta = baseMetaSchema.parse(
      JSON.parse(
        await input.files.readBounded(
          input.files.metaPath(ownerKey),
          BASE_META_BYTE_LIMIT
        )
      )
    );
    if (ownerKeyOf(meta.owner) !== ownerKey) {
      throw new Error("meta owner 与文件名不一致");
    }
  } catch (cause) {
    throw new Error(`Base ${ownerKey} cannot be opened; original files were preserved`, { cause });
  }
  const sync = await readSync(input.files, input.root, meta);
  if (!(await reconcileOwner(input, meta, sync.cloudState !== "local-only" || sync.detachedCustody.length > 0))) return;

  try {
    const rows = await input.files.readRows(meta);
    if (sync.confirmed && canonicalJson(projectBase(sync).rows) !== canonicalJson(rows)) throw new Error("Base rows and synchronization projection disagree");
    const gallery = await input.files.readGallery(meta);
    const history = await input.files.readHistory(meta);
    const rowsById = validateStoredBase(meta, rows, gallery, {
      meta: (value) => input.files.serializeMeta(value),
      rows: (value) => input.files.serializeRows(value),
      gallery: (value) => input.files.serializeGallery(value),
    });
    input.states.set(
      ownerKey,
      storedBase({ meta, rows, rowsById, gallery, history, sync,
        attachmentBlobIds: new Set([...collectRowAttachmentBlobIds(rows), ...syncAttachmentRoots(sync)]) })
    );
    await input.attachments.gcFamily(ownerFileStem(ownerKey), meta.ownerInstanceId, input.states.get(ownerKey)!.attachmentBlobIds);
    await input.files
      .gcGenerations(
        ownerKey,
        meta.rowsGeneration,
        meta.galleryGeneration,
        meta.historyGeneration,
        meta.syncGeneration
      )
      .catch((cause) =>
        console.warn(
          `Base ${ownerKey} 旧世代清理失败：${errorMessage(cause)}`
        )
      );
  } catch (cause) {
    input.states.delete(ownerKey);
    throw new Error(`Base ${ownerKey} recovery failed; original files were preserved`, { cause });
  }
}

/** true 表示 owner 仍然活着、可以继续加载。 */
async function reconcileOwner(input: StartupInput, meta: BaseMeta, retained: boolean) {
  const ownerKey = ownerKeyOf(meta.owner);
  if (meta.owner.kind === "chat") {
    const chat = input.chats.get(meta.owner.chatId);
    if (!chat) {
      console.warn(`Base ${ownerKey} 的 Chat 状态未知，按 unknown 保留`);
      return false;
    }
    if (
      chat.incarnationId !== meta.owner.incarnationId ||
      chat.incarnationId !== meta.ownerInstanceId
    ) {
      if (retained) throw new Error("BASE_OWNER_RECOVERY_REQUIRED");
      await input.files.removeFamilyFiles(ownerKey);
      await input.attachments.releaseFamily(
        ownerFileStem(ownerKey),
        meta.ownerInstanceId,
        "deleted-proven"
      );
      return false;
    }
    return true;
  }
  if (input.projectIds.has(meta.owner.projectId)) return true;
  if (retained) throw new Error("BASE_PROJECT_RECOVERY_REQUIRED");
  const isolatedAt = input.now();
  await input.files.isolateFamily(ownerKey, isolatedAt);
  await input.attachments.isolateFamily(
    ownerFileStem(ownerKey),
    meta.ownerInstanceId,
    isolatedAt
  );
  console.warn(`Project Base ${ownerKey} 缺少 Project 记录，已保守隔离`);
  return false;
}
