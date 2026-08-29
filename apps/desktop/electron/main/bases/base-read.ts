/**
 * [INPUT]: Depends on immutable Base snapshots, the shared canonical cell context/projection kernel, crypto scope hashes, and tool-result budgets
 * [OUTPUT]: Provides legacy base_query plus bounded read_base projections with formula modes, cursors, and column metadata
 * [POS]: The main Base read boundary; it builds one canonical context from the full snapshot and never performs Base mutations
 */

import { createHash } from "node:crypto";
import {
  cellValue,
  createBaseCellContext,
  projectBaseRows,
  type BaseColumn,
  type BaseFilter,
  type BaseRow,
  type BaseSelectOption,
  type BaseSnapshot,
} from "../../../shared/bases-ipc";
import { builtinCallToolResultBytes } from "../tools/result";

export const BASE_QUERY_RESULT_BYTE_LIMIT = 700 * 1024;
export const BASE_QUERY_ENVELOPE_RESERVE = 4 * 1024;

type QuerySort = { column_id: string; direction: "asc" | "desc" };
export type QueryArgs = {
  filter?: BaseFilter;
  sort?: QuerySort[];
  columns?: string[];
  cursor?: string;
  limit: number;
};
export type ReadArgs = QueryArgs & {
  section_id: string;
  row_ids?: string[];
  options_for?: string;
};

export function selectRows(base: BaseSnapshot, args: QueryArgs) {
  const known = new Set(base.meta.columns.map((column) => column.id));
  const columns = args.columns ?? base.meta.columns.map((column) => column.id);
  for (const id of columns) assertColumn(known, id, "投影");
  for (const sort of args.sort ?? []) assertColumn(known, sort.column_id, "排序");
  for (const id of filterColumnIds(args.filter)) assertColumn(known, id, "筛选");
  const sorts = args.sort?.map((sort) => ({
    columnId: sort.column_id,
    direction: sort.direction,
  }));
  const context = createBaseCellContext({
    columns: base.meta.columns,
    rows: base.rows,
  });
  return {
    columns,
    projectedColumns: base.meta.columns.filter((column) =>
      columns.includes(column.id)
    ),
    context,
    rows: projectBaseRows(
      base.rows,
      { filter: args.filter, sorts },
      context
    ),
  };
}

export function queryBase(base: BaseSnapshot, args: QueryArgs, byteLimit: number) {
  const selectedRows = selectRows(base, args);
  const cursor = decodeLegacyCursor(args.cursor);
  if (cursor.revision !== undefined && cursor.revision !== base.meta.revision) {
    throw statusError(409, "Base 已变化，请从第一页重新查询");
  }
  const rows: BaseRow[] = [];
  let index = cursor.offset;
  for (; index < selectedRows.rows.length && rows.length < args.limit; index += 1) {
    const projected = projectRow(
      selectedRows.rows[index]!,
      selectedRows.projectedColumns,
      selectedRows.context
    );
    const envelope = {
      revision: base.meta.revision,
      columns: selectedRows.columns,
      rows: [...rows, projected],
    };
    if (rows.length && builtinCallToolResultBytes(envelope) > byteLimit) break;
    rows.push(projected);
  }
  return {
    revision: base.meta.revision,
    columns: selectedRows.columns,
    rows,
    truncatedByBytes:
      index < selectedRows.rows.length && rows.length < args.limit,
    ...(index < selectedRows.rows.length
      ? { nextCursor: encodeLegacyCursor(base.meta.revision, index) }
      : {}),
  };
}

export function readBase(base: BaseSnapshot, args: ReadArgs, byteLimit: number) {
  if (args.row_ids) return readRowsById(base, args, byteLimit);
  if (args.options_for) return readOptions(base, args, byteLimit);
  return readQuery(base, args, byteLimit);
}

function readQuery(base: BaseSnapshot, args: ReadArgs, byteLimit: number) {
  const selection = selectRows(base, args);
  const scope = scopeHash({
    section_id: args.section_id,
    filter: args.filter ?? null,
    sort: args.sort ?? null,
    columns: args.columns ?? null,
  });
  const offset = decodeReadCursor(
    args.cursor,
    "query",
    scope,
    base.meta.revision
  );
  const fitted = fitColumnMeta(base, selection.columns, byteLimit, (meta, cut) =>
    readEnvelope(base, selection.columns, meta, cut, [], true, {
      nextCursor: encodeReadCursor("query", scope, base.meta.revision, offset),
    })
  );
  const rows: BaseRow[] = [];
  let index = offset;
  let truncatedByBytes = false;
  for (; index < selection.rows.length && rows.length < args.limit; index += 1) {
    const projected = projectRow(
      selection.rows[index]!,
      selection.projectedColumns,
      selection.context
    );
    const hasMore = index + 1 < selection.rows.length;
    const candidate = readEnvelope(
      base,
      selection.columns,
      fitted.meta,
      fitted.truncated,
      [...rows, projected],
      false,
      hasMore
        ? { nextCursor: encodeReadCursor("query", scope, base.meta.revision, index + 1) }
        : {}
    );
    if (builtinCallToolResultBytes(candidate) > byteLimit) {
      if (!rows.length) throw statusError(413, `Base row ${projected.id} 独占超过结果预算`);
      truncatedByBytes = true;
      break;
    }
    rows.push(projected);
  }
  const nextCursor =
    index < selection.rows.length
      ? encodeReadCursor("query", scope, base.meta.revision, index)
      : undefined;
  const result = readEnvelope(
    base,
    selection.columns,
    fitted.meta,
    fitted.truncated,
    rows,
    truncatedByBytes,
    nextCursor ? { nextCursor } : {}
  );
  assertWithinBudget(result, byteLimit);
  return result;
}

