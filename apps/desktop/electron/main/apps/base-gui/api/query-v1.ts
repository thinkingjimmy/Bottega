/**
 * [INPUT]: Depends on immutable Base snapshots, shared Query V1 schemas, canonical Base filter projection, fixed BaseQueryComparatorV1 semantics, BASE_ROW_LIMIT, a caller-supplied absolute deadline, and a process-local cursor authentication key
 * [OUTPUT]: Provides strict bounded rows/groups execution with precomputed sort keys, cooperative deadline checks, finite-only aggregates, locale-independent typed ordering, authenticated keyset cursors, and request-aware response validation
 * [POS]: Compiled Base GUI Query V1 kernel; legacy query behavior remains isolated in bases/base-read.ts
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";
import {
  baseGuiQueryPageSchema,
  baseGuiQueryRequestV1Schema,
  type BaseAggregationV1,
  type BaseGuiQueryRequestV1,
  type BaseGroupQueryShapeV1,
  type BaseRowQueryShapeV1,
} from "../../../../../shared/app-gui/query";
import {
  BASE_ROW_LIMIT,
  cellValue,
  type BaseCellValue,
  type BaseColumn,
  type BaseFilter,
  type BaseSnapshot,
} from "../../../../../shared/bases-ipc";
import { canonicalDigest, canonicalJson } from "../../gui-build/metadata";
import { selectRows } from "../../../bases/base-read";
import { apiError } from "./errors";

const REQUEST_LIMIT = 64 * 1024;
const RESPONSE_LIMIT = 700 * 1024;
const DEFAULT_PAGE_LIMIT = 50;
const HARD_WALL_MS = 500;
/* 热循环里读时钟本身就是成本：每 1024 行探一次，够快到能在 worker 内
   自己以 query_timeout 收场，而不必让 main 端 terminate 整个 worker。 */
const DEADLINE_STRIDE = 1_024;

type Cursor = Readonly<{
  v: 1;
  shapeDigest: `sha256:${string}`;
  baseInstanceId: string;
  revision: number;
  limit: number;
  lastSortKeys: readonly (BaseCellValue | null)[];
  itemId: string;
}>;

export async function readQueryRequest(request: IncomingMessage, timeoutMs = 5_000) {
  const contentLength = Number(request.headers["content-length"] ?? 0);
  if (!Number.isSafeInteger(contentLength) || contentLength < 0 || contentLength > REQUEST_LIMIT) {
    throw apiError(413, "query_budget_exceeded", "Query request exceeds 64 KiB");
  }
  const chunks: Buffer[] = [];
  let bytes = 0;
  const timer = setTimeout(() => request.destroy(apiError(408, "query_timeout", "Query body timed out")), timeoutMs);
  try {
    for await (const chunk of request) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytes += buffer.byteLength;
      if (bytes > REQUEST_LIMIT) throw apiError(413, "query_budget_exceeded", "Query request exceeds 64 KiB");
      chunks.push(buffer);
    }
  } finally {
    clearTimeout(timer);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw apiError(400, "query_invalid", "Query body must be valid JSON");
  }
  const parsed = baseGuiQueryRequestV1Schema.safeParse(raw);
  if (!parsed.success) {
    throw apiError(400, "query_invalid", "Query contract is invalid", parsed.error.issues);
  }
  return parsed.data;
}

/* deadlineAt 是 main 端下发的绝对墙钟，不是 worker 自己重新起算的 500 ms：
   同一个 query 只允许存在一个截止时刻，否则 worker 慢一拍就得由 main
   terminate，整个快照缓存陪葬。 */
export type QueryBudgetV1 = Readonly<{ deadlineAt?: number; now?: () => number }>;

