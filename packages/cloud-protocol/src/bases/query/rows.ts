/**
 * [INPUT]: Depends on @ai-chat/base-core semantic contracts; Immutable Base snapshots, base-ui's cell context and filter/sort projection, the shared strict base64url leaf and queryError.
 * [OUTPUT]: legacyRowsPage: the offset-cursor rows page behind the App SDK's `base.rows` (and the Base package ports' query), bounded by a
 *           caller-supplied size check, with typed 400/409 refusals.
 * [POS]: The legacy half of the Base GUI data contract, shared by the desktop (bases/base-read.ts queryBase) and Cloud Web's surface dispatcher.
 *        Node-free. Query V1 (execute.ts) is the bounded dialect new code uses.
 */
import {
  cellValue,
  createBaseCellContext,
  filterColumnIds,
  projectBaseRows,
  type BaseColumn,
  type BaseFilter,
  type BaseRow,
  type BaseSnapshot,
} from "@ai-chat/base-core/model/bases-ipc";
import { encodeBase64url, parseBase64url } from "../../encryption/base64url";

const utf8 = new TextEncoder();
import { queryError } from "./error";

export type LegacyRowsArgs = Readonly<{
  limit: number;
  cursor?: string;
  columns?: readonly string[];
  filter?: BaseFilter;
  sort?: readonly Readonly<{ column_id: string; direction: "asc" | "desc" }>[];
}>;
export type LegacyRowsEnvelope = Readonly<{ revision: number; columns: readonly string[]; rows: readonly BaseRow[] }>;
export type LegacyRowsPage = LegacyRowsEnvelope & Readonly<{ truncatedByBytes: boolean; nextCursor?: string }>;

/** `fits(envelope)` is asked before each row after the first, so a page always makes progress. */
export function legacyRowsPage(base: BaseSnapshot, args: LegacyRowsArgs, fits: (envelope: LegacyRowsEnvelope) => boolean): LegacyRowsPage {
  const known = new Set(base.meta.columns.map((column) => column.id));
  const columns = [...(args.columns ?? base.meta.columns.map((column) => column.id))];
  for (const id of [...columns, ...(args.sort ?? []).map((sort) => sort.column_id), ...filterColumnIds(args.filter)]) {
    if (!known.has(id)) throw queryError(400, "query_column_invalid", `Unknown Base column ${id}`);
  }
  const projected = base.meta.columns.filter((column) => columns.includes(column.id));
  const context = createBaseCellContext({ columns: base.meta.columns, rows: base.rows });
  const selected = projectBaseRows(base.rows, {
    filter: args.filter, sorts: args.sort?.map((sort) => ({ columnId: sort.column_id, direction: sort.direction })),
  }, context);
  const cursor = decodeCursor(args.cursor);
  if (cursor.revision !== undefined && cursor.revision !== base.meta.revision) {
    throw queryError(409, "query_revision_changed", "The Base changed; read again from the first page");
  }
  const rows: BaseRow[] = [];
  let index = cursor.offset;
  for (; index < selected.length && rows.length < args.limit; index += 1) {
    const row = projectRow(selected[index]!, projected, context);
    if (rows.length && !fits({ revision: base.meta.revision, columns, rows: [...rows, row] })) break;
    rows.push(row);
  }
  return {
    revision: base.meta.revision, columns, rows,
    truncatedByBytes: index < selected.length && rows.length < args.limit,
    ...(index < selected.length ? { nextCursor: encodeBase64url(utf8.encode(JSON.stringify({ revision: base.meta.revision, offset: index }))) } : {}),
  };
}

function projectRow(row: BaseRow, columns: readonly BaseColumn[], context: ReturnType<typeof createBaseCellContext>): BaseRow {
  return { id: row.id, values: Object.fromEntries(columns.flatMap((column) => {
    const value = cellValue(row, column, context);
    return value === undefined ? [] : [[column.id, value]];
  })) };
}

function decodeCursor(value: string | undefined): { revision?: number; offset: number } {
  if (!value) return { offset: 0 };
  try {
    const bytes = parseBase64url(value, 1, 256);
    if (!bytes) throw new Error("invalid");
    const parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as { revision?: unknown; offset?: unknown };
    if (!Number.isInteger(parsed.revision) || !Number.isInteger(parsed.offset) || (parsed.offset as number) < 0) throw new Error("invalid");
    return { revision: parsed.revision as number, offset: parsed.offset as number };
  } catch {
    throw queryError(400, "query_cursor_invalid", "Rows cursor is invalid");
  }
}
