/**
 * [INPUT]: Depends on shared Gallery ledger/attachment schema and Base meta/rows; Receiving immutable occurrence payload
 * [OUTPUT]: Provides empty/parse/put/remove/validate Pure state machine, rows attachment blob, reference collection, automatic Gallery Delete suppression, redirect to GalleryLedgerConflictError
 * [POS]: The core of the Gallery ledger for bases/stores; The full fingerprint is the only proof of the existence of any conflict written in IO before zero
 */

import {
  BASE_GALLERY_LEDGER_BYTE_LIMIT,
  BASE_GALLERY_LEDGER_ENTRY_LIMIT,
  baseGalleryLedgerSchema,
  type BaseGalleryLedger,
  type GalleryOccurrence,
} from "../../../../shared/bases/gallery-attachments";
import {
  isBaseAttachmentValue,
  type BaseMeta,
  type BaseRow,
} from "../../../../shared/bases-ipc";

export class GalleryLedgerConflictError extends Error {
  readonly status = 409;
  readonly code = "ATTACHMENT_CONFLICT";
}

export class GalleryLedgerBudgetError extends Error {
  readonly status = 413;
  readonly code = "BUDGET_EXCEEDED";
  readonly retryable = false;
}

export function emptyGalleryLedger(
  chatId: string,
  incarnationId: string
): BaseGalleryLedger {
  return {
    schemaVersion: 1,
    chatId,
    incarnationId,
    epoch: 0,
    autoGalleryState: "pending",
    migrationVersion: 3,
    associations: {},
    occurrences: {},
    tombstones: {},
    aliases: {},
  };
}

export function parseGalleryLedger(
  value: unknown,
  chatId: string,
  incarnationId: string
) {
  const parsed = baseGalleryLedgerSchema.parse(value);
  if (
    parsed.chatId !== chatId ||
    parsed.incarnationId !== incarnationId
  ) {
    throw new Error("Gallery ledger identity 与 Base 不一致");
  }
  assertLedgerBudget(parsed);
  return parsed;
}

export function putGalleryOccurrence(
  current: BaseGalleryLedger,
  occurrence: GalleryOccurrence,
  now: number
) {
  const ledger = structuredClone(current);
  if (ledger.tombstones[occurrence.occurrenceId]) {
    throw new GalleryLedgerConflictError(
      `Occurrence ${occurrence.occurrenceId} 已删除，禁止复活`
    );
  }
  const existing = ledger.occurrences[occurrence.occurrenceId];
  if (existing) {
    if (existing.fingerprint !== occurrence.fingerprint) {
      throw new GalleryLedgerConflictError(
        `Occurrence ${occurrence.occurrenceId} immutable payload 冲突`
      );
    }
    // 幂等重放要求 association 仍然指向同一 cell；association 缺失
    // 说明该 occurrence 曾被删除（tombstone 可能已被压缩），不得伪造成功。
    const association =
      ledger.associations[`${occurrence.rowId}:${occurrence.columnId}`];
    if (!association || association.occurrenceId !== occurrence.occurrenceId) {
      throw new GalleryLedgerConflictError(
        `Occurrence ${occurrence.occurrenceId} 的 association 已删除，禁止复活`
      );
    }
    return { ledger: current, idempotent: true };
  }
  const galleryItemId = `${occurrence.rowId}:${occurrence.columnId}`;
  const occupied = ledger.associations[galleryItemId];
  if (occupied && occupied.occurrenceId !== occurrence.occurrenceId) {
    throw new GalleryLedgerConflictError(
      `Gallery item ${galleryItemId} 已属于其它 occurrence`
    );
  }
  ledger.occurrences[occurrence.occurrenceId] = occurrence;
  ledger.associations[galleryItemId] = {
    galleryItemId,
    occurrenceId: occurrence.occurrenceId,
    logicalKey: occurrence.logicalKey,
    attachmentId: occurrence.attachmentId,
    rowId: occurrence.rowId,
    columnId: occurrence.columnId,
    createdAt: now,
  };
  ledger.aliases[occurrence.logicalKey] = galleryItemId;
  ledger.targetColumnId ??= occurrence.columnId;
  assertLedgerBudget(ledger);
  return { ledger, idempotent: false };
}

export function removeGalleryRows(
  current: BaseGalleryLedger,
  rowIds: ReadonlySet<string>,
  now: number
) {
  return removeAssociations(
    current,
    (association) => rowIds.has(association.rowId),
    now
  );
}

export function removeGalleryColumns(
  current: BaseGalleryLedger,
  columnIds: ReadonlySet<string>,
  now: number
) {
  const next = removeAssociations(
    current,
    (association) => columnIds.has(association.columnId),
    now
  );
  if (next.targetColumnId && columnIds.has(next.targetColumnId)) {
    delete next.targetColumnId;
  }
  if (next.targetDateColumnId && columnIds.has(next.targetDateColumnId)) {
    delete next.targetDateColumnId;
  }
  return next;
}

export function removeGalleryCells(
  current: BaseGalleryLedger,
  galleryItemIds: ReadonlySet<string>,
  now: number
) {
  return removeAssociations(
    current,
    (association) => galleryItemIds.has(association.galleryItemId),
    now
  );
}

/**
 * 从 rows/meta 前后差分派生 Gallery 删除（cell 覆写、删行、删列）；
 * 无删除返回 null，调用方保持原 ledger identity。
 */
