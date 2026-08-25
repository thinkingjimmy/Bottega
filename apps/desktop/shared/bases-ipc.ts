/**
 * [INPUT]: Depends on the type of base-view-config, base-values and shared/bases attachment DTO; Receive chat/project owner, column/row/naming view, filter AST, chart, gallery and renderer Bases IPC data
 * [OUTPUT]: Provides BaseOwner/ownerKey, Base IPC constants and types, stabilizes XLSX issue code/structured mutation results, owner-native manual attachment bridge, filters projected pure functions and owner-fenced/migration events
 * [POS]: Bases IPC and owner authentication source; The main renderer is shared with an independent MCP server.This file is intended to be free of the zodiac scanner, and the renderer takes an owner from the FromKey that should not be attached to the back of the entire scanner when running
 */

import {
  isBaseAttachmentValue,
  type BaseCellValue,
  type BaseColumn,
  type BaseRow,
} from "./base-values";
import {
  cellValue,
  createBaseCellContext,
  type BaseCellContext,
} from "./base-cell-value";
import type {
  ListGalleryEntriesInput,
  ListGalleryEntriesResult,
  PutAttachmentRequest,
  PutAttachmentResult,
  ReadAttachmentInput,
  ReadAttachmentResult,
  ReadAttachmentThumbnailInput,
  ReadAttachmentThumbnailResult,
} from "./bases/gallery-attachments";
import type {
  BaseCommonViewConfig,
  BaseFilter,
  BaseViewConfig,
} from "./base-view-config";
import type { BaseHistoryEntry } from "./bases/history-ledger-schema";

export { baseCellText, dedupeSelectOptions, formatBaseDate, isBaseAttachmentValue, parseBaseDate } from "./base-values";
export { cellValue, createBaseCellContext, isBaseRelationLabelColumn } from "./base-cell-value";
export type { BaseCellContext } from "./base-cell-value";
export {
  baseFormulaDependencies,
  evaluateBaseFormula,
  findBaseFormulaCycle,
  formulaExpressionForDisplay,
  formulaExpressionForStorage,
  parseBaseFormula,
} from "./base-formula";
export {
  BASE_AGGREGATIONS,
  baseAggregationsForColumn,
  calculateBaseAggregations,
  formatBaseAggregationValue,
} from "./base-aggregations";
export {
  BASE_VIEW_TYPES,
  COLUMN_SCOPED_BASE_VIEW_TYPES,
  GROUPABLE_BASE_VIEW_TYPES,
  GUI_PAGE_MAX_LENGTH,
  isColumnScopedView,
  isGroupableView,
  isValidGuiPage,
  visibleBaseColumns,
} from "./base-view-config";
export type {
  BaseAttachmentValue,
  BaseCellValue,
  BaseColumn,
  BaseColumnType,
  BaseLocation,
  BaseRow,
  BaseSelectOption,
} from "./base-values";
/* 只再导出类型：gallery-attachments 顶层就是 zod schema，值再导出会让每一个
   取 ownerFromKey 的 renderer 文件连带背上整个校验运行时。要它的值就直接引
   `./bases/gallery-attachments`，把这笔体积记在真正用它的人账上。 */
export type * from "./bases/gallery-attachments";
export type {
  BaseAggregation,
  BaseAggregationSetting,
  BaseAggregationValues,
  BaseCommonViewConfig,
  BaseFilter,
  BaseFilterComparison,
  BaseSort,
  BaseViewConfig,
  BaseViewType,
  ChartItem,
  GroupableBaseViewType,
  GroupableViewConfig,
} from "./base-view-config";

export const BASE_CHAT_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
export const BASE_ENTITY_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
export const BASE_OWNER_KEY_PATTERN =
  /^(?:chat|project):[A-Za-z0-9_-]{1,128}$/;
