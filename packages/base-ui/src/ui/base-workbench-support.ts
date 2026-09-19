/**
 * [INPUT]: Depends on shared Base snapshot/view/attachment DTOs, chart defaults, and browser FileReader
 * [OUTPUT]: Provides the shared baseEntityId generator, localized starter factories, view preparation, view-config transforms, Gallery CAS/upload preparation, visible-column projection, and file reads
 * [POS]: Shared Base presentation in ui.
 */

import type {
  BaseAggregation,
  BaseColumn,
  BaseColumnType,
  BaseMetaPatch,
  BaseSelectOption,
  BaseSnapshot,
  BaseView,
  BaseViewConfig,
  PutAttachmentInput,
} from "@ai-chat/base-ui/model/bases-ipc";
import {
  BASE_COLUMN_LIMIT,
  isColumnScopedView,
  isGroupableView,
  visibleBaseColumns,
} from "@ai-chat/base-ui/model/bases-ipc";
import { guessChartItem } from "./views/chart/base-chart-view";
import { BaseMutationReloadError } from "./state/base-mutation-error";

const SUPPORTED_IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
] as const);

function isSupportedImageType(
  value: string
): value is "image/png" | "image/jpeg" | "image/webp" | "image/gif" {
  return SUPPORTED_IMAGE_TYPES.has(value as never);
}

function fileDataUrl(file: File, fallbackMessage: string) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error(fallbackMessage));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(file);
  });
}

export function baseEntityId(prefix: string) {
  return `${prefix}_${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`;
}

export function prepareNewView(
  type: BaseViewConfig["type"],
  columns: BaseColumn[],
  columnNames: { image: string; createdAt: string }
): { columns: BaseColumn[]; config: BaseViewConfig } {
  const preparedColumns = [...columns];
  const firstOfType = (columnType: BaseColumnType) =>
    preparedColumns.find((column) => column.type === columnType)?.id;
  switch (type) {
    case "list":
    case "kanban":
      return {
        columns: preparedColumns,
        config: { type, groupByColumnId: firstOfType("select") },
      };
    case "map":
      return {
        columns: preparedColumns,
        config: {
          type,
          locationColumnId: firstOfType("location"),
          labelColumnId: firstOfType("text"),
        },
      };
    case "chart":
      return {
        columns: preparedColumns,
        config: { type, charts: [guessChartItem(columns)] },
      };
    case "gallery":
      return prepareGalleryView(preparedColumns, firstOfType, columnNames);
    default:
      return { columns: preparedColumns, config: { type } };
  }
}

function prepareGalleryView(
  columns: BaseColumn[],
  firstOfType: (type: BaseColumnType) => string | undefined,
  columnNames: { image: string; createdAt: string }
): { columns: BaseColumn[]; config: BaseViewConfig } {
  const existingAttachment = firstOfType("attachment");
  const attachmentColumnId =
    existingAttachment ?? allocateColumn(columns, "image");
  if (!existingAttachment) {
    columns.push({
      id: attachmentColumnId,
      name: columnNames.image,
      type: "attachment",
    });
  }
  const groupByDateColumnId = findGeneratedColumn(
    columns,
    "created_at",
    "date"
  );
  if (!columns.some((column) => column.id === groupByDateColumnId)) {
    columns.push({
      id: groupByDateColumnId,
      name: columnNames.createdAt,
      type: "date",
    });
  }
  return {
    columns,
    config: {
      type: "gallery",
      attachmentColumnId,
      groupByDateColumnId,
      dateBucket: "day",
    },
  };
}

function findGeneratedColumn(
  columns: BaseColumn[],
  preferred: string,
  type: BaseColumnType
) {
  for (let index = 1; index <= BASE_COLUMN_LIMIT; index += 1) {
    const id = index === 1 ? preferred : `${preferred}_${index}`;
    const column = columns.find((candidate) => candidate.id === id);
    if (!column || column.type === type) return id;
  }
  throw new Error("Base column limit exceeded");
}

function allocateColumn(columns: BaseColumn[], preferred: string) {
  if (!columns.some((column) => column.id === preferred)) return preferred;
  for (let index = 2; index <= BASE_COLUMN_LIMIT; index += 1) {
    const id = `${preferred}_${index}`;
    if (!columns.some((column) => column.id === id)) return id;
  }
  throw new Error("Base column limit exceeded");
}

export function visibleColumns(columns: BaseColumn[], view: BaseView) {
  return visibleBaseColumns(
    columns,
    isColumnScopedView(view.config) ? view.config.visibleColumnIds : undefined
  );
}

