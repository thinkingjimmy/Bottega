/**
 * [INPUT]: Depends on @ai-chat/base-core semantic contracts; Immutable Base snapshots, the Query V1 contract and queryError, base-ui's cell context and filter projection, BASE_ROW_LIMIT, the
 *           product canonical JSON and digest, a caller-supplied absolute deadline, an optional per-snapshot plan cache and the cursor codec.
 * [OUTPUT]: executeBaseGuiQueryV1 (strict bounded rows/groups execution with precomputed sort keys, reusable sorted plans, binary-searched
 *           keyset continuation, cooperative deadline checks, finite-only aggregates and locale-independent typed ordering) and QueryPlanCacheV1.
 * [POS]: The one Query V1 kernel: the desktop query worker and Cloud Web's surface dispatcher run it on the same snapshot shape. Node-free;
 *        text order is Unicode code-point order (identical to UTF-8 byte order) without allocating.
 */
import {
  BASE_ROW_LIMIT,
  cellValue,
  createBaseCellContext,
  projectBaseRows,
  type BaseCellValue,
  type BaseColumn,
  type BaseFilter,
  type BaseRow,
  type BaseSnapshot,
} from "@ai-chat/base-core/model/bases-ipc";
import { canonicalJson, hashCanonical } from "@bottega/contracts/core/canonical-json";
import type { BaseAggregationV1, BaseGuiQueryRequestV1, BaseGroupQueryShapeV1, BaseRowQueryShapeV1 } from "./contract";
import { queryError } from "./error";
import { decodeCursor, encodeCursor, type QueryCursorV1 } from "./cursor";

const DEFAULT_PAGE_LIMIT = 50;
const HARD_WALL_MS = 500;
/* Reading the clock in the hot loop has its own cost: every 1,024 rows is often enough to end with query_timeout inside the worker, without the
   main side terminating it. */
const DEADLINE_STRIDE = 1_024;
/* Sorted plans kept per snapshot: the App picks the shapes, so an unbounded cache would hand memory to the other side. */
const PLAN_LIMIT = 4;

type CellContext = ReturnType<typeof createBaseCellContext>;
type DecoratedRowV1 = Readonly<{
  row: BaseRow;
  keys: readonly (BaseCellValue | null)[];
}>;
type ProjectedGroupV1 = Readonly<{
  groupId: `sha256:${string}`;
  keys: readonly (BaseCellValue | null)[];
  sortKeys: readonly (BaseCellValue | null)[];
  rowCount: number;
  aggregates: Record<string, number | null>;
}>;
type RowsPlanV1 = Readonly<{ mode: "rows"; context: CellContext; items: readonly DecoratedRowV1[] }>;
type GroupsPlanV1 = Readonly<{ mode: "groups"; items: readonly ProjectedGroupV1[] }>;

/* A plan depends only on (snapshot, shape), not on limit or cursor, so paging never re-sorts. Its owner keeps it with the snapshot and evicts both together. */
export type QueryPlanCacheV1 = Map<string, RowsPlanV1 | GroupsPlanV1>;

type QueryPageHeadV1 = Readonly<{
  version: 1;
  semanticsVersion: "base-gui-query-v1";
  baseInstanceId: string;
  revision: number;
  nextCursor?: string;
}>;
export type BaseGuiQueryPageV1 =
  | (QueryPageHeadV1 & Readonly<{
      mode: "rows";
      rows: readonly Readonly<{ rowId: string; values: Record<string, BaseCellValue | null> }>[];
    }>)
  | (QueryPageHeadV1 & Readonly<{
      mode: "groups";
      groups: readonly Readonly<{
        groupId: `sha256:${string}`;
        keys: readonly (BaseCellValue | null)[];
        rowCount: number;
        aggregates: Record<string, number | null>;
      }>[];
    }>);

/* deadlineAt is the caller's absolute wall clock, not 500 ms restarted here: one query has one deadline, or a worker a beat late would be
   terminated by the main side and take the snapshot cache with it. */
type QueryBudgetV1 = Readonly<{
  deadlineAt?: number;
  now?: () => number;
  plans?: QueryPlanCacheV1;
}>;

export function executeBaseGuiQueryV1(
  snapshot: BaseSnapshot,
  request: BaseGuiQueryRequestV1,
  cursorKey: Uint8Array,
  budget: QueryBudgetV1 = {}
): BaseGuiQueryPageV1 {
  const now = budget.now ?? Date.now;
  /* Byte budgets are the snapshot owner's; here only rows are counted, against the product-wide BASE_ROW_LIMIT. */
  assertBudget(snapshot.rows.length, BASE_ROW_LIMIT, "Base snapshot exceeds its row budget");
  const deadline = deadlineGuard(budget.deadlineAt ?? now() + HARD_WALL_MS, now);
  validateColumns(snapshot, request);
  const limit = request.page.limit ?? DEFAULT_PAGE_LIMIT;
  const shapeDigest = digest(request.shape);
  const cursor = request.page.cursor
    ? decodeCursor(request.page.cursor, cursorKey, {
        shapeDigest,
        baseInstanceId: snapshot.meta.ownerInstanceId,
        revision: snapshot.meta.revision,
        limit,
      })
    : null;
  /* The page contract is checked by whoever receives the page; checking it here too would parse twice and prove nothing to that receiver. */
  return request.shape.mode === "rows"
    ? executeRows(snapshot, request.shape, cursor, limit, shapeDigest, cursorKey, deadline, budget.plans)
    : executeGroups(snapshot, request.shape, cursor, limit, shapeDigest, cursorKey, deadline, budget.plans);
}