export const BASE_META_BYTE_LIMIT = 1024 * 1024;
export const BASE_ROWS_BYTE_LIMIT = 20 * 1024 * 1024;
export const BASE_ROW_BYTE_LIMIT = 32 * 1024;
export const BASE_ROW_LIMIT = 10_000;
export const BASE_COLUMN_LIMIT = 64;
export const BASE_COLUMN_WIDTH_MIN = 80;
export const BASE_COLUMN_WIDTH_MAX = 640;
export const BASE_VIEW_LIMIT = 32;
export const BASE_SELECT_OPTION_LIMIT = 256;
export const BASE_INSERT_LIMIT = 500;
export const BASE_DELETE_LIMIT = 500;
export const BASE_FILTER_DEPTH_LIMIT = 8;
export const BASE_FILTER_NODE_LIMIT = 64;
export const BASE_EVENT_BYTE_LIMIT = 512 * 1024;
export const BASE_WIRE_BYTE_LIMIT = 1024 * 1024;
export const BASE_CELL_STRING_LIMIT = 16 * 1024;
export const BASE_NAME_LIMIT = 200;
export const CHART_ITEM_LIMIT = 12;

export const BASE_XLSX_ISSUE_REASONS = [
  "cell_too_large",
  "formula_read_only",
  "attachment_not_importable",
  "invalid_relation",
  "relation_target_missing",
  "invalid_text",
  "invalid_number",
  "invalid_date",
  "invalid_select_option",
  "invalid_checkbox",
  "invalid_https_url",
  "invalid_location",
] as const;
export type BaseXlsxIssueReason = (typeof BASE_XLSX_ISSUE_REASONS)[number];
export type BaseXlsxIssue = {
  rowIndex: number;
  columnId: string;
  reason: BaseXlsxIssueReason;
};

export type BaseView = {
  id: string;
  name: string;
  order: number;
  config: BaseViewConfig;
};

export type BaseOwner =
  | { kind: "chat"; chatId: string; incarnationId: string }
  | { kind: "project"; projectId: string };
export type BaseOwnerKey = `chat:${string}` | `project:${string}`;
export type BaseOwnerRef =
  | { kind: "chat"; chatId: string }
  | { kind: "project"; projectId: string };

export function ownerKeyOf(owner: BaseOwner): BaseOwnerKey {
  return owner.kind === "chat"
    ? `chat:${owner.chatId}`
    : `project:${owner.projectId}`;
}

export function ownerFromKey(ownerKey: string): BaseOwnerRef {
  const match = /^(chat|project):([A-Za-z0-9_-]{1,128})$/.exec(ownerKey);
  if (!match) throw new Error("Base ownerKey 格式无效");
  return match[1] === "chat"
    ? { kind: "chat", chatId: match[2]! }
    : { kind: "project", projectId: match[2]! };
}

export type BaseMeta = {
  owner: BaseOwner;
  ownerInstanceId: string;
  name: string;
  pinned: boolean;
  columns: BaseColumn[];
  views: BaseView[];
  activeViewId: string;
  revision: number;
  rowsGeneration: number;
  /** v0 meta 读取时缺失；BaseStore 首次 commit 会物化。 */
  galleryGeneration?: number;
  /** v0 meta 读取时缺失；BaseStore 首次 commit 会物化。 */
  historyGeneration?: number;
};

export type BaseSnapshot = {
  meta: BaseMeta;
  rows: BaseRow[];
  warning?: string;
};

export type BasePinnedSummary = {
  ownerKey: string;
  ownerInstanceId: string;
  name: string;
  revision: number;
};

export type BaseMetaPatch = Partial<
  Pick<
    BaseMeta,
    "name" | "pinned" | "columns" | "views" | "activeViewId"
  >
>;

export type BaseRowPatch = Record<string, BaseCellValue | null>;


export const BASE_MUTATION_OPERATIONS = [
  "meta",
  "row-insert",
  "row-patch",
  "row-delete",
  "attachment-put",
  "json-import",
  "xlsx-import",
] as const;
export type BaseMutationOperation = (typeof BASE_MUTATION_OPERATIONS)[number];
export type BaseCommitAuthorityLeaseId = string;

