/**
 * [INPUT]: Depends on projected Base rows, Gallery config, a canonical BaseCellContext, and stable media occurrence/identity helpers
 * [OUTPUT]: Provides context-aware Gallery tile projection, date groups, visual rows, pinned identities, and virtual-row lookup
 * [POS]: The pure Gallery model; durable tiles come from Base attachment cells while relation/formula titles resolve against the full snapshot
 */

import {
  baseCellText,
  cellValue,
  isBaseAttachmentValue,
  parseBaseDate,
  type BaseCellContext,
  type BaseColumn,
  type BaseRow,
  type BaseViewConfig,
} from "../../../shared/bases-ipc";
import {
  galleryOccurrenceKey,
  gallerySourceLogicalKey,
  type AttachmentGallerySourceRef,
  type GalleryMediaSourceRef,
} from "../../../shared/gallery-media-ipc";

type GalleryItemCommon = {
  id: string;
  logicalKey: string;
  occurredAt: number;
  rowId?: string;
  title?: string;
};

export type GalleryItem =
  | (GalleryItemCommon & { phase: "running"; failed?: boolean })
  | (GalleryItemCommon & {
      phase: "ready";
      sourceRef: GalleryMediaSourceRef;
    });

export type GalleryGroup = {
  id: string;
  label: string;
  items: GalleryItem[];
};

export type GalleryVisualRow =
  | { kind: "header"; id: string; groupId: string; label: string }
  | {
      kind: "items";
      id: string;
      groupId: string;
      items: GalleryItem[];
    };

export type GalleryRowsProjection = {
  ownerKey: string;
  ownerInstanceId: string;
  rows: readonly BaseRow[];
  columns: readonly BaseColumn[];
  context: BaseCellContext;
  config: Extract<BaseViewConfig, { type: "gallery" }>;
};

export function projectGalleryRows(
  projection: GalleryRowsProjection
): GalleryItem[] {
  const attachmentColumn = projection.columns.find(
    (column) =>
      column.id === projection.config.attachmentColumnId &&
      column.type === "attachment"
  );
  if (!attachmentColumn) return [];
  const titleColumn = projection.config.titleColumnId
    ? projection.columns.find(
        (column) => column.id === projection.config.titleColumnId
      )
    : undefined;
  const dateColumn = projection.config.groupByDateColumnId
    ? projection.columns.find(
        (column) =>
          column.id === projection.config.groupByDateColumnId &&
          column.type === "date"
      )
    : undefined;
  const items = projection.rows.flatMap((row): GalleryItem[] => {
    const attachment = row.values[attachmentColumn.id];
    if (!isBaseAttachmentValue(attachment)) return [];
    const occurredAt = dateColumn
      ? (parseBaseDate(row.values[dateColumn.id])?.getTime() ?? Number.NaN)
      : Number.NaN;
    const sourceRef: AttachmentGallerySourceRef = {
      kind: "attachment",
      ownerKey: projection.ownerKey,
      ownerInstanceId: projection.ownerInstanceId,
      rowId: row.id,
      columnId: attachmentColumn.id,
      attachmentId: attachment.attachmentId,
      sourceRevision: attachment.revision,
    };
    const title = titleColumn
      ? baseCellText(
          titleColumn,
          cellValue(row, titleColumn, projection.context)
        ).trim()
      : "";
    return [{
      phase: "ready",
      id: galleryOccurrenceKey(sourceRef),
      logicalKey: gallerySourceLogicalKey(sourceRef),
      occurredAt,
      rowId: row.id,
      ...(title ? { title } : {}),
      sourceRef,
    }];
  });
  if (projection.config.sorts?.length) return items;
  return items.sort((left, right) => {
    const leftMissing = Number.isNaN(left.occurredAt);
    const rightMissing = Number.isNaN(right.occurredAt);
    if (leftMissing !== rightMissing) return leftMissing ? 1 : -1;
    return (
      (leftMissing ? 0 : left.occurredAt - right.occurredAt) ||
      (left.rowId ?? left.id).localeCompare(right.rowId ?? right.id)
    );
  });
}