export function executeBaseGuiQueryV1(
  snapshot: BaseSnapshot,
  request: BaseGuiQueryRequestV1,
  cursorKey: Uint8Array,
  budget: QueryBudgetV1 = {}
) {
  const now = budget.now ?? Date.now;
  /* 20 MiB 字节预算只在 query-executor 注册快照时量一次；这里改量行数，
     真正的上游护栏是 Bases 的 BASE_ROW_LIMIT（产品级 10000 行上限）。 */
  assertBudget(snapshot.rows.length, BASE_ROW_LIMIT, "Base snapshot exceeds its row budget");
  const deadline = deadlineGuard(budget.deadlineAt ?? now() + HARD_WALL_MS, now);
  validateColumns(snapshot, request);
  const limit = request.page.limit ?? DEFAULT_PAGE_LIMIT;
  const shapeDigest = canonicalDigest(request.shape);
  const cursor = request.page.cursor
    ? decodeCursor(request.page.cursor, cursorKey, {
        shapeDigest,
        baseInstanceId: snapshot.meta.ownerInstanceId,
        revision: snapshot.meta.revision,
        limit,
      })
    : null;
  const result = request.shape.mode === "rows"
    ? executeRows(snapshot, request.shape, cursor, limit, shapeDigest, cursorKey, deadline)
    : executeGroups(snapshot, request.shape, cursor, limit, shapeDigest, cursorKey, deadline);
  const parsed = baseGuiQueryPageSchema(request).safeParse(result);
  if (!parsed.success) {
    throw apiError(500, "query_response_invalid", "Query executor produced an invalid page");
  }
  assertBudget(Buffer.byteLength(canonicalJson(parsed.data)), RESPONSE_LIMIT, "Query response exceeds 700 KiB");
  return parsed.data;
}

function executeRows(
  snapshot: BaseSnapshot,
  shape: BaseRowQueryShapeV1,
  cursor: Cursor | null,
  limit: number,
  shapeDigest: `sha256:${string}`,
  cursorKey: Uint8Array,
  deadline: DeadlineGuard
) {
  const selection = selectRows(snapshot, {
    columns: [...shape.projection],
    filter: shape.filter,
    /* selectRows 的 limit 是 QueryArgs 的形参债务——实现从不读它。分页由本
       文件的 cursor + limit 完成，行数护栏是上游的 BASE_ROW_LIMIT。 */
    limit: BASE_ROW_LIMIT,
  });
  deadline.assert();
  /* Schwartzian：列查找与 NFC/casefold 归一化每行只做一次，比较器里只剩
     数值/Buffer 比较。语义与逐比较归一化完全一致（测试向量钉死）。 */
  const sortColumns = shape.sort?.map((sort) => column(snapshot, sort.columnId)) ?? [];
  const directions = shape.sort?.map((sort) => sort.direction);
  const projection = shape.projection.map((columnId) => ({
    columnId,
    target: column(snapshot, columnId),
  }));
  const decorated = selection.rows.map((row) => {
    deadline.tick();
    return {
      row,
      id: Buffer.from(row.id, "utf8"),
      keys: sortColumns.map((target) => comparatorKey(target, cellValue(row, target, selection.context))),
    };
  });
  decorated.sort((left, right) =>
    compareTuple(left.keys, right.keys, directions) || Buffer.compare(left.id, right.id));
  deadline.assert();
  const start = cursor
    ? afterCursor(decorated, cursor, (item) => item.row.id, (item) => item.keys)
    : 0;
  const page = decorated.slice(start, start + limit);
  const rows = page.map((item) => ({
    rowId: item.row.id,
    values: Object.fromEntries(projection.map(({ columnId, target }) => [
      columnId,
      cellValue(item.row, target, selection.context) ?? null,
    ])),
  }));
  const last = page.at(-1);
  return {
    version: 1 as const,
    semanticsVersion: "base-gui-query-v1" as const,
    mode: "rows" as const,
    baseInstanceId: snapshot.meta.ownerInstanceId,
    revision: snapshot.meta.revision,
    rows,
    ...(last && start + page.length < decorated.length ? {
      nextCursor: encodeCursor({
        v: 1,
        shapeDigest,
        baseInstanceId: snapshot.meta.ownerInstanceId,
        revision: snapshot.meta.revision,
        limit,
        lastSortKeys: last.keys,
        itemId: last.row.id,
      }, cursorKey),
    } : {}),
  };
}

