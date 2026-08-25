/**
 * [INPUT]: Depends on shared owner-aware Base/Gallery type, schemes, budgets and gallery-ledger scores
 * [OUTPUT]: Provides BaseStore status/identity/mutation Type, field error, status check with owner→Gallery identity
 * [POS]: The base layer of the Store is pure model; base-store.ts holds the IO/ queue, and this file closes without any side effects rules
 */

import { randomUUID } from "node:crypto";
import {
  BASE_COLUMN_LIMIT,
  BASE_ROW_BYTE_LIMIT,
  BASE_ROW_LIMIT,
  BASE_VIEW_LIMIT,
  ownerKeyOf,
  type BaseMeta,
  type BaseOwner,
  type BasePinnedSummary,
  type BaseRow,
  type BaseSnapshot,
} from "../../../shared/bases-ipc";
import type { BaseGalleryLedger } from "../../../shared/bases/gallery-attachments";
import type {
  BaseHistoryActor,
  BaseHistoryLedger,
} from "../../../shared/bases/history-ledger-schema";
import { galleryOwnerId } from "./store/base-files";
import { validateGalleryLedger } from "./store/gallery-ledger";

export type StoredBase = {
  meta: BaseMeta;
  rows: BaseRow[];
  gallery: BaseGalleryLedger;
  history: BaseHistoryLedger;
};

type DeepReadonly<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends readonly (infer Item)[]
    ? readonly DeepReadonly<Item>[]
    : T extends object
      ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
      : T;

export type ReadonlyBaseSnapshot = DeepReadonly<
  Pick<StoredBase, "meta" | "rows">
>;

export type CorruptTombstone = {
  ownerKey: string;
  ownerInstanceId: string | null;
  backupName: string | null;
  reason: string;
  quarantinedAt: number;
};

export type BaseStoreMutation = {
  meta: BaseMeta;
  rows: BaseRow[];
  rowsChanged: boolean;
  gallery?: BaseGalleryLedger;
  galleryChanged?: boolean;
  actor?: BaseHistoryActor;
  operation?: string;
};

export type BaseIdentity = {
  chatId: string;
  incarnationId: string;
  title: string | null;
};

export type BaseOwnerIdentity = {
  owner: BaseOwner;
  ownerInstanceId: string;
  title: string | null;
};

export type BaseStoreDependencies = {
  atomicWrite?: (path: string, content: string) => Promise<void>;
  readText?: (path: string) => Promise<string>;
  now?: () => number;
};

export function baseNavigationSummary(meta: BaseMeta): BasePinnedSummary {
  return {
    ownerKey: ownerKeyOf(meta.owner),
    ownerInstanceId: meta.ownerInstanceId,
    name: meta.name,
    revision: meta.revision,
  };
}

export class BaseCorruptError extends Error {
  readonly status = 500;
}

export class BaseNotFoundError extends Error {
  readonly status = 404;
  readonly code = "base_not_found";
}

export class BaseIncarnationError extends Error {
  readonly status = 409;
  readonly code = "base_instance_changed";
}

export class BaseStoreConflictError extends Error {
  readonly status = 409;
}

export function validateStoredBase(
  meta: BaseMeta,
  rows: BaseRow[],
  gallery: BaseGalleryLedger,
  serialize: {
    meta(value: BaseMeta): string;
    rows(value: BaseRow[]): string;
    gallery(value: BaseGalleryLedger): string;
  }
) {
  if (meta.columns.length > BASE_COLUMN_LIMIT) throw new Error("Base 列数超限");
  if (meta.views.length > BASE_VIEW_LIMIT) throw new Error("Base 视图数超限");
  if (rows.length > BASE_ROW_LIMIT) throw new Error("Base 行数不能超过 10000");
  const columnIds = new Set(meta.columns.map((column) => column.id));
  const rowIds = new Set<string>();
  for (const row of rows) {
    if (rowIds.has(row.id)) throw new Error(`Base row id 重复：${row.id}`);
    rowIds.add(row.id);
    if (Buffer.byteLength(JSON.stringify(row), "utf8") > BASE_ROW_BYTE_LIMIT) {
      throw new Error(`Base row ${row.id} 超过 32 KB`);
    }
    for (const columnId of Object.keys(row.values)) {
      if (!columnIds.has(columnId)) {
        throw new Error(`Base row ${row.id} 引用了未知列 ${columnId}`);
      }
    }
  }
  serialize.meta(meta);
  serialize.rows(rows);
  validateGalleryLedger(meta, rows, gallery, galleryOwnerId(meta));
  serialize.gallery(gallery);
}

export { galleryOwnerId };

export function chatOwnerIdentity(identity: BaseIdentity): BaseOwnerIdentity {
  return {
    owner: {
      kind: "chat",
      chatId: identity.chatId,
      incarnationId: identity.incarnationId,
    },
    ownerInstanceId: identity.incarnationId,
    title: identity.title,
  };
}

export function projectOwnerIdentity(
  projectId: string,
  title: string | null,
  ownerInstanceId: string = randomUUID()
): BaseOwnerIdentity {
  return {
    owner: { kind: "project", projectId },
    ownerInstanceId,
    title,
  };
}

export type SnapshotMutation = (
  current: BaseSnapshot
) => BaseStoreMutation | null;
