/**
 * [INPUT]: Depends on shared owner-aware Base/Gallery/navigation types, schemas, budgets, and gallery-ledger facts
 * [OUTPUT]: Provides BaseStore identity/mutation types with declared row changes, the frozen stored entry factory, incremental row validation, the store error classes, and owner→Gallery identity
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
  type BaseNavigationSummary,
  type BaseRow,
  type BaseSnapshot,
} from "../../../shared/bases-ipc";
import type { BaseGalleryLedger } from "../../../shared/bases/gallery-attachments";
import type {
  BaseHistoryActor,
  BaseHistoryLedger,
} from "../../../shared/bases/history-ledger-schema";
import type { BaseNavigation } from "../../../shared/placement/facts";
import { galleryOwnerId } from "./store/base-files";
import {
  collectRowAttachmentBlobIds,
  validateGalleryLedger,
} from "./store/gallery-ledger";

export type StoredBase = {
  meta: BaseMeta;
  rows: BaseRow[];
  /** rows 的 id 索引：附件读取、Gallery 派生、历史差分一律直取，不再扫全表。 */
  rowsById: ReadonlyMap<string, BaseRow>;
  /** rows 仍引用的 blob 全集；只有它收缩，附件 GC 才有事可做。 */
  attachmentBlobIds: ReadonlySet<string>;
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

/** peek 交出的是同一份只读真相，外加那份不必再建一次的 id 索引。 */
export type IndexedBaseSnapshot = ReadonlyBaseSnapshot &
  Pick<StoredBase, "rowsById">;

/** 整表改写的诚实招供：删列、导入、数据迁移、启动加载都走全量校验。 */
export const ALL_ROWS_CHANGED = "all";

export type BaseMutationRowIds = ReadonlySet<string> | typeof ALL_ROWS_CHANGED;

export const NO_ROWS_CHANGED: ReadonlySet<string> = new Set<string>();

/**
 * 提交声明：kernel 必须说清自己动了哪些行，Store 只按声明付代价。
 * 「哪些行变了」曾是 Store 每次用 6 趟全表扫描去反推的东西——反推的代价
 * 与表长成正比，而事实本来就在改行的人手里。让它顺着调用链一起传下来，
 * 单格编辑就永远只值一格的钱。
 */
export type BaseStoreMutation = {
  meta: BaseMeta;
  rows: BaseRow[];
  changedRowIds: BaseMutationRowIds;
  removedRowIds?: ReadonlySet<string>;
  gallery?: BaseGalleryLedger;
  galleryChanged?: boolean;
  actor?: BaseHistoryActor;
  operation?: string;
};

/** rowsChanged 不再是入参，而是声明的推论。 */
export function mutationTouchesRows(input: BaseStoreMutation) {
  return (
    input.changedRowIds === ALL_ROWS_CHANGED ||
    input.changedRowIds.size > 0 ||
    Boolean(input.removedRowIds?.size)
  );
}

export type BaseIdentity = {
  chatId: string;
  incarnationId: string;
  title: string | null;
};

export type BaseOwnerIdentity = {
  owner: BaseOwner;
  ownerInstanceId: string;
  title: string | null;
  navigation?: BaseNavigation;
};

export type BaseStoreDependencies = {
  atomicWrite?: (path: string, content: string) => Promise<void>;
  readText?: (path: string) => Promise<string>;
  now?: () => number;
};

export function baseNavigationSummary(meta: BaseMeta): BaseNavigationSummary {
  return {
    ownerKey: ownerKeyOf(meta.owner),
    ownerInstanceId: meta.ownerInstanceId,
    name: meta.name,
    revision: meta.revision,
    navigation: structuredClone(meta.navigation),
  };
}

export class BaseNotFoundError extends Error {
  readonly status = 404;
  readonly code = "base_not_found";
}

export class BaseIncarnationError extends Error {
  readonly status = 409;
  readonly code = "base_instance_changed";
}

