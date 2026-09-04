/**
 * [INPUT]: Depends on BasesService, base-read only projection kernel, shared ownerKey/Base mutation and incarnation-bound tools context, plus the shared statusError constructor from main/errors
 * [OUTPUT]: Provides nine Base handlers over the current chat's writable Base, plus the single owner-aware `read_base` path that never creates a Base
 * [POS]: The base area is the combination and mutation layer of the common built-in tool platform; Owner Parsing/Authorization only in service
 */

import { renumberViews } from "../../../shared/base-views";
import {
  BASE_VIEW_LIMIT,
  ownerKeyOf,
  type BaseColumn,
  type BaseRow,
  type BaseSnapshot,
  type BaseView,
} from "../../../shared/bases-ipc";
import type { BuiltinToolContext, BuiltinToolset } from "../tools/registry";
import {
  BASE_QUERY_RESULT_BYTE_LIMIT,
  readBase,
  type ReadArgs,
} from "./base-read";
import type { BasesService } from "./bases-service";
import { statusError } from "../errors";

export function createBaseToolset(
  service: BasesService,
  isEffectiveArchived: (chatId: string) => boolean = () => false
): BuiltinToolset {
  const appIdOf = (args: Record<string, unknown>) => {
    const target = args.target;
    return typeof target === "string" ? target.slice("app:".length) : undefined;
  };
  const snapshot = (
    args: Record<string, unknown>,
    context: BuiltinToolContext,
    ensure = true
  ) => {
    const appId = appIdOf(args);
    return appId
      ? service.snapshotForApp(appId, context.lease, ensure)
      : service.snapshotForLease(
          context.lease.chatId,
          context.lease.incarnationId,
          ensure
        );
  };
  const authority = async (
    args: Record<string, unknown>,
    context: BuiltinToolContext,
    base: BaseSnapshot,
    operation: import("./service/base-commit-authority").BaseMutationOperation
  ) => service.issueToolMutationAuthority({
    ownerKey: ownerKeyOf(base.meta.owner),
    lease: context.lease,
    operation,
    ...(appIdOf(args) ? { appId: appIdOf(args) } : {}),
  });

  return {
    base_describe: async (args, context) =>
      describe(await snapshot(args, context)),
    /* 三种寻址一条路径：省略 section_id/target 即当前 chat 的可写 Base。
       读永远 ensure=false —— 没有 Base 就是 404，读工具不负责建表。 */
    read_base: async (args, context) => {
      const appId = appIdOf(args);
      const sectionId = args.section_id as string | undefined;
      const base = appId
        ? await service.snapshotForApp(appId, context.lease, false)
        : sectionId
          ? await service.snapshotForRead(sectionId)
          : await service.snapshotForLease(
              context.lease.chatId,
              context.lease.incarnationId,
              false
            );
      return {
        ...(readBase(
          base,
          args as ReadArgs,
          Math.min(BASE_QUERY_RESULT_BYTE_LIMIT, context.lease.resultByteBudget) -
            128
        ) as Record<string, unknown>),
        effective_archived: appId
          ? false
          : isEffectiveArchived(sectionId ?? context.lease.chatId),
      };
    },
    base_export_csv: async (args, context) => {
      const base = await snapshot(args, context);
      return service.exportArtifact(ownerKeyOf(base.meta.owner));
    },
    base_set_view: async (args, context) => {
      const base = await snapshot(args, context);
      const view = args.view as BaseView;
      const exists = base.meta.views.some((item) => item.id === view.id);
      if (!exists && base.meta.views.length >= BASE_VIEW_LIMIT) {
        throw statusError(400, `Base 视图不能超过 ${BASE_VIEW_LIMIT} 个`);
      }
      const views = renumberViews(
        exists
          ? base.meta.views.map((item) => (item.id === view.id ? view : item))
          : [...base.meta.views, view]
      );
      const next = await service.updateMeta({
        ownerKey: ownerKeyOf(base.meta.owner),
        expectedRevision: args.expected_revision as number,
        patch: {
          views,
          ...(args.set_active ? { activeViewId: view.id } : {}),
        },
        authority: await authority(args, context, base, "meta"),
      });
      return {
        revision: next.meta.revision,
        view_id: view.id,
        view_count: next.meta.views.length,
        active_view_id: next.meta.activeViewId,
      };
    },
    base_update_columns: async (args, context) => {
      const base = await snapshot(args, context);
      const renames = new Map(
        (args.renames as Array<{ column_id: string; name: string }> | undefined)
          ?.map((item) => [item.column_id, item.name]) ?? []
      );
      const removed = new Set(
        (args.remove_column_ids as string[] | undefined) ?? []
      );
      const known = new Set(base.meta.columns.map((column) => column.id));
      for (const id of [...renames.keys(), ...removed]) {
        if (!known.has(id)) throw statusError(400, `未知列 ${id}`);
      }
      const columns = base.meta.columns
        .filter((column) => !removed.has(column.id))
        .map((column) =>
          renames.has(column.id)
            ? { ...column, name: renames.get(column.id)! }
            : column
        );
      const next = await service.updateMeta({
        ownerKey: ownerKeyOf(base.meta.owner),
        expectedRevision: args.expected_revision as number,
        patch: { columns },
        authority: await authority(args, context, base, "meta"),
      });
      return {
        revision: next.meta.revision,
        column_count: next.meta.columns.length,
        renamed: renames.size,
        removed: removed.size,
      };
    },
    base_add_columns: async (args, context) => {
      const base = await snapshot(args, context);
      const columns = args.columns as BaseSnapshot["meta"]["columns"];
      assertNewColumns(base, columns);
      const next = await service.updateMeta({
        ownerKey: ownerKeyOf(base.meta.owner),
        expectedRevision: args.expected_revision as number,
        patch: { columns: [...base.meta.columns, ...columns] },
        authority: await authority(args, context, base, "meta"),
      });
      return describe(next);
    },
    base_insert_rows: async (args, context) => {
      const base = await snapshot(args, context);
      const next = await service.insertRows({
        ownerKey: ownerKeyOf(base.meta.owner),
        rows: args.rows as BaseRow[],
        authority: await authority(args, context, base, "row-insert"),
      });
      return rowMutationResult(next);
    },
    base_patch_rows: async (args, context) => {
      const base = await snapshot(args, context);
      const rows = args.rows as Array<{
        row_id: string;
        patch: Record<
          string,
          import("../../../shared/bases-ipc").BaseCellValue | null
        >;
      }>;
      const next = await service.patchRows(
        ownerKeyOf(base.meta.owner),
        rows.map((row) => ({ rowId: row.row_id, patch: row.patch })),
        await authority(args, context, base, "row-patch")
      );
      return rowMutationResult(next);
    },
    base_delete_rows: async (args, context) => {
      const base = await snapshot(args, context);
      const next = await service.deleteRows({
        ownerKey: ownerKeyOf(base.meta.owner),
        rowIds: args.row_ids as string[],
        authority: await authority(args, context, base, "row-delete"),
      });
      return rowMutationResult(next);
    },
  };
}

function describe(base: BaseSnapshot) {
  return {
    owner: base.meta.owner.kind,
    ownerKey: ownerKeyOf(base.meta.owner),
    ownerInstanceId: base.meta.ownerInstanceId,
    name: base.meta.name,
    revision: base.meta.revision,
    rowCount: base.rows.length,
    columns: base.meta.columns,
    views: base.meta.views,
    activeViewId: base.meta.activeViewId,
  };
}

function assertNewColumns(base: BaseSnapshot, columns: BaseColumn[]) {
  const ids = new Set(base.meta.columns.map((column) => column.id));
  for (const column of columns) {
    if (ids.has(column.id)) throw statusError(409, `列 ${column.id} 已存在`);
    ids.add(column.id);
  }
}

function rowMutationResult(base: BaseSnapshot) {
  return { revision: base.meta.revision, rowCount: base.rows.length };
}
