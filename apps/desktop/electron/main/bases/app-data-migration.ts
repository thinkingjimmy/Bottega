/**
 * [INPUT]: Depends on shared App data migration Contracts, Base model/cell test and column budget
 * [OUTPUT]: Provides apply AppBase DataMigration for pure conversion; Added missing columns and synchronized explicitly visible columns, merged select missing items, added empty values, only alias live and run zero changes twice
 * [POS]: The core of the database is the App Live Data MigrationNot knowing the presetId, not executing IO, not covering user values
 */

import {
  normalizeMigrationAlias,
  type AppBaseDataMigrationFile,
} from "../../../shared/app-data-migration";
import {
  BASE_COLUMN_LIMIT,
  isColumnScopedView,
  type BaseColumn,
  type BaseSnapshot,
} from "../../../shared/bases-ipc";
import {
  validateBaseCell,
  validateBaseModel,
} from "./base-mutation-validation";

const clone = <T>(value: T): T => structuredClone(value);

export function applyAppBaseDataMigration(
  snapshot: BaseSnapshot,
  file: AppBaseDataMigrationFile
) {
  const columns = clone(snapshot.meta.columns);
  const views = clone(snapshot.meta.views);
  const rows = clone(snapshot.rows);
  const changedRows = new Set<string>();
  let columnsChanged = false;

  for (const migration of file.migrations) {
    for (const declared of migration.addColumns) {
      const existing = columns.find((column) => column.id === declared.id);
      if (existing) {
        if (existing.type !== declared.type) throwColumnConflict(existing, declared);
        if (existing.type === "select" && mergeSelectOptions(existing, declared)) {
          columnsChanged = true;
        }
        continue;
      }
      if (columns.length >= BASE_COLUMN_LIMIT) {
        throw migrationError(
          `Base 已有 ${columns.length} 列，无法执行 ${migration.id}；请先导出 CSV/JSON 并人工精简列`
        );
      }
      columns.push(clone(declared));
      appendVisibleColumn(views, declared.id);
      columnsChanged = true;
    }

    const byId = new Map(columns.map((column) => [column.id, column]));
    for (const [columnId, value] of Object.entries(migration.defaultValues)) {
      const column = requireColumn(byId, columnId, migration.id);
      validateBaseCell(column, value, "external");
    }
    for (const alias of migration.aliases) {
      const source = requireColumn(byId, alias.sourceColumnId, migration.id);
      const target = requireColumn(byId, alias.targetColumnId, migration.id);
      if (source.type !== "text" || target.type !== "text") {
        throw migrationError(
          `${migration.id} 的 alias 只支持 text→text；请先导出 CSV/JSON 并人工处理列类型冲突`
        );
      }
    }

    for (const row of rows) {
      for (const [columnId, value] of Object.entries(migration.defaultValues)) {
        if (row.values[columnId] !== undefined) continue;
        row.values[columnId] = clone(value);
        changedRows.add(row.id);
      }
      for (const alias of migration.aliases) {
        if (row.values[alias.targetColumnId] !== undefined) continue;
        const source = row.values[alias.sourceColumnId];
        if (typeof source !== "string") continue;
        const target = alias.aliases[normalizeMigrationAlias(source)];
        if (!target) continue;
        row.values[alias.targetColumnId] = target;
        changedRows.add(row.id);
      }
    }
  }

  if (!columnsChanged && !changedRows.size) return null;
  const meta = {
    ...snapshot.meta,
    columns,
    views,
    revision: snapshot.meta.revision + 1,
  };
  validateBaseModel(meta, rows);
  return {
    meta,
    rows,
    rowsChanged: changedRows.size > 0,
    changedRowIds: changedRows,
  };
}

function mergeSelectOptions(existing: BaseColumn, declared: BaseColumn) {
  const known = new Set((existing.options ?? []).map((option) => option.id));
  const missing = (declared.options ?? []).filter((option) => !known.has(option.id));
  if (!missing.length) return false;
  existing.options = [...(existing.options ?? []), ...clone(missing)];
  return true;
}

function appendVisibleColumn(
  views: BaseSnapshot["meta"]["views"],
  columnId: string
) {
  for (const view of views) {
    if (!isColumnScopedView(view.config)) continue;
    const visible = view.config.visibleColumnIds;
    if (!visible?.length || visible.includes(columnId)) continue;
    visible.push(columnId);
  }
}

function requireColumn(
  columns: ReadonlyMap<string, BaseColumn>,
  columnId: string,
  migrationId: string
) {
  const column = columns.get(columnId);
  if (!column) {
    throw migrationError(`${migrationId} 引用了不存在的列 ${columnId}`);
  }
  return column;
}

function throwColumnConflict(existing: BaseColumn, declared: BaseColumn): never {
  throw migrationError(
    `列 ${declared.id} 已是 ${existing.type}，升级要求 ${declared.type}；未写入任何数据。请先导出 CSV/JSON 并人工改名或修复列类型`
  );
}

function migrationError(message: string) {
  return Object.assign(new Error(message), { status: 409 });
}
