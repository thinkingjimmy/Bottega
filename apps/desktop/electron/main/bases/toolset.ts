/**
 * [INPUT]: Depends on BasesService, immutable Base reads, incarnation-bound tool context and stable batch/result helpers.
 * [OUTPUT]: Provides owner-authorized Base reads and durable Agent row/metadata batches with bounded truthful results.
 * [POS]: Base built-in tool composition; service owns authorization and Store owns original replay facts.
 */

import { renumberViews } from "../../../shared/base-views";
import { BASE_VIEW_LIMIT, type BaseColumn, type BaseRow, type BaseSnapshot, type BaseView } from "../../../shared/bases-ipc";
import { ownerKeyOf } from "@ai-chat/base-ui/model/owner-key";
import type { BuiltinToolContext, BuiltinToolset } from "../tools/registry";
import {
  BASE_QUERY_RESULT_BYTE_LIMIT,
  readBase,
  type ReadArgs,
} from "./base-read";
import type { BasesService } from "./bases-service";
import { statusError } from "../errors";
import { baseToolBatch, baseToolItem, baseToolKey } from "./service/tool/identity";
import { boundedToolBatch } from "./service/tool/result";

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
      const result = await service.toolMeta({
        signal: context.signal,
        ownerKey: ownerKeyOf(base.meta.owner),
        expectedRevision: args.expected_revision as number,
        toolIdentity: baseToolItem(baseToolBatch(context, base.meta.ownerInstanceId, "set-view"), "meta", args),
        patch: current => {
          const exists = current.meta.views.some(item => item.id === view.id);
          if (!exists && current.meta.views.length >= BASE_VIEW_LIMIT) throw statusError(400, "Base view capacity exceeded", { code: "view_capacity" });
          const views = renumberViews(exists ? current.meta.views.map(item => item.id === view.id ? view : item) : [...current.meta.views, view]);
          return { views, ...(args.set_active ? { activeViewId: view.id } : {}) };
        },
        authority: await authority(args, context, base, "meta"),
      });
      return { ...result, view_id: view.id };
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
      const result = await service.toolMeta({
        signal: context.signal,
        ownerKey: ownerKeyOf(base.meta.owner),
        expectedRevision: args.expected_revision as number,
        toolIdentity: baseToolItem(baseToolBatch(context, base.meta.ownerInstanceId, "update-columns"), "meta", args),
        patch: current => {
          const known = new Set(current.meta.columns.map(column => column.id));
          for (const id of [...renames.keys(), ...removed]) if (!known.has(id)) throw statusError(400, "Unknown Base column", { code: "unknown_column" });
          return { columns: current.meta.columns.filter(column => !removed.has(column.id)).map(column =>
            renames.has(column.id) ? { ...column, name: renames.get(column.id)! } : column) };
        },
        authority: await authority(args, context, base, "meta"),
      });
      return { ...result, renamed: renames.size, removed: removed.size };
    },
    base_add_columns: async (args, context) => {
      const base = await snapshot(args, context);
      const columns = args.columns as BaseSnapshot["meta"]["columns"];
      return service.toolMeta({
        signal: context.signal,
        ownerKey: ownerKeyOf(base.meta.owner),
        includeColumns: true,
        expectedRevision: args.expected_revision as number,
        toolIdentity: baseToolItem(baseToolBatch(context, base.meta.ownerInstanceId, "add-columns"), "meta", args),
        patch: current => { assertNewColumns(current, columns); return { columns: [...current.meta.columns, ...columns] }; },
        authority: await authority(args, context, base, "meta"),
      });
    },
    base_insert_rows: async (args, context) => {
      const base = await snapshot(args, context);
      const result = await service.toolRows({
        signal: context.signal,
        readOnly: (args.result_offset as number ?? 0) > 0,
        ownerKey: ownerKeyOf(base.meta.owner),
        batchId: baseToolBatch(context, base.meta.ownerInstanceId, "insert", args.batch_id as string | undefined),
        atomic: args.atomic === true,
        request: { kind: "insert", rows: args.rows as BaseRow[] },
        authority: await authority(args, context, base, "row-insert"),
      });
      return boundedToolBatch(result, baseToolKey(context, args.batch_id as string | undefined), args.result_offset as number ?? 0, context.lease.resultByteBudget - 512);
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
      const result = await service.toolRows({
        signal: context.signal,
        readOnly: (args.result_offset as number ?? 0) > 0,
        ownerKey: ownerKeyOf(base.meta.owner),
        batchId: baseToolBatch(context, base.meta.ownerInstanceId, "patch", args.batch_id as string | undefined),
        atomic: args.atomic === true,
        request: { kind: "patch", rows: rows.map(row => ({ rowId: row.row_id, patch: row.patch })) },
        authority: await authority(args, context, base, "row-patch"),
      });
      return boundedToolBatch(result, baseToolKey(context, args.batch_id as string | undefined), args.result_offset as number ?? 0, context.lease.resultByteBudget - 512);
    },
    base_delete_rows: async (args, context) => {
      const base = await snapshot(args, context);
      const result = await service.toolRows({
        signal: context.signal,
        readOnly: (args.result_offset as number ?? 0) > 0,
        ownerKey: ownerKeyOf(base.meta.owner),
        batchId: baseToolBatch(context, base.meta.ownerInstanceId, "delete", args.batch_id as string | undefined),
        atomic: args.atomic === true,
        request: { kind: "delete", rowIds: args.row_ids as string[] },
        authority: await authority(args, context, base, "row-delete"),
      });
      return boundedToolBatch(result, baseToolKey(context, args.batch_id as string | undefined), args.result_offset as number ?? 0, context.lease.resultByteBudget - 512);
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
