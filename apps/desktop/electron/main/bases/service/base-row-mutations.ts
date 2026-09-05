/**
 * [INPUT]: Depends on BaseStore single-owner queues, shared Base row/meta types, view scrubbing, and mutation validation, plus the shared statusError constructor from main/errors
 * [OUTPUT]: Provides CAS row/meta mutations that declare the exact rows they touched, App GUI attachment rules, no-op detection, and event projection
 * [POS]: Base mutation core; BasesService owns authority and event order while this module owns canonical state transitions
 */

import type { AppBaseDataMigrationFile } from "../../../../shared/app-data-migration";
import {
  BASE_ROW_LIMIT,
  type BaseChangedEvent,
  type BaseCellValue,
  type BaseColumn,
  type BaseMetaPatch,
  type BaseRow,
  type BaseRowPatch,
  type BaseSnapshot,
} from "../../../../shared/bases-ipc";
import { applyAppBaseDataMigration } from "./app-data-migration";
import type { BaseCommitAuthority } from "./base-commit-authority";
import type { BaseMutationOperation } from "./base-commit-authority";
import {
  ALL_ROWS_CHANGED,
  NO_ROWS_CHANGED,
  type BaseStore,
} from "../base-store";
import {
  scrubBaseFormulaColumns,
  scrubBaseRelationColumns,
  scrubBaseViews,
} from "../validation/base-view-validation";
import {
  assertStableColumnTypes,
  baseColumnIndex,
  baseRowIdSet,
  validateBaseCell,
  validateBaseModel,
} from "../validation/base-mutation-validation";
import { statusError } from "../../errors";

const same = (left: unknown, right: unknown) =>
  JSON.stringify(left) === JSON.stringify(right);
const canonicalRow = (row: BaseRow) => ({
  id: row.id,
  values: Object.fromEntries(
    Object.entries(row.values).sort(([left], [right]) =>
      Buffer.from(left, "utf8").compare(Buffer.from(right, "utf8"))
    )
  ),
});
const sameRow = (left: BaseRow, right: BaseRow) =>
  same(canonicalRow(left), canonicalRow(right));

type MutationIdentity = { ownerInstanceId: string };

type BaseRowMutationsOptions = {
  assertAdmission(): void;
  mutationIdentity(
    ownerKey: string,
    authority: BaseCommitAuthority,
    operation: "meta" | "row-insert" | "row-patch" | "row-delete"
  ): Promise<MutationIdentity>;
  mutationScope(
    ownerKey: string,
    authority: BaseCommitAuthority,
    operation: BaseMutationOperation,
    appFence: NonNullable<BaseCommitAuthority["appFence"]>
  ): Promise<MutationIdentity>;
  emitChange(
    snapshot: BaseSnapshot,
    delta: Pick<BaseChangedEvent, "meta" | "upserts" | "removedRowIds">
  ): void;
  conflict(message: string): Error;
};

export class BaseRowMutations {
  constructor(
    private readonly store: BaseStore,
    private readonly options: BaseRowMutationsOptions
  ) {}

  /** App 包声明、平台执行；一个 owner queue、一个 revision、一次事件。 */
  async applyAppDataMigration(
    ownerKey: string,
    file: AppBaseDataMigrationFile
  ) {
    this.options.assertAdmission();
    const current = this.store.get(ownerKey);
    if (!current) {
      throw Object.assign(new Error("App Base 不存在"), { status: 404 });
    }
    let changedRowIds = new Set<string>();
    let changed = false;
    const snapshot = await this.store.transact(
      ownerKey,
      current.meta.ownerInstanceId,
      (candidate) => {
        this.options.assertAdmission();
        const migration = applyAppBaseDataMigration(candidate, file);
        if (!migration) return null;
        changed = true;
        changedRowIds = migration.changedRowIds;
        return {
          meta: migration.meta,
          rows: migration.rows,
          /* 迁移会整表克隆并可能加列：这是货真价实的整表改写，全量体检。 */
          changedRowIds: ALL_ROWS_CHANGED,
          actor: "system",
          operation: "app-data-migration",
        };
      }
    );
    if (changed) {
      this.options.emitChange(snapshot, {
        meta: snapshot.meta,
        ...(changedRowIds.size
          ? {
              upserts: snapshot.rows.filter((row) => changedRowIds.has(row.id)),
            }
          : {}),
      });
    }
    return snapshot;
  }