export function starterSelectOptions(labels: {
  todo: string;
  doing: string;
  done: string;
}): BaseSelectOption[] {
  return [
    { id: "todo", label: labels.todo },
    { id: "doing", label: labels.doing },
    { id: "done", label: labels.done },
  ];
}

export function withTableColumnWidth(
  config: BaseViewConfig,
  columnId: string,
  width: number
): BaseViewConfig {
  if (config.type !== "table") throw new Error("Active Base view is not a Table");
  return {
    ...config,
    columnWidths: { ...config.columnWidths, [columnId]: width },
  };
}

export function withTableAggregation(
  config: BaseViewConfig,
  columnId: string,
  aggregation?: BaseAggregation
): BaseViewConfig {
  if (config.type !== "table") throw new Error("Active Base view is not a Table");
  return {
    ...config,
    columnAggregations: {
      ...config.columnAggregations,


      [columnId]: aggregation ?? null,
    },
  };
}

export function withGroupBy(
  config: BaseViewConfig,
  groupByColumnId: string
): BaseViewConfig {
  if (!isGroupableView(config)) {
    throw new Error("Active Base view does not support grouping");
  }
  return { ...config, groupByColumnId: groupByColumnId || undefined };
}

export function withVisibleColumns(
  config: BaseViewConfig,
  columnIds: string[],
  totalColumns: number
): BaseViewConfig {
  if (!isColumnScopedView(config)) {
    throw new Error("Active Base view does not support visible columns");
  }
  return {
    ...config,
    visibleColumnIds:
      columnIds.length === totalColumns ? undefined : columnIds,
  };
}

export function withMapColumn(
  config: BaseViewConfig,
  key: "locationColumnId" | "labelColumnId",
  columnId: string
): BaseViewConfig {
  if (config.type !== "map") throw new Error("Active Base view is not a Map");
  return { ...config, [key]: columnId || undefined };
}

type GalleryConfig = Extract<BaseViewConfig, { type: "gallery" }>;
const galleryViewChangedKey = "bases.workbench.galleryViewChanged";

export function patchLatestGalleryConfig(
  latest: BaseSnapshot,
  viewId: string,
  patch: Partial<Omit<GalleryConfig, "type">>
): BaseMetaPatch {
  const view = latest.meta.views.find((candidate) => candidate.id === viewId);
  if (!view || view.config.type !== "gallery") {
    throw new BaseMutationReloadError(galleryViewChangedKey);
  }
  const config: GalleryConfig = { ...view.config, ...patch };
  requireColumn(
    latest,
    config.attachmentColumnId,
    "attachment",
    "bases.workbench.galleryAttachmentChanged"
  );
  if (config.titleColumnId) {
    requireColumn(
      latest,
      config.titleColumnId,
      undefined,
      "bases.workbench.galleryTitleChanged"
    );
  }
  if (config.groupByDateColumnId) {
    requireColumn(
      latest,
      config.groupByDateColumnId,
      "date",
      "bases.workbench.galleryDateChanged"
    );
  }
  return {
    views: latest.meta.views.map((candidate) =>
      candidate.id === view.id ? { ...candidate, config } : candidate
    ),
  };
}

function requireColumn(
  snapshot: BaseSnapshot,
  columnId: string,
  type: BaseColumnType | undefined,
  errorKey: string
) {
  const column = snapshot.meta.columns.find((candidate) => candidate.id === columnId);
  if (!column || (type && column.type !== type)) {
    throw new BaseMutationReloadError(errorKey);
  }
}

export async function prepareGalleryUpload(input: {
  ownerKey: string;
  ownerInstanceId: string;
  expectedRevision: number;
  rowId: string;
  columnId: string;
  file?: File;
  attachmentRequiredMessage: string;
  unsupportedImageMessage: string;
  fileReadFailedMessage: string;
}): Promise<PutAttachmentInput> {
  const file = input.file;
  if (!file) throw new Error(input.attachmentRequiredMessage);
  if (!isSupportedImageType(file.type)) {
    throw new Error(input.unsupportedImageMessage);
  }
  return {
    ownerKey: input.ownerKey,
    ownerInstanceId: input.ownerInstanceId,
    expectedRevision: input.expectedRevision,
    opId: crypto.randomUUID(),
    rowId: input.rowId,
    columnId: input.columnId,
    filename: file.name,
    mediaType: file.type,
    dataUrl: await fileDataUrl(file, input.fileReadFailedMessage),
  };
}