export type BaseResolvedTarget = {
  ownerKey: string;
  ownerInstanceId: string;
  status: "healthy" | "corrupt" | "absent";
};

export type BasePromotionReceipt = {
  ownerKey: string;
  ownerInstanceId: string;
  revision: number;
};

export type BaseChangedEvent = {
  type: "base-changed";
  ownerKey: string;
  ownerInstanceId: string;
  revision: number;
  meta?: BaseMeta;
  upserts?: BaseRow[];
  removedRowIds?: string[];
};

export type BaseMigrationEvent = {
  type: "base-migrated";
  ownerKey: string;
  ownerInstanceId: string;
  revision: number;
  migration: "row-backed-gallery-v1";
};

/**
 * renderer 应用规则：
 * 1. (ownerKey, ownerInstanceId) 生命周期 fence 失配立即丢弃；
 * 2. revision === last + 1 才应用 delta；无 meta 的行 delta 同步推进 rowsGeneration；
 * 3. revision 跳号或事件省略变化载荷时调用 get 全量重拉。
 */
export type BasesEvent =
  | BaseChangedEvent
  | BaseMigrationEvent
  | {
      type: "removed";
      ownerKey: string;
      ownerInstanceId: string;
    }
  | {
      type: "base-moved";
      from: { ownerKey: string; ownerInstanceId: string };
      to: { ownerKey: string; ownerInstanceId: string };
      revision: number;
      reloadRequired: true;
    }
  | { type: "warning"; message: string };

export type BaseExportResult = {
  cancelled: boolean;
  path?: string;
  bytes?: number;
  rowCount?: number;
};

export type BaseImportResult =
  | { cancelled: true }
  | { cancelled: false; snapshot: BaseSnapshot };

export type BaseMutationError = {
  code: string;
  message: string;
  currentRevision?: number;
  issues?: Array<{ rowIndex: number; columnId: string; reason: string }>;
  /** 可本地化的结构化细节：现在只有 formula_cycle 的环路径列名。 */
  detail?: { columns: string[] };
};

export type BaseMutationSnapshotResult =
  | { ok: true; snapshot: BaseSnapshot }
  | { ok: false; error: BaseMutationError };

export type BaseImportMutationResult =
  | { ok: true; cancelled: true }
  | {
      ok: true;
      cancelled: false;
      snapshot: BaseSnapshot;
      issues?: BaseXlsxIssue[];
    }
  | { ok: false; error: BaseMutationError };

export const BASES_CHANNEL = {
  get: "bases:get",
  ensure: "bases:ensure",
  discardCorrupt: "bases:discard-corrupt",
  listPinned: "bases:list-pinned",
  listProject: "bases:list-project",
  updateMeta: "bases:update-meta",
  authorizeMutation: "bases:authorize-mutation",
  insertRows: "bases:insert-rows",
  patchRow: "bases:patch-row",
  deleteRows: "bases:delete-rows",
  exportCsv: "bases:export-csv",
  exportJson: "bases:export-json",
  importJson: "bases:import-json",
  exportXlsx: "bases:export-xlsx",
  importXlsx: "bases:import-xlsx",
  rowHistory: "bases:row-history",
  putAttachment: "bases:put-attachment",
  readAttachment: "bases:read-attachment",
  readAttachmentThumbnail: "bases:read-attachment-thumbnail",
  listGalleryEntries: "bases:list-gallery-entries",
  resolveForSection: "bases:resolve-for-section",
  promoteToProject: "bases:promote-to-project",
  event: "bases:event",
} as const;

