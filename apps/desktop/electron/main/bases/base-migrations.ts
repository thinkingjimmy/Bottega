/**
 * [INPUT]: Depends on shared Base meta/schema, rows, Gallery ledger and chat-scoped occurrence identity encoded by segment; The start-up period of receiving is not trusted with meta and validated generation data
 * [OUTPUT]: Provides migrate LegacyBaseMeta with migrateGalleryRows, encapsulates embed/legacy Gallery, pending Automatic View; Preserve the replay identity of v2 and change the old three-particle/raw four-particle occurrence atomic keys to canonical v3
 * [POS]: The single owner of bases starts the migration of pure functions; BaseStore is responsible for backup and release only, not for migration branches
 */

import {
  BASE_VIEW_LIMIT,
  isBaseAttachmentValue,
  type BaseColumn,
  type BaseMeta,
  type BaseRow,
} from "../../../shared/bases-ipc";
import { baseMetaSchema } from "../../../shared/bases-schema";
import {
  transcriptOccurrenceId,
  type BaseGalleryLedger,
} from "../../../shared/bases/gallery-attachments";

type MutableLegacyMeta = Omit<BaseMeta, "views" | "columns"> & {
  columns: BaseColumn[];
  views: Array<Record<string, unknown> & {
    id?: string;
    name?: string;
    order?: number;
    config?: Record<string, unknown>;
  }>;
};

const OCCURRENCE_MIGRATION_VERSION = 3;

export function migrateLegacyBaseMeta(
  raw: unknown,
  preferredAttachmentColumnId?: string
) {
  const value = structuredClone(raw) as MutableLegacyMeta;
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    !Array.isArray(value.columns) ||
    !Array.isArray(value.views) ||
    value.views.length === 0
  ) {
    return { meta: baseMetaSchema.parse(raw), changed: false };
  }
  const originalViews = JSON.stringify(value.views);
  let changed = false;
  const views = value.views.flatMap((view) => {
    if (view.config?.type === "embed") {
      changed = true;
      return [];
    }
    if (view.config?.type !== "gallery" || view.config.attachmentColumnId) {
      return [view];
    }
    changed = true;
    return [migrateGalleryView(view, value.columns, preferredAttachmentColumnId)];
  });
  if (!views.length) {
    changed = true;
    views.push(defaultTableView(views));
  }
  const normalized = views
    .sort((left, right) => Number(left.order ?? 0) - Number(right.order ?? 0))
    .map((view, order) => ({ ...view, order }));
  if (JSON.stringify(normalized) !== originalViews) changed = true;
  if (
    !normalized.some((view) => view.id === value.activeViewId)
  ) {
    value.activeViewId = String(normalized[0]!.id);
    changed = true;
  }
  value.views = normalized;
  return { meta: baseMetaSchema.parse(value), changed };
}

function migrateGalleryView(
  view: MutableLegacyMeta["views"][number],
  columns: BaseColumn[],
  preferredAttachmentColumnId?: string
) {
  const attachmentColumnId =
    columns.find(
      (column) =>
        column.id === preferredAttachmentColumnId &&
        column.type === "attachment"
    )?.id ??
    columns.find((column) => column.type === "attachment")?.id ??
    appendColumn(columns, "image", "Image", "attachment");
  const groupByDateColumnId =
    ensureGeneratedColumn(columns, "created_at", "Created at", "date");
  return {
    ...view,
    config: {
      ...view.config,
      type: "gallery",
      attachmentColumnId,
      groupByDateColumnId,
      dateBucket: "minute",
    },
  };
}

function appendColumn(
  columns: BaseColumn[],
  preferred: string,
  name: string,
  type: BaseColumn["type"]
) {
  const id = allocateId(
    new Set(columns.map((column) => column.id)),
    preferred
  );
  columns.push({ id, name, type });
  return id;
}

function ensureGeneratedColumn(
  columns: BaseColumn[],
  preferred: string,
  name: string,
  type: BaseColumn["type"]
) {
  for (let index = 1; index <= 64; index += 1) {
    const id = index === 1 ? preferred : `${preferred}_${index}`;
    const column = columns.find((candidate) => candidate.id === id);
    if (column?.type === type) return id;
    if (!column) {
      columns.push({ id, name, type });
      return id;
    }
  }
  throw new Error(`无法分配 ${preferred} id`);
}

function defaultTableView(views: MutableLegacyMeta["views"]) {
  return {
    id: allocateId(new Set(views.flatMap((view) => view.id ? [view.id] : [])), "table"),
    name: "Table",
    order: 0,
    config: { type: "table" },
  };
}

function allocateId(ids: ReadonlySet<string>, preferred: string) {
  if (!ids.has(preferred)) return preferred;
  for (let index = 2; index <= 64; index += 1) {
    const id = `${preferred}_${index}`;
    if (!ids.has(id)) return id;
  }
  throw new Error(`无法分配 ${preferred} id`);
}