  async updateMeta(input: {
    ownerKey: string;
    expectedRevision: number;
    patch: BaseMetaPatch;
    authority: BaseCommitAuthority;
  }) {
    this.options.assertAdmission();
    const identity = await this.options.mutationIdentity(
      input.ownerKey,
      input.authority,
      "meta"
    );
    let changed = false;
    let rowsChanged = false;
    const snapshot = await this.store.transact(
      input.ownerKey,
      identity.ownerInstanceId,
      (current) => {
        this.options.assertAdmission();
        if (current.meta.revision !== input.expectedRevision) {
          throw mutationConflict(
            this.options.conflict(
              `Base revision 已变化：期望 ${input.expectedRevision}，实际 ${current.meta.revision}`
            ),
            "revision_conflict",
            current.meta.revision
          );
        }
        const rawMeta = { ...current.meta, ...structuredClone(input.patch) };
        assertStableColumnTypes(current.meta.columns, rawMeta.columns);
        const removed = new Set(
          current.meta.columns
            .filter(
              (column) =>
                !rawMeta.columns.some(
                  (candidate) => candidate.id === column.id
                )
            )
            .map((column) => column.id)
        );
        const columns = scrubBaseRelationColumns(
          scrubBaseFormulaColumns(rawMeta.columns, removed),
          removed
        );
        const views = scrubBaseViews(rawMeta.views, removed, columns);
        const meta = {
          ...rawMeta,
          columns,
          views,
          activeViewId: views.some((view) => view.id === rawMeta.activeViewId)
            ? rawMeta.activeViewId
            : views[0]!.id,
          revision: current.meta.revision + 1,
        };
        const rows = removed.size
          ? current.rows.map((row) => ({
              ...row,
              values: Object.fromEntries(
                Object.entries(row.values).filter(
                  ([columnId]) => !removed.has(columnId)
                )
              ),
            }))
          : current.rows;
        /* 列没动，任何一行都不可能因为这次 meta 变化而失效：视图/公式/关系
           照旧全查，行校验则只在列真的变了（含 select 选项增删）时才付。 */
        const columnsChanged =
          meta.columns !== current.meta.columns &&
          !same(meta.columns, current.meta.columns);
        validateBaseModel(meta, columnsChanged ? rows : []);
        const comparableMeta = { ...meta, revision: current.meta.revision };
        /* 没删列时 rows 就是原引用；引用相等即「行未变」，无须再逐字节比。 */
        if (rows === current.rows && same(comparableMeta, current.meta)) {
          return null;
        }
        changed = true;
        rowsChanged = removed.size > 0;
        return {
          meta,
          rows,
          /* 删列会重写每一行的 values：那时才该整表体检，否则一行都没碰。 */
          changedRowIds: rowsChanged ? ALL_ROWS_CHANGED : NO_ROWS_CHANGED,
          actor: input.authority.actor,
          operation: "meta",
        };
      }
    );
    if (changed) {
      this.options.emitChange(snapshot, {
        meta: snapshot.meta,
        ...(rowsChanged ? { upserts: snapshot.rows } : {}),
      });
    }
    return snapshot;
  }

  async insertRows(input: {
    ownerKey: string;
    rows: BaseRow[];
    authority: BaseCommitAuthority;
  }) {
    this.options.assertAdmission();
    const identity = await this.options.mutationIdentity(
      input.ownerKey,
      input.authority,
      "row-insert"
    );
    return (
      await this.commitInsert({
        ownerKey: input.ownerKey,
        ownerInstanceId: identity.ownerInstanceId,
        rows: input.rows,
        expectedRevision: input.authority.expectedRevision ?? undefined,
        actor: input.authority.actor,
      })
    ).snapshot;
  }

  async insertRowsReplayAware(input: {
    ownerKey: string;
    rows: BaseRow[];
    authority: BaseCommitAuthority;
    appFence: NonNullable<BaseCommitAuthority["appFence"]>;
    expectedBaseInstanceId: string;
    expectedRevision: number;
  }) {
    this.options.assertAdmission();
    await this.options.mutationScope(
      input.ownerKey,
      input.authority,
      "row-insert",
      input.appFence
    );
    try {
      return await this.commitInsert({
        ownerKey: input.ownerKey,
        ownerInstanceId: input.expectedBaseInstanceId,
        rows: input.rows,
        expectedRevision: input.expectedRevision,
        actor: input.authority.actor,
      });
    } catch (cause) {
      throw normalizeAppGuiInstanceError(cause);
    }
  }