export type BasesBridgeApi = {
  get(input: { ownerKey: string }): Promise<BaseSnapshot | null>;
  ensure(input: { ownerKey: string }): Promise<BaseSnapshot>;
  /** 仅用于显式确认放弃已隔离数据；正常 Base 不可通过此入口删除。 */
  discardCorrupt(input: { ownerKey: string }): Promise<BaseSnapshot>;
  listPinned(): Promise<{ bases: BasePinnedSummary[]; warning?: string }>;
  listProjectBases(): Promise<{ bases: BasePinnedSummary[]; warning?: string }>;
  authorizeMutation(input: {
    ownerKey: string;
    operation: BaseMutationOperation;
    expectedRevision: number | null;
    surfaceLeaseId?: string;
  }): Promise<BaseCommitAuthorityLeaseId>;
  updateMeta(input: {
    ownerKey: string;
    expectedRevision: number;
    patch: BaseMetaPatch;
    authorityLeaseId: BaseCommitAuthorityLeaseId;
  }): Promise<BaseMutationSnapshotResult>;
  insertRows(input: {
    ownerKey: string;
    rows: BaseRow[];
    authorityLeaseId: BaseCommitAuthorityLeaseId;
  }): Promise<BaseSnapshot>;
  /** 字段级 LWW；null 表示清空单元格。 */
  patchRow(input: {
    ownerKey: string;
    rowId: string;
    patch: BaseRowPatch;
    authorityLeaseId: BaseCommitAuthorityLeaseId;
  }): Promise<BaseSnapshot>;
  deleteRows(input: {
    ownerKey: string;
    rowIds: string[];
    expectedRevision: number;
    authorityLeaseId: BaseCommitAuthorityLeaseId;
  }): Promise<BaseMutationSnapshotResult>;
  exportCsv(input: { ownerKey: string }): Promise<BaseExportResult>;
  exportJson(input: { ownerKey: string }): Promise<BaseExportResult>;
  exportXlsx(input: { ownerKey: string }): Promise<BaseExportResult>;
  importJson(input: {
    ownerKey: string;
    expectedRevision: number;
    authorityLeaseId: BaseCommitAuthorityLeaseId;
  }): Promise<BaseImportMutationResult>;
  importXlsx(input: {
    ownerKey: string;
    expectedRevision: number;
    authorityLeaseId: BaseCommitAuthorityLeaseId;
  }): Promise<BaseImportMutationResult>;
  rowHistory(input: {
    ownerKey: string;
    rowId: string;
  }): Promise<{ entries: BaseHistoryEntry[] }>;
  resolveForSection(input: { sectionId: string }): Promise<BaseResolvedTarget>;
  promoteToProject(input: {
    chatId: string;
    requestId: string;
  }): Promise<BasePromotionReceipt>;
  putAttachment?(input: PutAttachmentRequest): Promise<PutAttachmentResult>;
  readAttachment?(input: ReadAttachmentInput): Promise<ReadAttachmentResult>;
  readAttachmentThumbnail?(
    input: ReadAttachmentThumbnailInput
  ): Promise<ReadAttachmentThumbnailResult>;
  listGalleryEntries?(
    input: ListGalleryEntriesInput
  ): Promise<ListGalleryEntriesResult>;
  onBasesEvent(callback: (event: BasesEvent) => void): () => void;
};

function isEmpty(value: BaseCellValue | undefined) {
  return value === undefined || value === "";
}

function scalar(value: BaseCellValue | undefined) {
  if (value && typeof value === "object") {
    return isBaseAttachmentValue(value)
      ? value.filename
      : `${value.lat},${value.lng}`;
  }
  return value;
}

