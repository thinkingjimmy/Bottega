/**
 * [INPUT]: Depends on Base column/row types from bases-ipc and the BaseSnapshotFileV2 shape from base-snapshot; consumes only column definitions, never real row data
 * [OUTPUT]: Provides synthesizeBaseSampleRows and sampleSnapshot, deterministically generating three per-column-type sample rows with id-collision avoidance
 * [POS]: Pure sample-data generator shared across Base; the only place that fabricates example rows and must never read or forward real user rows
 */

import type { BaseColumn, BaseRow } from "./bases-ipc";
import {
  baseSnapshotFileSchema,
  type BaseSnapshotFileV2,
} from "./base-snapshot";

const SAMPLE_COUNT = 3;

export function synthesizeBaseSampleRows(
  columns: readonly BaseColumn[],
  avoidIds: ReadonlySet<string> = new Set()
): BaseRow[] {
  return Array.from({ length: SAMPLE_COUNT }, (_, index) => ({
    id: disjointId(`sample_${index + 1}`, avoidIds),
    values: Object.fromEntries(
      columns.flatMap((column) => {
        const value = sampleValue(column, index);
        return value === undefined ? [] : [[column.id, value]];
      })
    ),
  }));
}

export function sampleSnapshot(
  source: Omit<BaseSnapshotFileV2, "rows">,
  avoidIds: ReadonlySet<string> = new Set()
): BaseSnapshotFileV2 {
  const file = baseSnapshotFileSchema.parse({
    ...source,
    schemaVersion: 2,
    rows: synthesizeBaseSampleRows(source.columns, avoidIds),
  });
  return { ...file, schemaVersion: 2 };
}

/**
 * 确定性避让（同输入同输出）：导入过示例包的 Base 真实 rows 就叫 sample_1..3，
 * 不避让则示例模式 re-share 永远撞行 id 交集闸——被闸死的是合法用户，不是篡改者。
 */
function disjointId(base: string, avoidIds: ReadonlySet<string>) {
  let candidate = base;
  for (let round = 2; avoidIds.has(candidate); round += 1) {
    candidate = `${base}_${round}`;
  }
  return candidate;
}

function sampleValue(column: BaseColumn, index: number) {
  switch (column.type) {
    case "text":
      return `示例 ${index + 1}`;
    case "number":
      return index + 1;
    case "date":
      return `2026-01-0${index + 1}`;
    case "select":
      return column.options?.[index % Math.max(column.options.length, 1)]?.id;
    case "checkbox":
      return index % 2 === 0;
    case "url":
      return `https://example.com/sample-${index + 1}`;
    case "location":
      return { lat: 31.23 + index / 100, lng: 121.47 + index / 100 };
    case "attachment":
      return undefined;
  }
}
