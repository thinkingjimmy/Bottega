/**
 * [INPUT]: Depends on shared Base column/line/meta type, attachment/date/formula/relation label helpers and base-view-validation
 * [OUTPUT]: Provides assertStableColumnTypes, validateBaseModel/Row/Cell, unified renderer/MCP mutation value range, formula static/loop and relation non-recursive display column algebra; All errors with status + code differentiation
 * [POS]: The normal mutation of bases is the pure test layer; BasesService only organizes CAS/commit/event
 */

import {
  BASE_COLUMN_LIMIT,
  findBaseFormulaCycle,
  isBaseRelationLabelColumn,
  isBaseAttachmentValue,
  parseBaseDate,
  parseBaseFormula,
  type BaseCellValue,
  type BaseColumn,
  type BaseMeta,
  type BaseRow,
} from "../../../shared/bases-ipc";
import { validateBaseView } from "./base-view-validation";

export function assertStableColumnTypes(
  before: BaseColumn[],
  after: BaseColumn[]
) {
  if (after.length > BASE_COLUMN_LIMIT) throw new Error("Base 列数超限");
  for (const column of before) {
    const next = after.find((candidate) => candidate.id === column.id);
    if (next && next.type !== column.type) {
      throw new Error(`列 ${column.id} 不允许原地改变类型`);
    }
  }
}

export function validateBaseModel(meta: BaseMeta, rows: BaseRow[]) {
  const columns = new Map(meta.columns.map((column) => [column.id, column]));
  for (const column of meta.columns) {
    if (column.type !== "formula" || !column.formula) continue;
    const parsed = parseBaseFormula(column.formula.expression, meta.columns);
    if (!parsed.ok) {
      throw statusError(
        400,
        "formula_invalid",
        `列 ${column.name} 的公式无效：${parsed.message}`
      );
    }
    const invalid = new Set(column.formula.invalidReferences ?? []);
    /* 删列会把引用打成悬垂：resultType 必然随之漂移（number → text），
       此时 #REF! 才是唯一诚实的表达——再拿落盘 resultType 复检就等于
       让删列永远提交不上去。悬垂存在即免检，与下面的依赖检查同一宽容。 */
    if (!invalid.size && parsed.value.resultType !== column.formula.resultType) {
      throw statusError(
        400,
        "formula_result_type_drift",
        `列 ${column.name} 的公式结果类型已漂移`
      );
    }
    for (const dependency of parsed.value.dependencies) {
      if (!columns.has(dependency) && !invalid.has(dependency)) {
        throw statusError(
          400,
          "formula_unknown_reference",
          `列 ${column.name} 引用了未知列 ${dependency}`
        );
      }
    }
  }
  const cycle = findBaseFormulaCycle(meta.columns);
  if (cycle) {
    const names = cycle.map((columnId) => columns.get(columnId)?.name ?? columnId);
    throw statusError(
      400,
      "formula_cycle",
      `公式列存在循环引用：${names.join(" → ")}`,
      { columns: names }
    );
  }
  for (const column of meta.columns) {
    if (column.type !== "relation" || !column.relation?.labelColumnId) continue;
    const labelColumn = columns.get(column.relation.labelColumnId);
    if (!labelColumn) {
      throw statusError(
        400,
        "relation_label_missing",
        `列 ${column.name} 引用了未知显示列`
      );
    }
    if (!isBaseRelationLabelColumn(labelColumn)) {
      throw statusError(
        400,
        "relation_label_type",
        `列 ${column.name} 的显示列不能是 ${labelColumn.type}`
      );
    }
  }
  for (const view of meta.views) validateBaseView(view, columns);
  for (const row of rows) validateBaseRow(row, meta.columns, "internal");
}

export function validateBaseRow(
  row: BaseRow,
  columns: BaseColumn[],
  origin: "external" | "internal",
  rows?: readonly BaseRow[]
) {
  for (const [columnId, value] of Object.entries(row.values)) {
    const column = columns.find((candidate) => candidate.id === columnId);
    if (!column) {
      throw statusError(
        400,
        "unknown_column",
        `row ${row.id} 引用了未知列 ${columnId}`
      );
    }
    if (value !== undefined) validateBaseCell(column, value, origin, rows);
  }
}

export function validateBaseCell(
  column: BaseColumn,
  value: BaseCellValue,
  origin: "external" | "internal",
  rows?: readonly BaseRow[]
) {
  if (column.type === "formula") {
    throw statusError(
      400,
      "formula_readonly",
      `列 ${column.name} 是只读公式列`
    );
  }
  if (column.type === "attachment") {
    if (origin === "internal" && isBaseAttachmentValue(value)) return;
    throw statusError(
      400,
      "attachment_not_allowed",
      `列 ${column.name} 是 attachment 类型，只能经 putAttachment/自动入库写入`
    );
  }
  if (column.type === "relation") {
    if (
      typeof value !== "string" ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(value)
    ) {
      throw statusError(
        400,
        "invalid_relation_id",
        `列 ${column.name} 的 relation row id 无效`
      );
    }
    if (origin === "external" && rows && !rows.some((row) => row.id === value)) {
      throw statusError(
        400,
        "relation_target_missing",
        `列 ${column.name} 的目标记录不存在`
      );
    }
    return;
  }
  if (column.type === "text" && typeof value === "string") return;
  if (column.type === "number" && typeof value === "number") return;
  if (column.type === "checkbox" && typeof value === "boolean") return;
  if (
    column.type === "location" &&
    typeof value === "object" &&
    !isBaseAttachmentValue(value) &&
    Number.isFinite(value.lat) &&
    Number.isFinite(value.lng)
  ) {
    return;
  }
  if (column.type === "date" && typeof value === "string") {
    if (
      origin === "external"
        ? parseBaseDate(value)
        : /^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(value)
    ) {
      return;
    }
    throw statusError(400, "invalid_date", `列 ${column.name} 的日期值无效`);
  }
  if (column.type === "url" && typeof value === "string") {
    try {
      if (new URL(value).protocol === "https:") return;
    } catch {
      // 统一落入类型错误
    }
  }
  if (
    column.type === "select" &&
    typeof value === "string" &&
    column.options?.some((option) => option.id === value)
  ) {
    return;
  }
  throw statusError(
    400,
    "invalid_cell_value",
    `列 ${column.name} 的值与 ${column.type} 类型不匹配`
  );
}

/**
 * 校验错误一律带 code：下游（App GUI HTTP、renderer IPC）只按 code 判别，
 * 任何靠中文文案正则认错误的做法都会在文案微调时静默改判。
 */
function statusError(
  status: number,
  code: string,
  message: string,
  detail?: { columns: string[] }
) {
  return Object.assign(new Error(message), {
    status,
    code,
    outcome: "not-committed" as const,
    ...(detail ? { detail } : {}),
  });
}