export function deriveGalleryRemovals(
  current: {
    gallery: BaseGalleryLedger;
    rows: readonly BaseRow[];
    meta: BaseMeta;
  },
  next: { rows: readonly BaseRow[]; meta: BaseMeta },
  now: number
): BaseGalleryLedger | null {
  const nextRows = new Map(next.rows.map((row) => [row.id, row]));
  const removedCells = new Set(
    Object.values(current.gallery.associations)
      .filter((association) => {
        const value = nextRows.get(association.rowId)?.values[
          association.columnId
        ];
        return (
          !isBaseAttachmentValue(value) ||
          value.attachmentId !== association.attachmentId
        );
      })
      .map((association) => association.galleryItemId)
  );
  const nextRowIds = new Set(next.rows.map((row) => row.id));
  const removedRows = new Set(
    current.rows
      .filter((row) => !nextRowIds.has(row.id))
      .map((row) => row.id)
  );
  const nextColumnIds = new Set(next.meta.columns.map((column) => column.id));
  const removedColumns = new Set(
    current.meta.columns
      .filter((column) => !nextColumnIds.has(column.id))
      .map((column) => column.id)
  );
  const autoGalleryDeleted =
    current.gallery.autoGalleryState === "created" &&
    current.meta.views.some((view) => view.config.type === "gallery") &&
    !next.meta.views.some((view) => view.config.type === "gallery");
  if (
    !removedRows.size &&
    !removedColumns.size &&
    !removedCells.size &&
    !autoGalleryDeleted
  ) {
    return null;
  }
  const gallery = removeGalleryColumns(
    removeGalleryRows(
      removeGalleryCells(current.gallery, removedCells, now),
      removedRows,
      now
    ),
    removedColumns,
    now
  );
  if (autoGalleryDeleted) gallery.autoGalleryState = "suppressed";
  return gallery;
}

/**
 * Blob 的生命周期只由 row cell 决定。Ledger 只是自动入库的幂等账本，
 * association 丢失或压缩不得改变用户 row 的文件所有权。
 */
export function collectRowAttachmentBlobIds(rows: readonly BaseRow[]) {
  const referenced = new Set<string>();
  for (const row of rows) {
    for (const value of Object.values(row.values)) {
      if (isBaseAttachmentValue(value)) referenced.add(value.blobId);
    }
  }
  return referenced;
}

export function validateGalleryLedger(
  meta: BaseMeta,
  rows: readonly BaseRow[],
  ledger: BaseGalleryLedger,
  /** owner 投影由调用方经 base-files 的 galleryOwnerId 提供——此处不反向依赖文件层。 */
  ownerId: string
) {
  if (
    ledger.chatId !== ownerId ||
    ledger.incarnationId !== meta.ownerInstanceId
  ) {
    throw new Error("Gallery ledger 与 Base identity 不一致");
  }
  const columns = new Map(meta.columns.map((column) => [column.id, column]));
  const rowMap = new Map(rows.map((row) => [row.id, row]));
  for (const association of Object.values(ledger.associations)) {
    const occurrence = ledger.occurrences[association.occurrenceId];
    if (!occurrence) {
      throw new Error(
        `Association ${association.galleryItemId} 缺少 occurrence`
      );
    }
    if (ledger.tombstones[association.occurrenceId]) {
      throw new Error("Gallery occurrence 与 tombstone 互斥");
    }
    const column = columns.get(association.columnId);
    if (column?.type !== "attachment") {
      throw new Error(
        `Gallery association 指向无效 attachment 列 ${association.columnId}`
      );
    }
    const cell = rowMap.get(association.rowId)?.values[association.columnId];
    if (
      !isBaseAttachmentValue(cell) ||
      cell.attachmentId !== association.attachmentId ||
      cell.blobId !== occurrence.blobId
    ) {
      throw new Error(
        `Gallery association ${association.galleryItemId} 与 row cell 不一致`
      );
    }
  }
  if (
    ledger.targetColumnId &&
    columns.get(ledger.targetColumnId)?.type !== "attachment"
  ) {
    throw new Error("Gallery targetColumnId 必须指向 attachment 列");
  }
  assertLedgerBudget(ledger);
}

function removeAssociations(
  current: BaseGalleryLedger,
  predicate: (
    association: BaseGalleryLedger["associations"][string]
  ) => boolean,
  now: number
) {
  const ledger = structuredClone(current);
  for (const [galleryItemId, association] of Object.entries(
    ledger.associations
  )) {
    if (!predicate(association)) continue;
    delete ledger.associations[galleryItemId];
    delete ledger.aliases[association.logicalKey];
    ledger.tombstones[association.occurrenceId] = {
      occurrenceId: association.occurrenceId,
      deletedAt: now,
      epoch: ledger.epoch,
    };
  }
  assertLedgerBudget(ledger);
  return ledger;
}

function assertLedgerBudget(ledger: BaseGalleryLedger) {
  const entries =
    Object.keys(ledger.associations).length +
    Object.keys(ledger.occurrences).length +
    Object.keys(ledger.tombstones).length;
  if (entries > BASE_GALLERY_LEDGER_ENTRY_LIMIT) {
    throw new GalleryLedgerBudgetError("Gallery ledger entries 超过 10000");
  }
  if (
    Buffer.byteLength(JSON.stringify(ledger), "utf8") >
    BASE_GALLERY_LEDGER_BYTE_LIMIT
  ) {
    throw new GalleryLedgerBudgetError("Gallery ledger 超过 2 MiB");
  }
}
