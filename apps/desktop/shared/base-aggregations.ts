/**
 * [INPUT]: Depends on the column/row/unit value of base-values and attachment differentiation, depending on the type of aggregation of base-view-config
 * [OUTPUT]: Provides aggregation enumeration, column available aggregation, numerical aggregation calculation and stable formatting
 * [POS]: The Base of the shared polynomial kernel of the pure function; bases-ipc only redirects the protocol side, using the main and renderer algorithms
 */

import {
  isBaseAttachmentValue,
  type BaseCellValue,
  type BaseColumn,
  type BaseColumnType,
  type BaseRow,
} from "./base-values";
import { cellValue, createBaseCellContext } from "./base-cell-value";
import type {
  BaseAggregation,
  BaseAggregationValues,
} from "./base-view-config";

export const BASE_AGGREGATIONS = [
  "average",
  "empty",
  "filled",
  "max",
  "median",
  "min",
  "range",
  "stddev",
  "sum",
  "unique",
] as const;

const ALL_AGGREGATIONS: readonly BaseAggregation[] = BASE_AGGREGATIONS;
const GENERIC_AGGREGATIONS: readonly BaseAggregation[] = [
  "empty",
  "filled",
  "unique",
];
const AGGREGATION_NUMBER_FORMAT = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 2,
});

export function baseAggregationsForColumn(
  input: BaseColumnType | Pick<BaseColumn, "type" | "formula">
): readonly BaseAggregation[] {
  const type = typeof input === "string" ? input : input.type;
  const numeric = type === "number" ||
    (typeof input !== "string" &&
      type === "formula" &&
      input.formula?.resultType === "number");
  return numeric ? ALL_AGGREGATIONS : GENERIC_AGGREGATIONS;
}

/** columns 必填：少了它，公式/relation 列的聚合会静默按空值算。 */
export function calculateBaseAggregations(
  rows: readonly BaseRow[],
  column: Pick<BaseColumn, "id" | "type" | "formula">,
  columns: readonly BaseColumn[]
): BaseAggregationValues {
  const context = createBaseCellContext({ columns, rows });
  const resolvedColumn = columns.find((candidate) => candidate.id === column.id);
  const present = rows
    .map((row) =>
      resolvedColumn
        ? cellValue(row, resolvedColumn, context)
        : row.values[column.id]
    )
    .filter(
      (value): value is BaseCellValue => value !== undefined && value !== ""
    );
  const result: BaseAggregationValues = {
    average: null,
    empty: rows.length - present.length,
    filled: present.length,
    max: null,
    median: null,
    min: null,
    range: null,
    stddev: null,
    sum: baseAggregationsForColumn(column).includes("sum") ? 0 : null,
    unique: new Set(present.map(aggregationKey)).size,
  };
  if (!baseAggregationsForColumn(column).includes("sum")) return result;
  const values = present.filter(
    (value): value is number => typeof value === "number"
  );
  if (!values.length) return result;

  let sum = 0;
  let mean = 0;
  let squaredDelta = 0;
  values.forEach((value, index) => {
    sum += value;
    const delta = value - mean;
    mean += delta / (index + 1);
    squaredDelta += delta * (value - mean);
  });
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2
      ? sorted[middle]!
      : (sorted[middle - 1]! + sorted[middle]!) / 2;
  const min = sorted[0]!;
  const max = sorted.at(-1)!;
  return {
    ...result,
    average: finiteAggregation(mean),
    max,
    median: finiteAggregation(median),
    min,
    range: finiteAggregation(max - min),
    stddev: finiteAggregation(
      Math.sqrt(Math.max(0, squaredDelta / values.length))
    ),
    sum: finiteAggregation(sum),
  };
}

export function formatBaseAggregationValue(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "—";
  const formatted = AGGREGATION_NUMBER_FORMAT.format(
    Object.is(value, -0) ? 0 : value
  );
  return formatted === "-0" ? "0" : formatted;
}

function aggregationKey(value: BaseCellValue) {
  return typeof value === "object"
    ? isBaseAttachmentValue(value)
      ? `attachment:${value.attachmentId}:${value.revision}`
      : `location:${value.lat}:${value.lng}`
    : `${typeof value}:${String(value)}`;
}

function finiteAggregation(value: number) {
  if (!Number.isFinite(value)) return null;
  return Object.is(value, -0) ? 0 : value;
}