function readRowsById(base: BaseSnapshot, args: ReadArgs, byteLimit: number) {
  const requested = args.row_ids!;
  const columns = base.meta.columns.map((column) => column.id);
  const context = createBaseCellContext({ columns: base.meta.columns, rows: base.rows });
  const byId = new Map(base.rows.map((row) => [row.id, row]));
  const fitted = fitColumnMeta(base, columns, byteLimit, (meta, cut) =>
    readEnvelope(base, columns, meta, cut, [], true, {
      remaining_row_ids: requested,
    })
  );
  const rows: BaseRow[] = [];
  const missing: string[] = [];
  let consumed = 0;
  for (const id of requested) {
    const row = byId.get(id);
    const nextRows = row ? [...rows, projectRow(row, base.meta.columns, context)] : rows;
    const nextMissing = row ? missing : [...missing, id];
    const candidate = readEnvelope(
      base,
      columns,
      fitted.meta,
      fitted.truncated,
      nextRows,
      consumed + 1 < requested.length,
      {
        ...(nextMissing.length ? { missing_row_ids: nextMissing } : {}),
        ...(consumed + 1 < requested.length
          ? { remaining_row_ids: requested.slice(consumed + 1) }
          : {}),
      }
    );
    if (builtinCallToolResultBytes(candidate) > byteLimit) {
      if (!consumed && row) throw statusError(413, `Base row ${id} 独占超过结果预算`);
      break;
    }
    if (row) rows.push(projectRow(row, base.meta.columns, context));
    else missing.push(id);
    consumed += 1;
  }
  if (!consumed) throw statusError(413, "read_base row_ids 封套超过结果预算");
  const remaining = requested.slice(consumed);
  const result = readEnvelope(
    base,
    columns,
    fitted.meta,
    fitted.truncated,
    rows,
    remaining.length > 0,
    {
      ...(missing.length ? { missing_row_ids: missing } : {}),
      ...(remaining.length ? { remaining_row_ids: remaining } : {}),
    }
  );
  assertWithinBudget(result, byteLimit);
  return result;
}

function readOptions(base: BaseSnapshot, args: ReadArgs, byteLimit: number) {
  const column = base.meta.columns.find((item) => item.id === args.options_for);
  if (!column) throw statusError(400, `未知 options_for 列 ${args.options_for}`);
  if (column.type !== "select") throw statusError(400, `列 ${column.id} 不是 select`);
  const scope = scopeHash({ section_id: args.section_id, column_id: column.id });
  const offset = decodeReadCursor(
    args.cursor,
    "options",
    scope,
    base.meta.revision
  );
  const options: BaseSelectOption[] = [];
  let index = offset;
  const source = column.options ?? [];
  for (; index < source.length && options.length < args.limit; index += 1) {
    const hasMore = index + 1 < source.length;
    const candidate = optionsEnvelope(base, column, [...options, source[index]!],
      hasMore ? encodeReadCursor("options", scope, base.meta.revision, index + 1) : undefined);
    if (builtinCallToolResultBytes(candidate) > byteLimit) {
      if (!options.length) throw statusError(413, `Base option ${source[index]!.id} 独占超过结果预算`);
      break;
    }
    options.push(source[index]!);
  }
  const result = optionsEnvelope(
    base,
    column,
    options,
    index < source.length
      ? encodeReadCursor("options", scope, base.meta.revision, index)
      : undefined
  );
  assertWithinBudget(result, byteLimit);
  return result;
}

type ColumnMeta = {
  id: string;
  name: string;
  type: BaseColumn["type"];
  option_count?: number;
  options?: BaseSelectOption[];
  options_truncated?: true;
};