function executeGroups(
  snapshot: BaseSnapshot,
  shape: BaseGroupQueryShapeV1,
  cursor: Cursor | null,
  limit: number,
  shapeDigest: `sha256:${string}`,
  cursorKey: Uint8Array,
  deadline: DeadlineGuard
) {
  const selection = selectRows(snapshot, { filter: shape.filter, limit: BASE_ROW_LIMIT });
  deadline.assert();
  const groupColumns = shape.groupBy.map((id) => column(snapshot, id));
  const aggregateColumns = shape.aggregates.map((aggregate) => ({
    id: aggregate.id,
    target: column(snapshot, aggregate.columnId),
  }));
  const groups = new Map<string, {
    groupId: `sha256:${string}`;
    keys: (BaseCellValue | null)[];
    sortKeys: (BaseCellValue | null)[];
    values: Map<string, (BaseCellValue | null)[]>;
    rowCount: number;
  }>();
  for (const row of selection.rows) {
    deadline.tick();
    const keys = groupColumns.map((target) => outputKey(cellValue(row, target, selection.context)));
    const groupId = canonicalDigest(keys);
    const group = groups.get(groupId) ?? {
      groupId,
      keys,
      sortKeys: groupColumns.map((target, index) => comparatorKey(target, keys[index] ?? null)),
      values: new Map(shape.aggregates.map((aggregate) => [aggregate.id, []])),
      rowCount: 0,
    };
    group.rowCount += 1;
    aggregateColumns.forEach(({ id, target }) => {
      group.values.get(id)!.push(outputKey(cellValue(row, target, selection.context)));
    });
    groups.set(groupId, group);
  }
  deadline.assert();
  const projected = [...groups.values()].map((group) => {
    deadline.tick();
    return {
      groupId: group.groupId,
      keys: group.keys,
      sortKeys: group.sortKeys,
      rowCount: group.rowCount,
      aggregates: Object.fromEntries(shape.aggregates.map((aggregate) => [
        aggregate.id,
        aggregateValue(aggregate.op, group.values.get(aggregate.id)!),
      ])),
    };
  });
  projected.sort((left, right) => compareGroup(left, right, shape.sort));
  deadline.assert();
  const keys = (group: (typeof projected)[number]) => groupSortKeys(group, shape.sort);
  const start = cursor ? afterCursor(projected, cursor, (group) => group.groupId, keys) : 0;
  const page = projected.slice(start, start + limit);
  const last = page.at(-1);
  return {
    version: 1 as const,
    semanticsVersion: "base-gui-query-v1" as const,
    mode: "groups" as const,
    baseInstanceId: snapshot.meta.ownerInstanceId,
    revision: snapshot.meta.revision,
    groups: page.map(({ sortKeys: _sortKeys, ...group }) => group),
    ...(last && start + page.length < projected.length ? {
      nextCursor: encodeCursor({
        v: 1,
        shapeDigest,
        baseInstanceId: snapshot.meta.ownerInstanceId,
        revision: snapshot.meta.revision,
        limit,
        lastSortKeys: keys(last),
        itemId: last.groupId,
      }, cursorKey),
    } : {}),
  };
}

function validateColumns(snapshot: BaseSnapshot, request: BaseGuiQueryRequestV1) {
  const known = new Map(snapshot.meta.columns.map((item) => [item.id, item]));
  const requireColumn = (id: string) => {
    const value = known.get(id);
    if (!value) throw apiError(400, "query_column_invalid", `Unknown Base column ${id}`);
    return value;
  };
  validateFilter(request.shape.filter, requireColumn);
  if (request.shape.mode === "rows") {
    request.shape.projection.forEach(requireColumn);
    request.shape.sort?.forEach((item) => requireColumn(item.columnId));
    return;
  }
  request.shape.groupBy.forEach(requireColumn);
  request.shape.aggregates.forEach((item) => {
    const target = requireColumn(item.columnId);
    if (numericAggregation(item.op) && !isNumericColumn(target)) {
      throw apiError(400, "query_aggregation_invalid", `${item.op} requires a numeric column`);
    }
  });
}

function validateFilter(
  filter: BaseFilter | undefined,
  requireColumn: (id: string) => BaseColumn
): void {
  if (!filter) return;
  if (filter.kind === "not") return validateFilter(filter.filter, requireColumn);
  if (filter.kind === "and" || filter.kind === "or") {
    filter.filters.forEach((child) => validateFilter(child, requireColumn));
    return;
  }
  const target = requireColumn(filter.columnId);
  if (filter.operator === "is-empty" || filter.operator === "not-empty") return;
  const type = target.type === "formula" ? target.formula?.resultType : target.type;
  const value = filter.value;
  const comparable = filter.operator === "eq" || filter.operator === "neq";
  const ordered = ["gt", "gte", "lt", "lte"].includes(filter.operator);
  const valid = type === "number"
    ? typeof value === "number" && Number.isFinite(value) && (comparable || ordered)
    : type === "date"
      ? typeof value === "string" && validDateLiteral(value) && (comparable || ordered)
      : type === "boolean" || type === "checkbox"
        ? typeof value === "boolean" && comparable
        : ["text", "url", "select", "relation"].includes(type ?? "")
          ? typeof value === "string" && (comparable || filter.operator === "contains")
          : false;
  if (!valid) {
    throw apiError(
      400,
      "query_invalid",
      `Filter ${filter.operator} is incompatible with ${target.type} column ${target.id}`
    );
  }
}

