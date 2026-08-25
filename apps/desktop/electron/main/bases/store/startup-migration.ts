/**
 * [INPUT]: Depends on BaseStoreFiles/AttachmentStore, start the migration of pure functions, owner identity snapshot and Store memory container
 * [OUTPUT]: Provides initialize BaseStoreStartup with BaseStartupBlocked, complete the damaged tombstone loading, rows/gallery, three-mode migration release, one-time success event, owner recovery and start GC
 * [POS]: The database is a database of databases and storesLocated above the IO core layer, the BaseStore keeps running query/transaction/submission
 */

import { mkdir, readdir, rename } from "node:fs/promises";
import { basename } from "node:path";
import {
  BASE_META_BYTE_LIMIT,
  BASE_ROWS_BYTE_LIMIT,
  ownerKeyOf,
  type BaseMigrationEvent,
  type BaseMeta,
  type BaseRow,
} from "../../../../shared/bases-ipc";
import { baseMetaSchema } from "../../../../shared/bases-schema";
import {
  BASE_GALLERY_LEDGER_BYTE_LIMIT,
  type BaseGalleryLedger,
} from "../../../../shared/bases/gallery-attachments";
import type { BaseHistoryLedger } from "../../../../shared/bases/history-ledger-schema";
import { errorMessage } from "../../errors";
import { loadBaseCorruptTombstones } from "../base-corruption";
import { migrateGalleryRows, migrateLegacyBaseMeta } from "../base-migrations";
import {
  type BaseIdentity,
  type CorruptTombstone,
  type StoredBase,
  validateStoredBase,
} from "../base-store-model";
import type { BaseAttachmentStore } from "./attachments";
import {
  ownerFileStem,
  ownerKeyFromStem,
  type BaseStoreFiles,
} from "./base-files";
import {
  BaseAmbiguousCommitError,
  BaseNotPublishedCommitError,
} from "./commit-kernel";
import { collectRowAttachmentBlobIds } from "./gallery-ledger";

export type BaseStartupBlocked = {
  ownerInstanceId: string;
  error: Error;
};

type StartupInput = {
  root: string;
  exportsRoot: string;
  files: BaseStoreFiles;
  attachments: BaseAttachmentStore;
  states: Map<string, StoredBase>;
  corrupt: Map<string, CorruptTombstone>;
  frozen: Map<string, BaseAmbiguousCommitError>;
  startupBlocked: Map<string, BaseStartupBlocked>;
  warnings: string[];
  migrationEvents: BaseMigrationEvent[];
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
  input.corrupt.clear();
  input.frozen.clear();
  input.startupBlocked.clear();
  input.warnings.length = 0;
  input.migrationEvents.length = 0;

  let entries = await readdir(input.root, { withFileTypes: true });
  await loadBaseCorruptTombstones({
    entries,
    chats: input.chats,
    projectIds: input.projectIds,
    files: input.files,
    attachments: input.attachments,
    corrupt: input.corrupt,
    now: input.now,
    warn: (message) => warn(input, message),
  });
  entries = await readdir(input.root, { withFileTypes: true });
  const metaNames = entries
    .filter(
      (entry) =>
        entry.isFile() &&
        /^(?:chat|project)-[A-Za-z0-9_-]{1,128}\.json$/.test(entry.name)
    )
    .map((entry) => entry.name)
    .sort();
  const activeStems = new Set<string>();

  for (const name of metaNames) {
    const stem = name.slice(0, -5);
    const ownerKey = ownerKeyFromStem(stem);
    activeStems.add(stem);
    if (input.corrupt.has(ownerKey)) continue;
    await loadOwner(input, ownerKey);
  }

  await input.files.retainUnownedGenerations(
    new Set([
      ...activeStems,
      ...[...input.corrupt.keys()].map(ownerFileStem),
    ])
  );
}