function compare(left: BaseCellValue | undefined, right: BaseCellValue | undefined) {
  const a = scalar(left);
  const b = scalar(right);
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "boolean" && typeof b === "boolean") return Number(a) - Number(b);
  return String(a ?? "").localeCompare(String(b ?? ""), undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

/**
 * context 必填：派生列（formula/relation）的值只存在于读时投影里，
 * 退回 `row.values[...]` 会让公式列在筛选面恒为空。漏传要在编译期红，
 * 不能靠一条静默的回退分支把 bug 藏成「没筛出结果」。
 */
export function evaluateBaseFilter(
  row: BaseRow,
  filter: BaseFilter,
  context: BaseCellContext
): boolean {
  if (filter.kind === "and" || filter.kind === "or") {
    return filter.kind === "and"
      ? filter.filters.every((child) => evaluateBaseFilter(row, child, context))
      : filter.filters.some((child) => evaluateBaseFilter(row, child, context));
  }
  if (filter.kind === "not") {
    return !evaluateBaseFilter(row, filter.filter, context);
  }
  const column = context.columns.get(filter.columnId);
  const current = column
    ? cellValue(row, column, context)
    : row.values[filter.columnId];
  if (filter.operator === "is-empty") return isEmpty(current);
  if (filter.operator === "not-empty") return !isEmpty(current);
  if (filter.operator === "contains") {
    return String(scalar(current) ?? "")
      .toLocaleLowerCase()
      .includes(String(scalar(filter.value) ?? "").toLocaleLowerCase());
  }
  const order = compare(current, filter.value);
  if (filter.operator === "eq") return order === 0;
  if (filter.operator === "neq") return order !== 0;
  if (filter.operator === "gt") return order > 0;
  if (filter.operator === "gte") return order >= 0;
  if (filter.operator === "lt") return order < 0;
  return order <= 0;
}

export function projectBaseRows(
  rows: readonly BaseRow[],
  config: Pick<BaseCommonViewConfig, "filter" | "sorts">,
  columns: readonly BaseColumn[]
) {
  const context = createBaseCellContext({ columns, rows });
  const filtered = config.filter
    ? rows.filter((row) => evaluateBaseFilter(row, config.filter!, context))
    : [...rows];
  const sorts = config.sorts ?? [];
  const sortValue = (row: BaseRow, columnId: string) => {
    const column = context.columns.get(columnId);
    return column ? cellValue(row, column, context) : row.values[columnId];
  };
  return sorts.length
    ? filtered.sort((left, right) => {
        for (const sort of sorts) {
          const result = compare(
            sortValue(left, sort.columnId),
            sortValue(right, sort.columnId)
          );
          if (result) return sort.direction === "asc" ? result : -result;
        }
        return left.id.localeCompare(right.id);
      })
    : filtered;
}

export function filterReferencesColumn(
  filter: BaseFilter | undefined,
  columnId: string
): boolean {
  if (!filter) return false;
  if (filter.kind === "condition") return filter.columnId === columnId;
  if (filter.kind === "not") return filterReferencesColumn(filter.filter, columnId);
  return filter.filters.some((child) => filterReferencesColumn(child, columnId));
}

export function groupBaseRows(
  rows: readonly BaseRow[],
  column: Pick<BaseColumn, "id" | "options"> &
    Partial<Pick<BaseColumn, "name" | "type" | "formula">>,
  columns: readonly BaseColumn[]
) {
  const context = createBaseCellContext({ columns, rows });
  const resolvedColumn = columns.find((candidate) => candidate.id === column.id);
  const projected = rows.map((row) =>
    resolvedColumn
      ? cellValue(row, resolvedColumn, context)
      : row.values[column.id]
  );
  const laneIds = [
    "__none__",
    ...(column.options?.map((option) => option.id) ??
      [...new Set(projected.flatMap((value) =>
        value === undefined || value === "" ? [] : [String(value)]
      ))].sort((left, right) => left.localeCompare(right))),
  ];
  const buckets = new Map(laneIds.map((id) => [id, [] as BaseRow[]]));
  for (const [index, row] of rows.entries()) {
    const id = String(projected[index] ?? "__none__");
    (buckets.get(id) ?? buckets.get("__none__")!).push(row);
  }
  return laneIds.map((id) => ({
    id,
    label:
      id === "__none__"
        ? "Unassigned"
        : column.options?.find((option) => option.id === id)?.label ?? id,
    rows: buckets.get(id)!,
  }));
}