export function migrateGalleryRows(
  currentMeta: BaseMeta,
  currentRows: BaseRow[],
  currentGallery: BaseGalleryLedger
) {
  const meta = structuredClone(currentMeta);
  const rows = structuredClone(currentRows);
  const gallery = structuredClone(currentGallery);
  const metaBefore = JSON.stringify(meta);
  const galleryBefore = JSON.stringify(gallery);
  backfillSourceIdentity(meta, gallery);
  const occurrenceMigrationComplete = migrateOccurrenceIdentity(
    meta,
    gallery,
    (gallery.migrationVersion ?? 0) < OCCURRENCE_MIGRATION_VERSION
  );
  repairPendingAutoGallery(meta, rows, gallery);
  const rowById = new Map(rows.map((row) => [row.id, row]));
  let rowsChanged = false;
  for (const view of meta.views) {
    if (
      view.config.type !== "gallery" ||
      !view.config.groupByDateColumnId
    ) {
      continue;
    }
    gallery.targetDateColumnId ??= view.config.groupByDateColumnId;
    for (const association of Object.values(gallery.associations)) {
      if (association.columnId !== view.config.attachmentColumnId) continue;
      const row = rowById.get(association.rowId);
      const occurrence = gallery.occurrences[association.occurrenceId];
      if (!row || !occurrence || row.values[view.config.groupByDateColumnId]) {
        continue;
      }
      row.values[view.config.groupByDateColumnId] =
        new Date(occurrence.completedAt).toISOString();
      rowsChanged = true;
    }
  }
  gallery.autoGalleryState ??= meta.views.some(
    (view) => view.config.type === "gallery"
  )
    ? "created"
    : "pending";
  gallery.migrationVersion = occurrenceMigrationComplete
    ? Math.max(
        gallery.migrationVersion ?? 0,
        OCCURRENCE_MIGRATION_VERSION
      )
    : Math.min(gallery.migrationVersion ?? 2, 2);
  return {
    meta,
    rows,
    gallery,
    metaChanged: metaBefore !== JSON.stringify(meta),
    rowsChanged,
    galleryChanged: galleryBefore !== JSON.stringify(gallery),
  };
}

function repairPendingAutoGallery(
  meta: BaseMeta,
  rows: BaseRow[],
  gallery: BaseGalleryLedger
) {
  if ((gallery.autoGalleryState ?? "pending") !== "pending") return;
  const rowById = new Map(rows.map((row) => [row.id, row]));
  const columns = new Map(meta.columns.map((column) => [column.id, column]));
  const occurrences = Object.values(gallery.occurrences).filter(
    (occurrence) => {
      const cell = rowById.get(occurrence.rowId)?.values[occurrence.columnId];
      return (
        columns.get(occurrence.columnId)?.type === "attachment" &&
        isBaseAttachmentValue(cell) &&
        cell.attachmentId === occurrence.attachmentId &&
        cell.blobId === occurrence.blobId
      );
    }
  );
  if (!occurrences.length) return;
  if (meta.views.some((view) => view.config.type === "gallery")) {
    gallery.autoGalleryState = "created";
    return;
  }
  if (meta.views.length >= BASE_VIEW_LIMIT) {
    gallery.autoGalleryState = "suppressed";
    return;
  }
  const attachmentColumnId =
    gallery.targetColumnId &&
    columns.get(gallery.targetColumnId)?.type === "attachment" &&
    occurrences.some(
      (occurrence) => occurrence.columnId === gallery.targetColumnId
    )
      ? gallery.targetColumnId
      : occurrences[0]!.columnId;
  const dateColumnId = [
    gallery.targetDateColumnId,
    ...occurrences.map((occurrence) => occurrence.dateColumnId),
  ].find(
    (columnId): columnId is string =>
      Boolean(columnId && columns.get(columnId)?.type === "date")
  );
  if (!dateColumnId) return;
  gallery.targetColumnId ??= attachmentColumnId;
  gallery.targetDateColumnId ??= dateColumnId;
  meta.views.push({
    id: allocateId(new Set(meta.views.map((view) => view.id)), "gallery"),
    name: "Gallery",
    order: meta.views.length,
    config: {
      type: "gallery",
      attachmentColumnId,
      groupByDateColumnId: dateColumnId,
      dateBucket: "minute",
    },
  });
  gallery.autoGalleryState = "created";
}

function backfillSourceIdentity(
  meta: BaseMeta,
  gallery: BaseGalleryLedger
) {
  if (meta.owner.kind !== "chat") return;
  for (const occurrence of Object.values(gallery.occurrences)) {
    if (occurrence.occurrenceId.startsWith("manual:")) continue;
    occurrence.sourceChatId ??= meta.owner.chatId;
    occurrence.sourceIncarnationId ??= meta.ownerInstanceId;
  }
}