  private async commitInsert(input: {
    ownerKey: string;
    ownerInstanceId: string;
    rows: BaseRow[];
    expectedRevision?: number;
    actor: BaseCommitAuthority["actor"];
  }) {
    let additions: BaseRow[] = [];
    let replayed = false;
    const snapshot = await this.store.transact(
      input.ownerKey,
      input.ownerInstanceId,
      (current) => {
        this.options.assertAdmission();
        const incomingIds = new Set<string>();
        for (const row of input.rows) {
          if (incomingIds.has(row.id)) {
            throw mutationError(400, "duplicate_row_id", "同一批次包含重复 row id");
          }
          incomingIds.add(row.id);
        }
        const issues = collectRowIssues(input.rows, current.meta.columns, [
          ...current.rows,
          ...input.rows,
        ]);
        if (issues.length) {
          throw mutationError(
            400,
            "invalid_rows",
            "请求包含无效记录",
            undefined,
            issues
          );
        }
        const byId = new Map(current.rows.map((row) => [row.id, row]));
        additions = [];
        for (const row of input.rows) {
          const existing = byId.get(row.id);
          if (!existing) additions.push(structuredClone(row));
          else if (!sameRow(existing, row)) {
            throw mutationConflict(
              this.options.conflict("row id 已存在且内容不同"),
              "row_id_conflict"
            );
          }
        }
        if (!additions.length) {
          replayed = true;
          return null;
        }
        if (
          input.expectedRevision !== undefined &&
          current.meta.revision !== input.expectedRevision
        ) {
          throw mutationConflict(
            this.options.conflict("Base revision 已变化"),
            "revision_conflict",
            current.meta.revision
          );
        }
        if (current.rows.length + additions.length > BASE_ROW_LIMIT) {
          throw mutationError(409, "base_capacity", "Base 行数已达上限");
        }
        return {
          meta: { ...current.meta, revision: current.meta.revision + 1 },
          rows: [...current.rows, ...additions],
          changedRowIds: new Set(additions.map((row) => row.id)),
          actor: input.actor,
          operation: "row-insert",
        };
      }
    );
    if (additions.length) this.options.emitChange(snapshot, { upserts: additions });
    return { snapshot, replayed };
  }

  async patchRows(
    ownerKey: string,
    patches: Array<{ rowId: string; patch: BaseRowPatch }>,
    authority: BaseCommitAuthority
  ) {
    this.options.assertAdmission();
    const identity = await this.options.mutationIdentity(
      ownerKey,
      authority,
      "row-patch"
    );
    return (
      await this.commitPatch({
        ownerKey,
        ownerInstanceId: identity.ownerInstanceId,
        patches,
        // 单格 renderer 编辑保持 LWW；带 CAS 的批量 App GUI 只走 replay-aware 入口。
        expectedRevision: undefined,
        rejectAttachmentColumns: false,
        actor: authority.actor,
      })
    ).snapshot;
  }

  async patchRowsReplayAware(input: {
    ownerKey: string;
    patches: Array<{ rowId: string; patch: BaseRowPatch }>;
    authority: BaseCommitAuthority;
    appFence: NonNullable<BaseCommitAuthority["appFence"]>;
    expectedBaseInstanceId: string;
    expectedRevision: number;
  }) {
    this.options.assertAdmission();
    await this.options.mutationScope(
      input.ownerKey,
      input.authority,
      "row-patch",
      input.appFence
    );
    try {
      return await this.commitPatch({
        ownerKey: input.ownerKey,
        ownerInstanceId: input.expectedBaseInstanceId,
        patches: input.patches,
        expectedRevision: input.expectedRevision,
        rejectAttachmentColumns: true,
        actor: input.authority.actor,
      });
    } catch (cause) {
      throw normalizeAppGuiInstanceError(cause);
    }
  }