function executeRows(
  snapshot: BaseSnapshot,
  shape: BaseRowQueryShapeV1,
  cursor: QueryCursorV1 | null,
  limit: number,
  shapeDigest: `sha256:${string}`,
  cursorKey: Uint8Array,
  deadline: DeadlineGuard,
  plans: QueryPlanCacheV1 | undefined
): BaseGuiQueryPageV1 {
  const plan = rowsPlan(snapshot, shape, shapeDigest, deadline, plans);
  const directions = shape.sort?.map((sort) => sort.direction) ?? [];
  const start = cursor
    ? afterCursor(plan.items, cursor, (item) => item.row.id, (item) => item.keys, directions)
    : 0;
  const page = plan.items.slice(start, start + limit);
  const projection = shape.projection.map((columnId) => ({
    columnId,
    target: column(snapshot, columnId),
  }));
  const rows = page.map((item) => ({
    rowId: item.row.id,
    values: Object.fromEntries(projection.map(({ columnId, target }) => [
      columnId,
      cellValue(item.row, target, plan.context) ?? null,
    ])),
  }));
  const last = page.at(-1);
  return {
    version: 1,
    semanticsVersion: "base-gui-query-v1",
    mode: "rows",
    baseInstanceId: snapshot.meta.ownerInstanceId,
    revision: snapshot.meta.revision,
    rows,
    ...(last && start + page.length < plan.items.length ? {
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

function rowsPlan(
  snapshot: BaseSnapshot,
  shape: BaseRowQueryShapeV1,
  shapeDigest: string,
  deadline: DeadlineGuard,
  plans: QueryPlanCacheV1 | undefined
): RowsPlanV1 {
  const cached = plans?.get(shapeDigest);
  if (cached?.mode === "rows") return cached;
  const selection = select(snapshot, shape.filter);
  deadline.assert();
  /* Schwartzian: the column lookup and NFC/casefold normalization run once per row, leaving only number and code-point compares in the
     comparator; the result equals normalizing on every compare (pinned by test vectors). */
  const sortColumns = shape.sort?.map((sort) => column(snapshot, sort.columnId)) ?? [];
  const directions = shape.sort?.map((sort) => sort.direction);
  const items = selection.rows.map((row) => {
    deadline.tick();
    return {
      row,
      keys: sortColumns.map((target) => comparatorKey(target, cellValue(row, target, selection.context))),
    };
  });
  items.sort((left, right) =>
    compareTuple(left.keys, right.keys, directions) || compareUtf8(left.row.id, right.row.id));
  deadline.assert();
  return remember(plans, shapeDigest, { mode: "rows", context: selection.context, items });
}

function executeGroups(
  snapshot: BaseSnapshot,
  shape: BaseGroupQueryShapeV1,
  cursor: QueryCursorV1 | null,
  limit: number,
  shapeDigest: `sha256:${string}`,
  cursorKey: Uint8Array,
  deadline: DeadlineGuard,
  plans: QueryPlanCacheV1 | undefined
): BaseGuiQueryPageV1 {
  const plan = groupsPlan(snapshot, shape, shapeDigest, deadline, plans);
  const directions = (shape.sort ?? []).map((sort) => sort.direction);
  const keys = (group: ProjectedGroupV1) => groupSortKeys(group, shape.sort);
  const start = cursor
    ? afterCursor(plan.items, cursor, (group) => group.groupId, keys, directions)
    : 0;
  const page = plan.items.slice(start, start + limit);
  const last = page.at(-1);
  return {
    version: 1,
    semanticsVersion: "base-gui-query-v1",
    mode: "groups",
    baseInstanceId: snapshot.meta.ownerInstanceId,
    revision: snapshot.meta.revision,
    groups: page.map(({ sortKeys: _sortKeys, ...group }) => group),
    ...(last && start + page.length < plan.items.length ? {
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

function groupsPlan(
  snapshot: BaseSnapshot,
  shape: BaseGroupQueryShapeV1,
  shapeDigest: string,
  deadline: DeadlineGuard,
  plans: QueryPlanCacheV1 | undefined
): GroupsPlanV1 {
  const cached = plans?.get(shapeDigest);
  if (cached?.mode === "groups") return cached;
  const selection = select(snapshot, shape.filter);
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
    /* Groups are keyed by canonical JSON and hashed once per distinct group: groupId is that JSON's digest, without a hash per row. */
    const identity = canonicalJson(keys);
    let group = groups.get(identity);
    if (!group) {
      group = {
        groupId: digest(keys),
        keys,
        sortKeys: groupColumns.map((target, index) => comparatorKey(target, keys[index] ?? null)),
        values: new Map(shape.aggregates.map((aggregate) => [aggregate.id, []])),
        rowCount: 0,
      };
      groups.set(identity, group);
    }
    group.rowCount += 1;
    for (const { id, target } of aggregateColumns) {
      group.values.get(id)!.push(outputKey(cellValue(row, target, selection.context)));
    }
  }
  deadline.assert();
  const items = [...groups.values()].map((group) => {
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
  items.sort((left, right) => compareGroup(left, right, shape.sort));
  deadline.assert();
  return remember(plans, shapeDigest, { mode: "groups", items });
}

function remember<T extends RowsPlanV1 | GroupsPlanV1>(
  plans: QueryPlanCacheV1 | undefined,
  shapeDigest: string,
  plan: T
) {
  if (!plans) return plan;
  plans.set(shapeDigest, plan);
  if (plans.size > PLAN_LIMIT) {
    const oldest = plans.keys().next();
    if (!oldest.done) plans.delete(oldest.value);
  }
  return plan;
}

function validateColumns(snapshot: BaseSnapshot, request: BaseGuiQueryRequestV1) {
  const known = new Map(snapshot.meta.columns.map((item) => [item.id, item]));
  const requireColumn = (id: string) => {
    const value = known.get(id);
    if (!value) throw queryError(400, "query_column_invalid", `Unknown Base column ${id}`);
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
      throw queryError(400, "query_aggregation_invalid", `${item.op} requires a numeric column`);
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
    throw queryError(
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

/* Two valid finite cells (1.5e308 each) overflow to Infinity, and the page schema accepts only finite numbers: an overflow reads as an empty
   cell (null), never a 500. */
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

/* UTF-8 byte order is code-point order. UTF-16 units differ from it only where a surrogate (a supplementary-plane character) meets
   U+E000–U+FFFF, so those two ranges are swapped before the unit compare. */
function compareUtf8(left: string, right: string) {
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const a = left.charCodeAt(index), b = right.charCodeAt(index);
    if (a !== b) return codePointRank(a) - codePointRank(b);
  }
  return left.length - right.length;
}

function codePointRank(unit: number) {
  return unit >= 0xd800 && unit <= 0xdfff ? unit + 0x2000 : unit >= 0xe000 ? unit - 0x800 : unit;
}

function digest(value: unknown): `sha256:${string}` {
  return `sha256:${hashCanonical(value)}`;
}

/* The filter projection is base-ui's, on the whole snapshot; columns were validated above and paging is this file's cursor + limit. */
function select(snapshot: BaseSnapshot, filter: BaseFilter | undefined) {
  const context = createBaseCellContext({ columns: snapshot.meta.columns, rows: snapshot.rows });
  return { context, rows: projectBaseRows(snapshot.rows, { filter }, context) };
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
    throw queryError(500, "query_snapshot_invalid", "Base contains an invalid date value");
  }
  return epoch;
}

function outputKey(value: BaseCellValue | undefined): BaseCellValue | null {
  return value === undefined ? null : value;
}

function column(snapshot: BaseSnapshot, columnId: string) {
  return snapshot.meta.columns.find((item) => item.id === columnId)!;
}

/* The plan is sorted by (sort keys, id) and a cursor is a point in that order: a binary search keeps page N from costing O(N). The comparator
   is the sort's own, or the search would converge in an order it does not understand. */
function afterCursor<T>(
  values: readonly T[],
  cursor: QueryCursorV1,
  id: (value: T) => string,
  keys: (value: T) => readonly (BaseCellValue | null)[],
  directions: readonly ("asc" | "desc")[]
) {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    const item = values[middle]!;
    const compared = compareTuple(keys(item), cursor.lastSortKeys, directions) ||
      compareUtf8(id(item), cursor.itemId);
    if (compared < 0) low = middle + 1;
    else high = middle;
  }
  const found = values[low];
  if (!found || id(found) !== cursor.itemId) {
    throw queryError(409, "query_revision_changed", "Query cursor no longer matches this revision");
  }
  return low + 1;
}

function assertBudget(actual: number, limit: number, message: string) {
  if (actual > limit) throw queryError(413, "query_budget_exceeded", message);
}

type DeadlineGuard = Readonly<{ assert(): void; tick(): void }>;

function deadlineGuard(deadlineAt: number, now: () => number): DeadlineGuard {
  let countdown = DEADLINE_STRIDE;
  const assert = () => {
    if (now() >= deadlineAt) throw queryError(408, "query_timeout", "Query exceeded its wall budget");
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
