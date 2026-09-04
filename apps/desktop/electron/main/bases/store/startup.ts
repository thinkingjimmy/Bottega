/**
 * [INPUT]: Depends on BaseStoreFiles/BaseAttachmentStore, the strict Base meta schema, canonical chat identities and live Project ids
 * [OUTPUT]: Provides initializeBaseStoreStartup: mount every v2 owner into the Store map frozen and id-indexed, reconcile owner liveness, and isolate any owner that fails to load
 * [POS]: The load half of bases/store; BaseStore keeps the queue, transactions and commits, this file only turns disk into memory
 */

import { mkdir, readdir } from "node:fs/promises";
import {
  BASE_META_BYTE_LIMIT,
  ownerKeyOf,
  type BaseMeta,
  type BaseRow,
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
    await isolate(input, ownerKey, null, cause);
    return;
  }
  if (!(await reconcileOwner(input, meta))) return;

  try {
    const rows = await input.files.readRows(meta);
    const gallery = await input.files.readGallery(meta);
    const history = await input.files.readHistory(meta);
    const rowsById = validateStoredBase(meta, rows, gallery, {
      meta: (value) => input.files.serializeMeta(value),
      rows: (value) => input.files.serializeRows(value),
      gallery: (value) => input.files.serializeGallery(value),
    });
    input.states.set(
      ownerKey,
      storedBase({ meta, rows, rowsById, gallery, history })
    );
    await gcAttachments(input, ownerKey, meta.ownerInstanceId, rows);
    await input.files
      .gcGenerations(
        ownerKey,
        meta.rowsGeneration,
        meta.galleryGeneration,
        meta.historyGeneration
      )
      .catch((cause) =>
        console.warn(
          `Base ${ownerKey} 旧世代清理失败：${errorMessage(cause)}`
        )
      );
  } catch (cause) {
    input.states.delete(ownerKey);
    await isolate(input, ownerKey, meta.ownerInstanceId, cause);
  }
}

/** true 表示 owner 仍然活着、可以继续加载。 */
async function reconcileOwner(input: StartupInput, meta: BaseMeta) {
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

async function isolate(
  input: StartupInput,
  ownerKey: string,
  ownerInstanceId: string | null,
  cause: unknown
) {
  const isolatedAt = input.now();
  await input.files.isolateFamily(ownerKey, isolatedAt);
  if (ownerInstanceId) {
    await input.attachments.isolateFamily(
      ownerFileStem(ownerKey),
      ownerInstanceId,
      isolatedAt
    );
  }
  console.warn(
    `Base ${ownerKey} 无法加载，已隔离为 .orphan-${isolatedAt}：${errorMessage(cause)}`
  );
}

async function gcAttachments(
  input: StartupInput,
  ownerKey: string,
  ownerInstanceId: string,
  rows: readonly BaseRow[]
) {
  await input.attachments
    .gcFamily(
      ownerFileStem(ownerKey),
      ownerInstanceId,
      collectRowAttachmentBlobIds(rows)
    )
    .catch((cause) =>
      console.warn(
        `Base ${ownerKey} attachment GC 失败：${errorMessage(cause)}`
      )
    );
}