async function loadOwner(input: StartupInput, ownerKey: string) {
  const path = input.files.metaPath(ownerKey);
  let meta: BaseMeta;
  let publishedMetaContent = "";
  let metaMigrated = false;
  try {
    publishedMetaContent = await input.files.readBounded(
      path,
      BASE_META_BYTE_LIMIT
    );
    const rawMeta = JSON.parse(publishedMetaContent) as {
      galleryGeneration?: unknown;
    };
    const migrated = migrateLegacyBaseMeta(
      rawMeta,
      await input.files.readLegacyGalleryTarget(
        ownerKey,
        Number.isInteger(rawMeta.galleryGeneration)
          ? Number(rawMeta.galleryGeneration)
          : 0
      )
    );
    meta = migrated.meta;
    metaMigrated = migrated.changed;
    if (ownerKeyOf(meta.owner) !== ownerKey) {
      throw new Error("meta owner 与文件名不一致");
    }
  } catch (cause) {
    await isolateMeta(input, ownerKey, path, cause, null);
    return;
  }
  if (!(await reconcileOwner(input, meta))) return;

  let rows: BaseRow[];
  let gallery: BaseGalleryLedger;
  let history: BaseHistoryLedger;
  let startupMigrationNeeded = metaMigrated;
  try {
    rows = await input.files.readRows(meta);
    gallery = await input.files.readGallery(meta);
    history = await input.files.readHistory(meta);
    const preview = migrateGalleryRows(meta, rows, gallery);
    startupMigrationNeeded ||=
      preview.metaChanged ||
      preview.rowsChanged ||
      preview.galleryChanged;
  } catch (cause) {
    await isolateMeta(input, ownerKey, path, cause, meta.ownerInstanceId);
    return;
  }

  try {
    const loaded = await publishStartupMigration(
      input,
      ownerKey,
      meta,
      rows,
      gallery,
      history,
      metaMigrated,
      publishedMetaContent
    );
    validateState(input.files, loaded.meta, loaded.rows, loaded.gallery);
    input.states.set(ownerKey, loaded);
    if (startupMigrationNeeded) {
      input.migrationEvents.push({
        type: "base-migrated",
        ownerKey,
        ownerInstanceId: loaded.meta.ownerInstanceId,
        revision: loaded.meta.revision,
        migration: "row-backed-gallery-v1",
      });
    }
    await gcAttachments(input, ownerKey, loaded.meta.ownerInstanceId, loaded.rows);
    await input.files
      .gcGenerations(
        ownerKey,
        loaded.meta.rowsGeneration,
        loaded.meta.galleryGeneration ?? 0,
        loaded.meta.historyGeneration ?? 0
      )
      .catch((cause) =>
        warn(
          input,
          `Base ${ownerKey} 旧世代清理失败：${errorMessage(cause)}`
        )
      );
  } catch (cause) {
    if (startupMigrationNeeded) {
      const error =
        cause instanceof BaseNotPublishedCommitError ||
        cause instanceof BaseAmbiguousCommitError
          ? cause
          : new BaseAmbiguousCommitError(path, cause);
      input.startupBlocked.set(ownerKey, {
        ownerInstanceId: meta.ownerInstanceId,
        error,
      });
      warn(
        input,
        `Base ${ownerKey} 启动迁移未发布，保留原文件等待重试：${errorMessage(cause)}`
      );
      return;
    }
    await isolateMeta(input, ownerKey, path, cause, meta.ownerInstanceId);
  }
}

async function publishStartupMigration(
  input: StartupInput,
  ownerKey: string,
  meta: BaseMeta,
  rows: BaseRow[],
  gallery: BaseGalleryLedger,
  history: BaseHistoryLedger,
  metaChanged: boolean,
  previousMetaContent: string
): Promise<StoredBase> {
  const migrated = migrateGalleryRows(meta, rows, gallery);
  if (
    !metaChanged &&
    !migrated.metaChanged &&
    !migrated.rowsChanged &&
    !migrated.galleryChanged
  ) {
    return { meta, rows, gallery, history };
  }
  const nextGalleryGeneration =
    (meta.galleryGeneration ?? 0) + Number(migrated.galleryChanged);
  const nextMeta = baseMetaSchema.parse({
    ...migrated.meta,
    revision: meta.revision + 1,
    rowsGeneration: meta.rowsGeneration + Number(migrated.rowsChanged),
    galleryGeneration: nextGalleryGeneration,
  });
  validateState(input.files, nextMeta, migrated.rows, migrated.gallery);
  await input.files.backupBeforeRowGalleryMigration(ownerKey, meta);
  if (migrated.rowsChanged) {
    const rowsPath = input.files.rowsPath(ownerKey, nextMeta.rowsGeneration);
    const published = await publishStartupFile(
      input.files,
      rowsPath,
      null,
      input.files.serializeRows(migrated.rows),
      BASE_ROWS_BYTE_LIMIT
    );
    if (published === "not-published") {
      throw new BaseNotPublishedCommitError(rowsPath);
    }
  }
  if (migrated.galleryChanged) {
    const galleryPath = input.files.galleryPath(
      ownerKey,
      nextGalleryGeneration
    );
    const published = await publishStartupFile(
      input.files,
      galleryPath,
      null,
      input.files.serializeGallery(migrated.gallery),
      BASE_GALLERY_LEDGER_BYTE_LIMIT
    );
    if (published === "not-published") {
      throw new BaseNotPublishedCommitError(galleryPath);
    }
  }
  const metaPath = input.files.metaPath(ownerKey);
  const published = await publishStartupFile(
    input.files,
    metaPath,
    previousMetaContent,
    input.files.serializeMeta(nextMeta),
    BASE_META_BYTE_LIMIT
  );
  if (published === "not-published") {
    throw new BaseNotPublishedCommitError(metaPath);
  }
  warn(input, `Base ${ownerKey} 已迁移为 row-backed Gallery / 六视图合同`);
  return {
    meta: nextMeta,
    rows: migrated.rows,
    gallery: migrated.gallery,
    history,
  };
}