  private async commitPatch(input: {
    ownerKey: string;
    ownerInstanceId: string;
    patches: Array<{ rowId: string; patch: BaseRowPatch }>;
    expectedRevision?: number;
    rejectAttachmentColumns: boolean;
    actor: BaseCommitAuthority["actor"];
  }) {
    let upserts: BaseRow[] = [];
    let replayed = false;
    const snapshot = await this.store.transact(
      input.ownerKey,
      input.ownerInstanceId,
      (current) => {
        this.options.assertAdmission();
        /* 列/行 id 各建一次索引：每格 find/some 一遍全表是把 O(1) 写成 O(n)。 */
        const columns = baseColumnIndex(current.meta.columns);
        const relationTargets = baseRowIdSet(current.rows);
        const byId = new Map(current.rows.map((row) => [row.id, row]));
        const changed = new Set<string>();
        for (const [rowIndex, patchInput] of input.patches.entries()) {
          const row = byId.get(patchInput.rowId);
          if (!row) {
            throw mutationError(
              404,
              "row_not_found",
              `row ${patchInput.rowId} 不存在`,
              undefined,
              [{ rowIndex, columnId: "", reason: "row_not_found" }]
            );
          }
          const values = { ...row.values };
          for (const [columnId, value] of Object.entries(patchInput.patch)) {
            const column = columns.get(columnId);
            /* 与 insert 侧 collectRowIssues 同一套 issue 词汇：请求写错列名是
               用户输入错误，不是「提交结果未知」，绝不能落成 500。 */
            if (!column) {
              throw mutationError(
                400,
                "invalid_rows",
                `patch 引用了未知列 ${columnId}`,
                undefined,
                [{ rowIndex, columnId, reason: "unknown_column" }]
              );
            }
            if (input.rejectAttachmentColumns && column.type === "attachment") {
              throw mutationError(
                400,
                "invalid_rows",
                "App GUI 不允许修改 attachment 列",
                undefined,
                [{ rowIndex, columnId, reason: "attachment_not_allowed" }]
              );
            }
            if (value === null) delete values[columnId];
            else {
              validateBaseCell(column, value, "external", relationTargets);
              values[columnId] = structuredClone(value);
            }
          }
          const next = { ...row, values };
          if (!same(row, next)) {
            byId.set(row.id, next);
            changed.add(row.id);
          }
        }
        if (!changed.size) {
          upserts = [];
          replayed = true;
          return null;
        }
        if (
          input.expectedRevision !== undefined &&
          current.meta.revision !== input.expectedRevision
        ) {
          throw mutationConflict(
            this.options.conflict("Base revision 已变化"),
            "revision_conflict",
            current.meta.revision
          );
        }
        const rows = current.rows.map((row) => byId.get(row.id)!);
        upserts = rows.filter((row) => changed.has(row.id));
        return {
          meta: { ...current.meta, revision: current.meta.revision + 1 },
          rows,
          changedRowIds: changed,
          actor: input.actor,
          operation: "row-patch",
        };
      }
    );
    if (upserts.length) this.options.emitChange(snapshot, { upserts });
    return { snapshot, replayed, rowIds: upserts.map((row) => row.id) };
  }

  async deleteRows(input: {
    ownerKey: string;
    rowIds: string[];
    authority: BaseCommitAuthority;
    expectedRevision?: number;
  }) {
    this.options.assertAdmission();
    const identity = await this.options.mutationIdentity(
      input.ownerKey,
      input.authority,
      "row-delete"
    );
    return (
      await this.commitDelete({
        ownerKey: input.ownerKey,
        ownerInstanceId: identity.ownerInstanceId,
        rowIds: input.rowIds,
        expectedRevision:
          input.expectedRevision ?? input.authority.expectedRevision ?? undefined,
        actor: input.authority.actor,
      })
    ).snapshot;
  }

  async deleteRowsReplayAware(input: {
    ownerKey: string;
    rowIds: string[];
    authority: BaseCommitAuthority;
    appFence: NonNullable<BaseCommitAuthority["appFence"]>;
    expectedBaseInstanceId: string;
    expectedRevision: number;
  }) {
    this.options.assertAdmission();
    await this.options.mutationScope(
      input.ownerKey,
      input.authority,
      "row-delete",
      input.appFence
    );
    try {
      return await this.commitDelete({
        ownerKey: input.ownerKey,
        ownerInstanceId: input.expectedBaseInstanceId,
        rowIds: input.rowIds,
        expectedRevision: input.expectedRevision,
        actor: input.authority.actor,
      });
    } catch (cause) {
      throw normalizeAppGuiInstanceError(cause);
    }
  }

