/**
 * [INPUT]: Depends on shared Base snapshot/View/attachment DTO, column narrowing of the native language, Chart default inference and browser FileReader
 * [OUTPUT]: Provides Workbench's new View Factory, five view config, pure conversion, column width/column statistics/grouping/field visibility/map column, latest-snapshot Gallery config patch, owner-native input, column projections and file readings in the original language
 * [POS]: The stateless support layer for components/bases; BaseWorkbench maintains the sorting and mutation, and the certainty-preparation logic is focused on this
 */

import type {
  BaseAggregation,
  BaseColumn,
  BaseColumnType,
  BaseMetaPatch,
  BaseSnapshot,
  BaseView,
  BaseViewConfig,
  PutAttachmentInput,
} from "../../../shared/bases-ipc";
import {
  isColumnScopedView,
  isGroupableView,
  visibleBaseColumns,
} from "../../../shared/bases-ipc";
import { guessChartItem } from "./views/chart/base-chart-view";
import { BaseMutationReloadError } from "./state/base-mutation-error";

const SUPPORTED_IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
] as const);

export function isSupportedImageType(
  value: string
): value is "image/png" | "image/jpeg" | "image/webp" | "image/gif" {
  return SUPPORTED_IMAGE_TYPES.has(value as never);
}

export function fileDataUrl(file: File, fallbackMessage: string) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error(fallbackMessage));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(file);
  });
}

/** 六种视图只有一个工厂；Gallery 的列补齐与 config 永远作为同一份结果返回。 */
export function prepareNewView(
  type: BaseViewConfig["type"],
  columns: BaseColumn[]
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
      return prepareGalleryView(preparedColumns, firstOfType);
    default:
      return { columns: preparedColumns, config: { type } };
  }
}

function prepareGalleryView(
  columns: BaseColumn[],
  firstOfType: (type: BaseColumnType) => string | undefined
): { columns: BaseColumn[]; config: BaseViewConfig } {
  const existingAttachment = firstOfType("attachment");
  const attachmentColumnId =
    existingAttachment ?? allocateColumn(columns, "image");
  if (!existingAttachment) {
    columns.push({ id: attachmentColumnId, name: "Image", type: "attachment" });
  }
  const groupByDateColumnId = findGeneratedColumn(
    columns,
    "created_at",
    "date"
  );
  if (!columns.some((column) => column.id === groupByDateColumnId)) {
    columns.push({
      id: groupByDateColumnId,
      name: "Created at",
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
  for (let index = 1; index <= 64; index += 1) {
    const id = index === 1 ? preferred : `${preferred}_${index}`;
    const column = columns.find((candidate) => candidate.id === id);
    if (!column || column.type === type) return id;
  }
  throw new Error("Base 列数超限");
}

function allocateColumn(columns: BaseColumn[], preferred: string) {
  if (!columns.some((column) => column.id === preferred)) return preferred;
  for (let index = 2; index <= 64; index += 1) {
    const id = `${preferred}_${index}`;
    if (!columns.some((column) => column.id === id)) return id;
  }
  throw new Error("Base 列数超限");
}

export function visibleColumns(columns: BaseColumn[], view: BaseView) {
  return visibleBaseColumns(
    columns,
    isColumnScopedView(view.config) ? view.config.visibleColumnIds : undefined
  );
}

export function titleCase(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/* ============================================================================
 * 视图 config 的纯变换
 *
 * 五个 setter 的骨架完全相同：先确认「当前视图确实支持这件事」，再原样
 * 合并出新 config，差异只在合并的那一行。留在 Workbench 里它们是五段各自
 * 带类型守卫的样板；提到这里就成了可单测的纯函数，Workbench 只剩「谁触发、
 * 走哪条 CAS」。守卫抛的是开发期契约违例，不是给用户看的话，故不进目录。
 * ========================================================================== */

export function withTableColumnWidth(
  config: BaseViewConfig,
  columnId: string,
  width: number
): BaseViewConfig {
  if (config.type !== "table") throw new Error("Active Base view 不是 Table");
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
  if (config.type !== "table") throw new Error("Active Base view 不是 Table");
  return {
    ...config,
    columnAggregations: {
      ...config.columnAggregations,
      // 显式 null 与「没写过」是两回事：前者是用户关掉了统计，数字列的
      // 默认 Sum 不该在下次渲染时又长回来。
      [columnId]: aggregation ?? null,
    },
  };
}

export function withGroupBy(
  config: BaseViewConfig,
  groupByColumnId: string
): BaseViewConfig {
  if (!isGroupableView(config)) {
    throw new Error("Active Base view 不支持分组");
  }
  return { ...config, groupByColumnId: groupByColumnId || undefined };
}

/**
 * 全显时把字段清空而不是落一份全量清单——留着清单，下次新增的列就会
 * 因「不在清单里」而默认隐身，用户既没藏它，也没有任何提示说它被藏了。
 */
export function withVisibleColumns(
  config: BaseViewConfig,
  columnIds: string[],
  totalColumns: number
): BaseViewConfig {
  if (!isColumnScopedView(config)) {
    throw new Error("Active Base view 不支持字段可见性");
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
  if (config.type !== "map") throw new Error("Active Base view 不是 Map");
  return { ...config, [key]: columnId || undefined };
}

type GalleryConfig = Extract<BaseViewConfig, { type: "gallery" }>;

/**
 * 只把用户本次改动合并到刚刚从 main 读取的 config；渲染期旧 config 绝不回写。
 * 列删除与设置点击并发时抛显式 reload error，由 Workbench 的 run() 全量回载。
 */
export function patchLatestGalleryConfig(
  latest: BaseSnapshot,
  viewId: string,
  patch: Partial<Omit<GalleryConfig, "type">>
): BaseMetaPatch {
  const view = latest.meta.views.find((candidate) => candidate.id === viewId);
  if (!view || view.config.type !== "gallery") {
    throw new BaseMutationReloadError(
      "Gallery 视图已被删除或改为其它类型，请重试"
    );
  }
  const config: GalleryConfig = { ...view.config, ...patch };
  requireColumn(latest, config.attachmentColumnId, "attachment", "图片");
  if (config.titleColumnId) {
    requireColumn(latest, config.titleColumnId, undefined, "标题");
  }
  if (config.groupByDateColumnId) {
    requireColumn(latest, config.groupByDateColumnId, "date", "日期分组");
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
  label: string
) {
  const column = snapshot.meta.columns.find((candidate) => candidate.id === columnId);
  if (!column || (type && column.type !== type)) {
    throw new BaseMutationReloadError(
      `Gallery ${label}列已被删除或类型已变化，请重新选择`
    );
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