export class BaseConflictError extends Error {
  readonly status = 409;
}

/** meta 的定额只与列/视图/行数有关，与行内容无关：每次提交都值得查。 */
export function validateBaseShape(meta: BaseMeta, rowCount: number) {
  if (meta.columns.length > BASE_COLUMN_LIMIT) throw new Error("Base 列数超限");
  if (meta.views.length > BASE_VIEW_LIMIT) throw new Error("Base 视图数超限");
  if (rowCount > BASE_ROW_LIMIT) throw new Error("Base 行数不能超过 10000");
}

/** 行级不变量：单行 ≤32 KB、不引用未知列。只对声明变更的行付这份代价。 */
export function validateStoredRows(
  rows: Iterable<BaseRow>,
  columnIds: ReadonlySet<string>
) {
  for (const row of rows) {
    if (Buffer.byteLength(JSON.stringify(row), "utf8") > BASE_ROW_BYTE_LIMIT) {
      throw new Error(`Base row ${row.id} 超过 32 KB`);
    }
    for (const columnId of Object.keys(row.values)) {
      if (!columnIds.has(columnId)) {
        throw new Error(`Base row ${row.id} 引用了未知列 ${columnId}`);
      }
    }
  }
}

/**
 * id 唯一性顺带产出 id→row 索引：两件事同一趟。
 * 索引随状态一起存活，读路径与下一次提交都不必再建。
 */
export function indexRows(rows: readonly BaseRow[]) {
  const byId = new Map<string, BaseRow>();
  for (const row of rows) {
    if (byId.has(row.id)) throw new Error(`Base row id 重复：${row.id}`);
    byId.set(row.id, row);
  }
  return byId;
}

/** 启动加载与整表改写的全量体检；单格提交走 Store 内的增量路径。 */
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
  validateBaseShape(meta, rows.length);
  const rowsById = indexRows(rows);
  validateStoredRows(rows, new Set(meta.columns.map((column) => column.id)));
  serialize.meta(meta);
  serialize.rows(rows);
  validateGalleryLedger(meta, rowsById, gallery, galleryOwnerId(meta));
  serialize.gallery(gallery);
  return rowsById;
}

/**
 * 内存态即真相态：get()/peek() 交出的就是存量对象本体，冻结是唯一的守卫。
 * 只冻结结构（rows 数组/行/values、meta/columns/views）——单元格值是叶子，
 * 没有任何写路径会原地改它，为它再走一趟 O(n·k) 不值。
 */
export function freezeStoredSnapshot(meta: BaseMeta, rows: readonly BaseRow[]) {
  for (const row of rows) {
    if (Object.isFrozen(row)) continue;
    Object.freeze(row.values);
    Object.freeze(row);
  }
  Object.freeze(rows);
  Object.freeze(meta.owner);
  Object.freeze(meta.navigation);
  for (const column of meta.columns) Object.freeze(column);
  Object.freeze(meta.columns);
  for (const view of meta.views) {
    Object.freeze(view.config);
    Object.freeze(view);
  }
  Object.freeze(meta.views);
  Object.freeze(meta);
}

/** 挂载一份状态的唯一入口：冻结 + 建索引 + 记住附件引用集。 */
export function storedBase(input: {
  meta: BaseMeta;
  rows: BaseRow[];
  gallery: BaseGalleryLedger;
  history: BaseHistoryLedger;
  rowsById?: ReadonlyMap<string, BaseRow>;
  attachmentBlobIds?: ReadonlySet<string>;
}): StoredBase {
  freezeStoredSnapshot(input.meta, input.rows);
  return {
    meta: input.meta,
    rows: input.rows,
    rowsById: input.rowsById ?? indexRows(input.rows),
    attachmentBlobIds:
      input.attachmentBlobIds ?? collectRowAttachmentBlobIds(input.rows),
    gallery: input.gallery,
    history: input.history,
  };
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