export function groupGalleryItems(
  items: readonly GalleryItem[],
  options: {
    bucket?: GalleryRowsProjection["config"]["dateBucket"];
    locale?: string;
    grouped: boolean;
    allLabel?: string;
    ungroupedLabel?: string;
  }
): GalleryGroup[] {
  if (!options.grouped) {
    return items.length
      ? [{ id: "all", label: options.allLabel ?? "", items: [...items] }]
      : [];
  }
  const bucket = options.bucket ?? "day";
  const groups = new Map<string, { date?: Date; items: GalleryItem[] }>();
  for (const item of items) {
    if (Number.isNaN(item.occurredAt)) {
      const group = groups.get("ungrouped") ?? { items: [] };
      group.items.push(item);
      groups.set("ungrouped", group);
      continue;
    }
    const date = startOfBucket(new Date(item.occurredAt), bucket);
    const key = `${bucket}:${date.getTime()}`;
    const group = groups.get(key) ?? { date, items: [] };
    group.items.push(item);
    groups.set(key, group);
  }
  return [...groups].map(([id, group]) => ({
    id,
    label: group.date
      ? formatBucket(group.date, bucket, options.locale)
      : options.ungroupedLabel ?? "Ungrouped",
    items: group.items,
  }));
}

function startOfBucket(
  source: Date,
  bucket: NonNullable<GalleryRowsProjection["config"]["dateBucket"]>
) {
  const date = new Date(source);
  date.setSeconds(0, 0);
  if (bucket === "minute") return date;
  date.setMinutes(0);
  if (bucket === "hour") return date;
  date.setHours(0);
  if (bucket === "day") return date;
  if (bucket === "week") {
    date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
    return date;
  }
  date.setDate(1);
  return date;
}

function formatBucket(
  date: Date,
  bucket: NonNullable<GalleryRowsProjection["config"]["dateBucket"]>,
  locale?: string
) {
  const options: Intl.DateTimeFormatOptions =
    bucket === "month"
      ? { year: "numeric", month: "long" }
      : bucket === "day" || bucket === "week"
        ? { year: "numeric", month: "short", day: "numeric" }
        : {
            month: "short",
            day: "numeric",
            hour: "2-digit",
            ...(bucket === "minute" ? { minute: "2-digit" } : {}),
          };
  return new Intl.DateTimeFormat(locale, options).format(date);
}

export function galleryPinnedIds(input: {
  focusIds: ReadonlySet<string>;
  overlayId?: string;
}) {
  const { focusIds, overlayId } = input;
  return new Set([...focusIds, ...(overlayId ? [overlayId] : [])]);
}

export function buildGalleryVisualRows(
  groups: readonly GalleryGroup[],
  columns: number
): GalleryVisualRow[] {
  const safeColumns = Math.max(1, Math.floor(columns));
  return groups.flatMap((group) => [
    ...(group.label
      ? [{
          kind: "header" as const,
          id: `${group.id}:header`,
          groupId: group.id,
          label: group.label,
        }]
      : []),
    ...Array.from(
      { length: Math.ceil(group.items.length / safeColumns) },
      (_, index) => ({
        kind: "items" as const,
        id: `${group.id}:items:${index}`,
        groupId: group.id,
        items: group.items.slice(
          index * safeColumns,
          (index + 1) * safeColumns
        ),
      })
    ),
  ]);
}

export function resolvePinnedVisualRowIndexes(
  rows: readonly GalleryVisualRow[],
  pinnedIds: ReadonlySet<string>
) {
  const indexes = new Set<number>();
  rows.forEach((row, index) => {
    if (
      row.kind === "items" &&
      row.items.some((item) => pinnedIds.has(item.id))
    ) {
      indexes.add(index);
    }
  });
  return indexes;
}
