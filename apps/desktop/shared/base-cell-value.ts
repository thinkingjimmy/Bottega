/**
 * [INPUT]: Depends on Base row/column values, canonical text projections, base-formula The full row of the call is provided by the pure query and the caller
 * [OUTPUT]: Provides createBaseCellContext, isBaseRelationLabelColumn and cellValue, as the only read-only value side of the column displayed as a normal column/formula column/non-recursive relation
 * [POS]: The Base reading projected kernel of shared; Sequencing, filtering, grouping, aggregating, exporting, consumable by Agent and Six Views
 */

import {
  BASE_FORMULA_MEMO_LIMIT,
  evaluateBaseFormula,
  parseBaseFormula,
  type BaseFormulaParseResult,
} from "./base-formula";
import type {
  BaseCellValue,
  BaseColumn,
  BaseSelectOption,
} from "./base-values";
import { baseCellText, DELETED_RELATION_PREFIX } from "./base-values";

const RELATION_LABEL_TYPES = new Set<BaseColumn["type"]>([
  "text",
  "number",
  "date",
  "select",
  "checkbox",
  "url",
]);

export type BaseReadableColumn = {
  readonly id: string;
  readonly name: string;
  readonly type: BaseColumn["type"];
  readonly options?: readonly BaseSelectOption[];
  readonly formula?: {
    readonly expression: string;
    readonly resultType: "number" | "text" | "boolean";
    readonly invalidReferences?: readonly string[];
  };
  readonly relation?: {
    readonly labelColumnId: string | null;
  };
};

export type BaseReadableRow = {
  readonly id: string;
  readonly values: Readonly<Partial<Record<string, BaseCellValue>>>;
};

export type BaseCellContext = {
  columns: ReadonlyMap<string, BaseReadableColumn>;
  rows: ReadonlyMap<string, BaseReadableRow>;
  formulaMemo: Map<string, BaseFormulaParseResult>;
  valueMemo: Map<string, BaseCellValue | undefined>;
  active: Set<string>;
};

export function createBaseCellContext(input: {
  columns: readonly BaseReadableColumn[];
  rows: readonly BaseReadableRow[];
}): BaseCellContext {
  return {
    columns: new Map(input.columns.map((column) => [column.id, column])),
    rows: new Map(input.rows.map((row) => [row.id, row])),
    formulaMemo: new Map(),
    valueMemo: new Map(),
    active: new Set(),
  };
}

export function isBaseRelationLabelColumn(
  column: BaseReadableColumn | undefined
): boolean {
  return Boolean(column && RELATION_LABEL_TYPES.has(column.type));
}

export function cellValue(
  row: BaseReadableRow,
  column: BaseReadableColumn,
  context: BaseCellContext
): BaseCellValue | undefined {
  if (column.type === "relation") {
    const targetId = row.values[column.id];
    if (typeof targetId !== "string" || !targetId) return undefined;
    const target = context.rows.get(targetId);
    if (!target) return `${DELETED_RELATION_PREFIX}${targetId}`;
    const configuredLabel = column.relation?.labelColumnId
      ? context.columns.get(column.relation.labelColumnId)
      : undefined;
    const labelColumn = isBaseRelationLabelColumn(configuredLabel)
      ? configuredLabel
      : [...context.columns.values()].find((candidate) => candidate.type === "text");
    if (!labelColumn) return target.id;
    const label = baseCellText(labelColumn, target.values[labelColumn.id]);
    return label || target.id;
  }
  if (column.type !== "formula") return row.values[column.id];
  const key = `${row.id}\u0000${column.id}`;
  if (context.valueMemo.has(key)) return context.valueMemo.get(key);
  if (context.active.has(key)) return "#REF!";
  if (column.formula?.invalidReferences?.length) return "#REF!";
  const expression = column.formula?.expression;
  if (!expression) return "#ERROR!";
  let parsed = context.formulaMemo.get(expression);
  if (!parsed) {
    parsed = parseBaseFormula(expression);
    if (context.formulaMemo.size < BASE_FORMULA_MEMO_LIMIT) {
      context.formulaMemo.set(expression, parsed);
    }
  }
  if (!parsed.ok) return parsed.error;
  context.active.add(key);
  const result = evaluateBaseFormula(parsed.value, (columnId) => {
    const dependency = context.columns.get(columnId);
    return dependency ? cellValue(row, dependency, context) : "#REF!";
  });
  context.active.delete(key);
  const value = result.ok ? result.value : result.error;
  if (context.valueMemo.size < BASE_FORMULA_MEMO_LIMIT) {
    context.valueMemo.set(key, value);
  }
  return value;
}