  private async commitDelete(input: {
    ownerKey: string;
    ownerInstanceId: string;
    rowIds: string[];
    expectedRevision?: number;
    actor: BaseCommitAuthority["actor"];
  }) {
    let removedRowIds: string[] = [];
    let missingRowIds: string[] = [];
    let replayed = false;
    const snapshot = await this.store.transact(
      input.ownerKey,
      input.ownerInstanceId,
      (current) => {
        this.options.assertAdmission();
        const requested = new Set(input.rowIds);
        removedRowIds = current.rows
          .filter((row) => requested.has(row.id))
          .map((row) => row.id);
        const existing = new Set(removedRowIds);
        missingRowIds = [...requested].filter((rowId) => !existing.has(rowId));
        if (!removedRowIds.length) {
          replayed = true;
          return null;
        }
        if (
          input.expectedRevision !== undefined &&
          current.meta.revision !== input.expectedRevision
        ) {
          throw mutationConflict(
            this.options.conflict("Base revision 已变化"),
            "revision_conflict",
            current.meta.revision
          );
        }
        return {
          meta: { ...current.meta, revision: current.meta.revision + 1 },
          rows: current.rows.filter((row) => !requested.has(row.id)),
          changedRowIds: NO_ROWS_CHANGED,
          removedRowIds: existing,
          actor: input.actor,
          operation: "row-delete",
        };
      }
    );
    if (removedRowIds.length) {
      this.options.emitChange(snapshot, { removedRowIds });
    }
    return { snapshot, removedRowIds, missingRowIds, replayed };
  }
}

/**
 * App GUI 的 binding 绑死一个 Base 生命周期：store 认定生命周期已换人
 * （incarnation 不符）或 Base 已整个消失，对 GUI 都是同一件事——手里的
 * binding 已死。判据只取 store 的显式 code；靠中文文案正则认「实例错误」
 * 会把 relation「目标记录不存在」这类 400 误判成 409。
 */
const APP_GUI_DEAD_BINDING_CODES = new Set([
  "base_instance_changed",
  "base_not_found",
]);

function normalizeAppGuiInstanceError(cause: unknown) {
  const code =
    cause && typeof cause === "object" && "code" in cause
      ? (cause as { code?: unknown }).code
      : undefined;
  if (typeof code === "string" && APP_GUI_DEAD_BINDING_CODES.has(code)) {
    return mutationError(409, "base_instance_changed", "Base instance 已变化");
  }
  return cause;
}

function mutationError(
  status: number,
  code: string,
  message: string,
  currentRevision?: number,
  issues?: Array<{ rowIndex: number; columnId: string; reason: string }>
) {
  return statusError(status, message, {
    code,
    outcome: "not-committed" as const,
    ...(currentRevision === undefined ? {} : { currentRevision }),
    ...(issues?.length ? { issues } : {}),
  });
}

function collectRowIssues(
  rows: BaseRow[],
  columns: BaseColumn[],
  relationRows: readonly BaseRow[]
) {
  const byId = baseColumnIndex(columns);
  const relationTargets = baseRowIdSet(relationRows);
  const issues: Array<{ rowIndex: number; columnId: string; reason: string }> = [];
  for (const [rowIndex, row] of rows.entries()) {
    for (const [columnId, value] of Object.entries(row.values)) {
      const column = byId.get(columnId);
      if (!column) {
        issues.push({ rowIndex, columnId, reason: "unknown_column" });
        continue;
      }
      try {
        validateBaseCell(
          column,
          value as BaseCellValue,
          "external",
          relationTargets
        );
      } catch {
        issues.push({ rowIndex, columnId, reason: invalidCellReason(column) });
      }
    }
  }
  return issues;
}

function invalidCellReason(column: BaseColumn) {
  if (column.type === "attachment") return "attachment_not_allowed";
  if (column.type === "date") return "invalid_date";
  if (column.type === "url") return "invalid_https_url";
  if (column.type === "select") return "invalid_select_option";
  return `expected_${column.type}`;
}

function mutationConflict(
  error: Error,
  code: string,
  currentRevision?: number
) {
  return Object.assign(error, {
    code,
    outcome: "not-committed" as const,
    ...(currentRevision === undefined ? {} : { currentRevision }),
  });
}