/**
 * 启动迁移可遇到「rename 已成功，但调用方收到异常」。候选字节已完整可见
 * 即按 published 收敛；明确仍是 previous/ENOENT 才允许下次重试，其余一律冻结。
 */
async function publishStartupFile(
  files: BaseStoreFiles,
  path: string,
  previous: string | null,
  candidate: string,
  limit: number
): Promise<"published" | "not-published"> {
  try {
    await files.atomicWrite(path, candidate);
    return "published";
  } catch (cause) {
    let actual: string;
    try {
      actual = await files.readBounded(path, limit);
    } catch (readCause) {
      if (
        previous === null &&
        (readCause as NodeJS.ErrnoException)?.code === "ENOENT"
      ) {
        return "not-published";
      }
      throw new BaseAmbiguousCommitError(path, cause);
    }
    if (actual === candidate) return "published";
    if (previous !== null && actual === previous) return "not-published";
    throw new BaseAmbiguousCommitError(path, cause);
  }
}

async function reconcileOwner(input: StartupInput, meta: BaseMeta) {
  const ownerKey = ownerKeyOf(meta.owner);
  if (meta.owner.kind === "chat") {
    const chat = input.chats.get(meta.owner.chatId);
    if (!chat) {
      warn(input, `Base ${ownerKey} 的 Chat 状态未知，按 unknown 保留`);
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
  warn(input, `Project Base ${ownerKey} 缺少 Project 记录，已保守隔离`);
  return false;
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
      warn(
        input,
        `Base ${ownerKey} attachment GC 失败：${errorMessage(cause)}`
      )
    );
}

function validateState(
  files: BaseStoreFiles,
  meta: BaseMeta,
  rows: BaseRow[],
  gallery: BaseGalleryLedger
) {
  validateStoredBase(meta, rows, gallery, {
    meta: (value) => files.serializeMeta(value),
    rows: (value) => files.serializeRows(value),
    gallery: (value) => files.serializeGallery(value),
  });
}

async function isolateMeta(
  input: StartupInput,
  ownerKey: string,
  path: string,
  cause: unknown,
  ownerInstanceId: string | null
) {
  const backup = `${path}.bak-${input.now()}`;
  const tombstone: CorruptTombstone = {
    ownerKey,
    ownerInstanceId,
    backupName: basename(backup),
    reason: errorMessage(cause),
    quarantinedAt: input.now(),
  };
  input.corrupt.set(ownerKey, tombstone);
  try {
    await input.files.atomicWrite(
      input.files.corruptPath(ownerKey),
      `${JSON.stringify(tombstone, null, 2)}\n`
    );
  } catch (markerCause) {
    warn(
      input,
      `Base ${ownerKey} 损坏墓碑落盘失败，保持 fail-closed：${errorMessage(markerCause)}`
    );
    return;
  }
  try {
    await rename(path, backup);
    warn(input, `Base ${ownerKey} 损坏，已隔离到 ${backup}`);
  } catch (backupCause) {
    warn(input, `Base ${ownerKey} 损坏且无法隔离：${errorMessage(backupCause)}`);
  }
}

function warn(input: StartupInput, message: string) {
  input.warnings.push(message);
}