function validDateLiteral(value: string) {
  const normalized = /(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    ? value
    : value.includes("T") ? `${value}Z` : `${value}T00:00:00Z`;
  return Number.isFinite(Date.parse(normalized));
}

function numericAggregation(operation: BaseAggregationV1) {
  return !["empty", "filled", "unique"].includes(operation);
}

function isNumericColumn(column: BaseColumn) {
  return column.type === "number" ||
    (column.type === "formula" && column.formula?.resultType === "number");
}

function aggregateValue(operation: BaseAggregationV1, source: readonly (BaseCellValue | null)[]) {
  const present = source.filter((value) => value !== null && value !== "");
  if (operation === "empty") return source.length - present.length;
  if (operation === "filled") return present.length;
  if (operation === "unique") return new Set(present.map(canonicalJson)).size;
  const values = present.filter((value): value is number => typeof value === "number" && Number.isFinite(value)).sort((a, b) => a - b);
  if (!values.length) return null;
  return finite(numericAggregate(operation, values));
}

function numericAggregate(operation: BaseAggregationV1, values: readonly number[]) {
  if (operation === "sum") return values.reduce((sum, value) => sum + value, 0);
  if (operation === "average") return values.reduce((sum, value) => sum + value, 0) / values.length;
  if (operation === "min") return values[0]!;
  if (operation === "max") return values.at(-1)!;
  if (operation === "range") return values.at(-1)! - values[0]!;
  if (operation === "median") {
    const middle = Math.floor(values.length / 2);
    return values.length % 2 ? values[middle]! : (values[middle - 1]! + values[middle]!) / 2;
  }
  const average = values.reduce((sum, value) => sum + value, 0) / values.length;
  return Math.sqrt(values.reduce((sum, value) => sum + (value - average) ** 2, 0) / values.length);
}

/* 两个合法有限单元格（各 1.5e308）相加就会溢出成 Infinity，而页 schema 只
   接受有限数：溢出必须落成空格语义 null，绝不能变成 500。 */
function finite(value: number) {
  return Number.isFinite(value) ? value : null;
}

function compareGroup(
  left: { groupId: string; sortKeys: readonly (BaseCellValue | null)[]; aggregates: Readonly<Record<string, number | null>> },
  right: { groupId: string; sortKeys: readonly (BaseCellValue | null)[]; aggregates: Readonly<Record<string, number | null>> },
  sorts: BaseGroupQueryShapeV1["sort"]
) {
  for (const sort of sorts ?? []) {
    const a = sort.kind === "group" ? left.sortKeys[sort.index] ?? null : left.aggregates[sort.aggregateId] ?? null;
    const b = sort.kind === "group" ? right.sortKeys[sort.index] ?? null : right.aggregates[sort.aggregateId] ?? null;
    const compared = compareDirected(a, b, sort.direction);
    if (compared) return compared;
  }
  return compareUtf8(left.groupId, right.groupId);
}

function groupSortKeys(
  group: { sortKeys: readonly (BaseCellValue | null)[]; aggregates: Readonly<Record<string, number | null>> },
  sorts: BaseGroupQueryShapeV1["sort"]
) {
  return (sorts ?? []).map((sort) =>
    sort.kind === "group" ? group.sortKeys[sort.index] ?? null : group.aggregates[sort.aggregateId] ?? null);
}

function compareDirected(
  left: BaseCellValue | null,
  right: BaseCellValue | null,
  direction: "asc" | "desc"
) {
  if (left === null) return right === null ? 0 : 1;
  if (right === null) return -1;
  const compared = comparePresent(left, right);
  return direction === "asc" ? compared : -compared;
}

function compareTuple(
  left: readonly (BaseCellValue | null)[],
  right: readonly (BaseCellValue | null)[],
  directions: readonly ("asc" | "desc")[] = []
) {
  for (let index = 0; index < directions.length; index += 1) {
    const compared = compareDirected(left[index] ?? null, right[index] ?? null, directions[index]!);
    if (compared) return compared;
  }
  return 0;
}

function comparePresent(left: BaseCellValue, right: BaseCellValue) {
  if (typeof left === "number" && typeof right === "number") return left - right;
  if (typeof left === "boolean" && typeof right === "boolean") return Number(left) - Number(right);
  return compareUtf8(String(left), String(right));
}

function compareUtf8(left: string, right: string) {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function comparatorKey(
  target: BaseColumn,
  value: BaseCellValue | null | undefined
): BaseCellValue | null {
  if (value === undefined || value === null || value === "") return null;
  const type = target.type === "formula" ? target.formula?.resultType : target.type;
  if (type === "date" && typeof value === "string") return dateEpoch(value);
  if (type === "number" && typeof value === "number") return value;
  if (type === "boolean" && typeof value === "boolean") return value;
  const text = typeof value === "string" ? value : canonicalJson(value);
  return text.normalize("NFC").toLowerCase();
}

function dateEpoch(value: string) {
  const zoneIndependent = /(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    ? value
    : value.includes("T")
      ? `${value}Z`
      : `${value}T00:00:00Z`;
  const epoch = Date.parse(zoneIndependent);
  if (!Number.isFinite(epoch)) {
    throw apiError(500, "query_snapshot_invalid", "Base contains an invalid date value");
  }
  return epoch;
}

function outputKey(value: BaseCellValue | undefined): BaseCellValue | null {
  return value === undefined ? null : value;
}

function column(snapshot: BaseSnapshot, columnId: string) {
  return snapshot.meta.columns.find((item) => item.id === columnId)!;
}

function afterCursor<T>(
  values: readonly T[],
  cursor: Cursor,
  id: (value: T) => string,
  keys: (value: T) => readonly (BaseCellValue | null)[]
) {
  const index = values.findIndex((value) =>
    id(value) === cursor.itemId && canonicalJson(keys(value)) === canonicalJson(cursor.lastSortKeys));
  if (index < 0) throw apiError(409, "query_revision_changed", "Query cursor no longer matches this revision");
  return index + 1;
}

function encodeCursor(cursor: Cursor, key: Uint8Array) {
  const payload = Buffer.from(canonicalJson(cursor)).toString("base64url");
  const signature = createHmac("sha256", key).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

function decodeCursor(
  value: string,
  key: Uint8Array,
  expected: Pick<Cursor, "shapeDigest" | "baseInstanceId" | "revision" | "limit">
) {
  const [payload, signature, extra] = value.split(".");
  if (!payload || !signature || extra) throw apiError(400, "query_cursor_invalid", "Query cursor is invalid");
  const actual = createHmac("sha256", key).update(payload).digest();
  const supplied = Buffer.from(signature, "base64url");
  if (actual.length !== supplied.length || !timingSafeEqual(actual, supplied)) {
    throw apiError(400, "query_cursor_invalid", "Query cursor is invalid");
  }
  let cursor: Cursor;
  try {
    cursor = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Cursor;
  } catch {
    throw apiError(400, "query_cursor_invalid", "Query cursor is invalid");
  }
  if (
    cursor.v !== 1 || cursor.shapeDigest !== expected.shapeDigest ||
    cursor.baseInstanceId !== expected.baseInstanceId || cursor.revision !== expected.revision ||
    cursor.limit !== expected.limit || !Array.isArray(cursor.lastSortKeys) || typeof cursor.itemId !== "string"
  ) throw apiError(409, "query_revision_changed", "Query cursor identity changed");
  return cursor;
}

function assertBudget(actual: number, limit: number, message: string) {
  if (actual > limit) throw apiError(413, "query_budget_exceeded", message);
}

type DeadlineGuard = Readonly<{ assert(): void; tick(): void }>;

function deadlineGuard(deadlineAt: number, now: () => number): DeadlineGuard {
  let countdown = DEADLINE_STRIDE;
  const assert = () => {
    if (now() >= deadlineAt) throw apiError(408, "query_timeout", "Query exceeded its wall budget");
  };
  return {
    assert,
    tick: () => {
      countdown -= 1;
      if (countdown > 0) return;
      countdown = DEADLINE_STRIDE;
      assert();
    },
  };
}