function fitColumnMeta(
  base: BaseSnapshot,
  columnIds: string[],
  byteLimit: number,
  envelope: (meta: ColumnMeta[], truncated: boolean) => unknown
) {
  let meta = columnIds.map((id) => columnMeta(base.meta.columns.find((column) => column.id === id)!));
  if (builtinCallToolResultBytes(envelope(meta, false)) <= byteLimit) {
    return { meta, truncated: false };
  }
  meta = meta.map((item) =>
    item.options
      ? { ...item, options: undefined, options_truncated: true as const }
      : item
  );
  if (builtinCallToolResultBytes(envelope(meta, false)) <= byteLimit) {
    return { meta, truncated: false };
  }
  while (meta.length && builtinCallToolResultBytes(envelope(meta, true)) > byteLimit) {
    meta = meta.slice(0, -1);
  }
  if (builtinCallToolResultBytes(envelope(meta, true)) > byteLimit) {
    throw statusError(413, "read_base 元数据封套超过结果预算");
  }
  return { meta, truncated: meta.length < columnIds.length };
}

function readEnvelope(
  base: BaseSnapshot,
  columns: string[],
  columnMetaValue: ColumnMeta[],
  columnMetaTruncated: boolean,
  rows: BaseRow[],
  truncatedByBytes: boolean,
  extra: Record<string, unknown>
) {
  return {
    base_name: base.meta.name,
    column_meta: columnMetaValue,
    ...(columnMetaTruncated ? { column_meta_truncated: true } : {}),
    revision: base.meta.revision,
    columns,
    rows,
    truncatedByBytes,
    ...extra,
  };
}

function optionsEnvelope(
  base: BaseSnapshot,
  column: BaseColumn,
  options: BaseSelectOption[],
  nextCursor?: string
) {
  return {
    base_name: base.meta.name,
    revision: base.meta.revision,
    column_id: column.id,
    options,
    ...(nextCursor ? { nextCursor } : {}),
  };
}

function columnMeta(column: BaseColumn): ColumnMeta {
  return {
    id: column.id,
    name: column.name,
    type: column.type,
    ...(column.type === "select"
      ? {
          option_count: column.options?.length ?? 0,
          options: column.options ?? [],
        }
      : {}),
  };
}

function projectRow(
  row: BaseRow,
  columns: BaseColumn[],
  context: ReturnType<typeof createBaseCellContext>
): BaseRow {
  return {
    id: row.id,
    values: Object.fromEntries(
      columns.flatMap((column) => {
        const value = cellValue(row, column, context);
        return value === undefined ? [] : [[column.id, value]];
      }
      )
    ),
  };
}

function* filterColumnIds(filter?: BaseFilter): Generator<string> {
  if (!filter) return;
  if (filter.kind === "condition") {
    yield filter.columnId;
    return;
  }
  if (filter.kind === "not") {
    yield* filterColumnIds(filter.filter);
    return;
  }
  for (const child of filter.filters) yield* filterColumnIds(child);
}

function assertColumn(known: ReadonlySet<string>, id: string, use: string) {
  if (!known.has(id)) throw statusError(400, `未知${use}列 ${id}`);
}

function encodeLegacyCursor(revision: number, offset: number) {
  return Buffer.from(JSON.stringify({ revision, offset }), "utf8").toString("base64url");
}

function decodeLegacyCursor(value?: string): { revision?: number; offset: number } {
  if (!value) return { offset: 0 };
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as {
      revision?: unknown;
      offset?: unknown;
    };
    if (!Number.isInteger(parsed.revision) || !Number.isInteger(parsed.offset) ||
      (parsed.offset as number) < 0) throw new Error("invalid");
    return { revision: parsed.revision as number, offset: parsed.offset as number };
  } catch {
    throw statusError(400, "cursor 无效");
  }
}

type ReadMode = "query" | "options";

function encodeReadCursor(mode: ReadMode, scope: string, revision: number, offset: number) {
  return Buffer.from(JSON.stringify({ v: 1, mode, scopeHash: scope, revision, offset }))
    .toString("base64url");
}

function decodeReadCursor(
  value: string | undefined,
  mode: ReadMode,
  scope: string,
  revision: number
) {
  if (!value) return 0;
  let parsed: { v?: unknown; mode?: unknown; scopeHash?: unknown; revision?: unknown; offset?: unknown };
  try {
    parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
  } catch {
    throw statusError(400, "read_base cursor 无效");
  }
  if (parsed.v !== 1 || parsed.mode !== mode || parsed.scopeHash !== scope ||
    !Number.isSafeInteger(parsed.revision) || !Number.isSafeInteger(parsed.offset) ||
    (parsed.offset as number) < 0) {
    throw statusError(400, "read_base cursor 与当前模式或作用域不匹配");
  }
  if (parsed.revision !== revision) throw statusError(409, "Base 已变化，请重新读取");
  return parsed.offset as number;
}

function scopeHash(value: unknown) {
  return createHash("sha256")
    .update(canonicalJson(value))
    .digest("base64url")
    .slice(0, 16);
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function assertWithinBudget(value: unknown, byteLimit: number) {
  if (builtinCallToolResultBytes(value) > byteLimit) {
    throw statusError(413, "read_base 最终封套超过结果预算");
  }
}

function statusError(status: number, message: string) {
  return Object.assign(new Error(message), { status });
}