function migrateOccurrenceIdentity(
  meta: BaseMeta,
  gallery: BaseGalleryLedger,
  migrateRawFourPart: boolean
) {
  let complete = true;
  const rewrites = new Map<string, string>();
  const occurrences: BaseGalleryLedger["occurrences"] = {};
  for (const [key, occurrence] of Object.entries(gallery.occurrences)) {
    const sourceChatId =
      occurrence.sourceChatId ??
      (meta.owner.kind === "chat" ? meta.owner.chatId : undefined);
    const sourceIncarnationId =
      occurrence.sourceIncarnationId ??
      (meta.owner.kind === "chat" ? meta.ownerInstanceId : undefined);
    const nextId = canonicalStoredOccurrenceId({
      occurrenceId: occurrence.occurrenceId,
      sourceChatId,
      sourceIncarnationId,
      assistantSeq: occurrence.assistantSeq,
      logicalKey: occurrence.logicalKey,
      migrateRawFourPart,
    });
    if (isLegacyOccurrenceId(nextId)) complete = false;
    rewrites.set(key, nextId);
    rewrites.set(occurrence.occurrenceId, nextId);
    if (occurrences[nextId]) {
      throw new Error(`Gallery occurrence 重键冲突：${nextId}`);
    }
    occurrences[nextId] = { ...occurrence, occurrenceId: nextId };
  }
  gallery.occurrences = occurrences;
  for (const association of Object.values(gallery.associations)) {
    association.occurrenceId =
      rewrites.get(association.occurrenceId) ??
      canonicalStoredOccurrenceId({
        occurrenceId: association.occurrenceId,
        sourceChatId:
          meta.owner.kind === "chat" ? meta.owner.chatId : undefined,
        sourceIncarnationId:
          meta.owner.kind === "chat" ? meta.ownerInstanceId : undefined,
        logicalKey: association.logicalKey,
        migrateRawFourPart,
      });
    if (isLegacyOccurrenceId(association.occurrenceId)) complete = false;
  }
  const tombstones: BaseGalleryLedger["tombstones"] = {};
  for (const tombstone of Object.values(gallery.tombstones)) {
    const nextId =
      rewrites.get(tombstone.occurrenceId) ??
      canonicalStoredOccurrenceId({
        occurrenceId: tombstone.occurrenceId,
        sourceChatId:
          meta.owner.kind === "chat" ? meta.owner.chatId : undefined,
        sourceIncarnationId:
          meta.owner.kind === "chat" ? meta.ownerInstanceId : undefined,
        migrateRawFourPart,
      });
    if (isLegacyOccurrenceId(nextId)) complete = false;
    if (tombstones[nextId]) {
      throw new Error(`Gallery tombstone 重键冲突：${nextId}`);
    }
    tombstones[nextId] = { ...tombstone, occurrenceId: nextId };
  }
  gallery.tombstones = tombstones;
  return complete;
}

function canonicalStoredOccurrenceId(input: {
  occurrenceId: string;
  sourceChatId?: string;
  sourceIncarnationId?: string;
  assistantSeq?: number;
  logicalKey?: string;
  migrateRawFourPart: boolean;
}) {
  const {
    occurrenceId,
    sourceChatId,
    sourceIncarnationId,
    assistantSeq,
    logicalKey,
    migrateRawFourPart,
  } = input;
  if (occurrenceId.startsWith("manual:")) return occurrenceId;
  const threePart = /^([A-Za-z0-9_-]{1,128}):(\d+):([^:]{1,256})$/.exec(
    occurrenceId
  );
  const fourPart = /^([A-Za-z0-9_-]{1,128}):([A-Za-z0-9_-]{1,128}):(\d+):([^:]{1,256})$/.exec(
    occurrenceId
  );
  if (!threePart && !fourPart) return occurrenceId;
  if (!sourceChatId || !sourceIncarnationId) return occurrenceId;
  const sequence = assistantSeq ?? Number(threePart?.[2] ?? fourPart?.[3]);
  const logicalItemId = transcriptItemId(
    logicalKey,
    sourceChatId,
    sourceIncarnationId,
    sequence
  );
  if (fourPart && !logicalItemId && !migrateRawFourPart) return occurrenceId;
  const itemId =
    logicalItemId ?? threePart?.[3] ?? fourPart?.[4];
  if (!itemId) return occurrenceId;
  return transcriptOccurrenceId({
    chatId: sourceChatId,
    incarnationId: sourceIncarnationId,
    assistantSeq: sequence,
    itemId,
  });
}

function transcriptItemId(
  logicalKey: string | undefined,
  chatId: string,
  incarnationId: string,
  assistantSeq: number
) {
  if (!logicalKey) return undefined;
  const scopedPrefix = `transcript:${chatId}:${incarnationId}:${assistantSeq}:`;
  if (logicalKey.startsWith(scopedPrefix)) {
    return logicalKey.slice(scopedPrefix.length) || undefined;
  }
  const legacyPrefix = `transcript:${assistantSeq}:`;
  return logicalKey.startsWith(legacyPrefix)
    ? logicalKey.slice(legacyPrefix.length) || undefined
    : undefined;
}

function isLegacyOccurrenceId(occurrenceId: string) {
  return /^[A-Za-z0-9_-]{1,128}:\d+:[^:]{1,256}$/.test(occurrenceId);
}
