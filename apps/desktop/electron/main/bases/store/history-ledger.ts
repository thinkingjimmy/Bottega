/**
 * [INPUT]: Depends on shared Base row and historical schemas/budgets; receives the declared changed row ids with before/after row indexes and commitLocked-generated entries
 * [OUTPUT]: Provides deterministic row-diff entry construction over declared ids plus empty/parse/append/query operations; empty entries are not credited, and the oldest entries are discarded by count and UTF-8 byte budgets
 * [POS]: The database is a database of databases and storesNo IO, no participation in authorization, no rollback
 */

import {
  BASE_HISTORY_ENTRY_LIMIT,
  BASE_HISTORY_LEDGER_BYTE_LIMIT,
  BASE_ROW_HISTORY_QUERY_LIMIT,
  baseHistoryEntrySchema,
  baseHistoryLedgerSchema,
  type BaseHistoryActor,
  type BaseHistoryEntry,
  type BaseHistoryLedger,
} from "../../../../shared/bases/history-ledger-schema";
import type { BaseRow } from "../../../../shared/bases-ipc";

const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value), "utf8");
const same = (left: unknown, right: unknown) =>
  JSON.stringify(left) === JSON.stringify(right);

/**
 * Pure meta commits have no row delta and therefore consume no history generation.
 *
 * 差分只走调用方声明的行 id：账本记录的本就是「谁变了」，
 * 让它自己再把整表 stringify 一遍去反推，是拿 O(n) 换一件已知的事。
 */
export function createHistoryEntry(input: {
  before: ReadonlyMap<string, BaseRow>;
  after: ReadonlyMap<string, BaseRow>;
  candidateRowIds: Iterable<string>;
  at: number;
  actor: BaseHistoryActor;
  operation: string;
}): BaseHistoryEntry | null {
  const { before: beforeById, after: afterById, at, actor, operation } = input;
  const rowIds = [...new Set(input.candidateRowIds)]
    .filter((rowId) => !same(beforeById.get(rowId), afterById.get(rowId)))
    .slice(0, 500);
  if (!rowIds.length) return null;
  const cells = rowIds.flatMap((rowId) => {
    const left = beforeById.get(rowId)?.values ?? {};
    const right = afterById.get(rowId)?.values ?? {};
    const columnIds = [...new Set([...Object.keys(left), ...Object.keys(right)])]
      .filter((columnId) => !same(left[columnId], right[columnId]))
      .slice(0, 64);
    return columnIds.length ? [{ rowId, columnIds }] : [];
  });
  return { at, actor, operation, rowIds, ...(cells.length ? { cells } : {}) };
}

export function emptyHistoryLedger(): BaseHistoryLedger {
  return { schemaVersion: 1, entries: [] };
}

export function parseHistoryLedger(value: unknown) {
  const ledger = baseHistoryLedgerSchema.parse(value);
  if (bytes(ledger) > BASE_HISTORY_LEDGER_BYTE_LIMIT) {
    throw new Error("Base history ledger 体积超限");
  }
  return ledger;
}

/**
 * 空条目（纯 meta 提交无行差分）不入账：账本只记录行事实，
 * 否则 1000 条预算会被切视图/拖列宽这类噪音填满。收 null 即原样返回，
 * 调用方用引用相等判断「账本是否变化」。
 *
 * 字节预算走增量：整份只在入账前测一次，随后每丢一条就减去那一条的字节
 * （外加条目之间那 1 字节逗号）。裁剪循环里再也不重测整份账本——那是
 * 每次 append 一趟 O(n²) 的白工，而账本本就随每次 commit 整份落盘。
 */
export function appendHistoryEntry(
  current: BaseHistoryLedger,
  raw: BaseHistoryEntry | null
) {
  if (!raw) return current;
  const entry = baseHistoryEntrySchema.parse(raw);
  const entries = [...current.entries, entry];
  let total =
    bytes(current) + bytes(entry) + (current.entries.length ? 1 : 0);
  while (
    entries.length > BASE_HISTORY_ENTRY_LIMIT ||
    (entries.length > 0 && total > BASE_HISTORY_LEDGER_BYTE_LIMIT)
  ) {
    total -= bytes(entries[0]!) + (entries.length > 1 ? 1 : 0);
    entries.shift();
  }
  return { schemaVersion: 1 as const, entries };
}

export function historyForRow(
  ledger: BaseHistoryLedger,
  rowId: string,
  limit = BASE_ROW_HISTORY_QUERY_LIMIT
) {
  return ledger.entries
    .filter((entry) => entry.rowIds.includes(rowId))
    .slice(-Math.min(limit, BASE_ROW_HISTORY_QUERY_LIMIT))
    .reverse();
}
