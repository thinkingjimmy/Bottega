/**
 * [INPUT]: Depends on the portable column, view, row schema, Gallery column references refine with unique Ids, and the budget constants for shared/bases-ipc
 * [OUTPUT]: Provides BaseSnapshotFilev2, compatible with BaseSnapshotFile input, strict v2 baseSnapshotFileSchema, v1→v2
 * [POS]: The only agreement shared by base.json; The new file only writes v2, v1 only in border mechanical migration, legacy embed explicitly refuses, and when running owner/revision never leaks
 */

import { z } from "zod";
import {
  BASE_COLUMN_LIMIT,
  BASE_ROW_BYTE_LIMIT,
  BASE_ROW_LIMIT,
  BASE_ROWS_BYTE_LIMIT,
  BASE_VIEW_LIMIT,
  type BaseColumn,
  type BaseRow,
  type BaseSnapshot,
  type BaseView,
} from "./bases-ipc";
import {
  baseColumnSchema,
  baseNameSchema,
  baseRowSchema,
  baseViewSchema,
  refineGalleryViewColumns,
  uniqueIds,
} from "./bases-schema";

export const BASE_SNAPSHOT_FILE_BYTE_LIMIT =
  BASE_ROWS_BYTE_LIMIT + 1024 * 1024;

const utf8Bytes = (value: unknown) =>
  new TextEncoder().encode(JSON.stringify(value)).byteLength;

const portableV2Schema = z
  .object({
    schemaVersion: z.literal(2),
    name: baseNameSchema,
    columns: z.array(baseColumnSchema).max(BASE_COLUMN_LIMIT),
    views: z.array(baseViewSchema).min(1).max(BASE_VIEW_LIMIT),
    rows: z.array(baseRowSchema).max(BASE_ROW_LIMIT),
  })
  .strict()
  .superRefine(refinePortableSnapshot);

const legacyV1EnvelopeSchema = z
  .object({
    schemaVersion: z.literal(1),
    name: baseNameSchema,
    columns: z.array(baseColumnSchema).max(BASE_COLUMN_LIMIT),
    views: z.array(z.unknown()).min(1).max(BASE_VIEW_LIMIT),
    rows: z.array(baseRowSchema).max(BASE_ROW_LIMIT),
  })
  .strict()
  .superRefine((snapshot, context) => {
    let hasEmbed = false;
    snapshot.views.forEach((view, index) => {
      if (legacyViewType(view) !== "embed") return;
      hasEmbed = true;
      context.addIssue({
        code: "custom",
        path: ["views", index, "config", "type"],
        message: "base.json v1 的 embed 视图不可移植；请先在旧版本中删除该视图后重试",
      });
    });
    if (hasEmbed) return;
    const migrated = portableV2Schema.safeParse(migrateLegacySnapshot(snapshot));
    if (migrated.success) return;
    migrated.error.issues.forEach((issue) => context.addIssue({
      code: "custom",
      path: issue.path,
      message: issue.message,
    }));
  });

/** v1 只是一条受控输入通道；transform 后的所有消费者只看 v2。 */
export const baseSnapshotFileSchema = z.union([
  portableV2Schema,
  legacyV1EnvelopeSchema.transform(migrateLegacySnapshot),
]);

type PortableBody = {
  name: string;
  columns: BaseColumn[];
  views: BaseView[];
  rows: BaseRow[];
};

/** @deprecated 仅供仍构造 v1 fixture 的调用方；运行时 parse 结果永远是 v2。 */
export type BaseSnapshotFileV1 = PortableBody & { schemaVersion: 1 };
export type BaseSnapshotFileV2 = PortableBody & { schemaVersion: 2 };
export type BaseSnapshotFile = BaseSnapshotFileV1 | BaseSnapshotFileV2;

export function baseSnapshotFile(snapshot: BaseSnapshot): BaseSnapshotFileV2 {
  return baseSnapshotFileSchema.parse({
    schemaVersion: 2,
    name: snapshot.meta.name,
    columns: snapshot.meta.columns,
    views: snapshot.meta.views,
    rows: snapshot.rows,
  });
}

function migrateLegacySnapshot(
  snapshot: z.infer<typeof legacyV1EnvelopeSchema>
): BaseSnapshotFileV2 {
  const columns = structuredClone(snapshot.columns);
  const views = structuredClone(snapshot.views).map((raw) => {
    const view = raw as BaseView;
    if (legacyViewType(view) !== "gallery") return view;
    const config = view.config as unknown as Record<string, unknown>;
    if (typeof config.attachmentColumnId === "string") return view;
    const attachmentColumnId =
      columns.find((column) => column.type === "attachment")?.id ??
      appendLegacyColumn(columns, "image", "Image", "attachment");
    const groupByDateColumnId =
      ensureLegacyColumn(columns, "created_at", "Created at", "date");
    return {
      ...view,
      config: {
        ...config,
        type: "gallery",
        attachmentColumnId,
        groupByDateColumnId,
        dateBucket: "minute",
      },
    } as BaseView;
  });
  return {
    schemaVersion: 2,
    name: snapshot.name,
    columns,
    views,
    rows: structuredClone(snapshot.rows),
  };
}

function appendLegacyColumn(
  columns: BaseColumn[],
  preferredId: string,
  name: string,
  type: BaseColumn["type"]
) {
  const ids = new Set(columns.map((column) => column.id));
  let id = preferredId;
  for (let suffix = 2; ids.has(id); suffix += 1) {
    id = `${preferredId}_${suffix}`;
  }
  columns.push({ id, name, type });
  return id;
}

function ensureLegacyColumn(
  columns: BaseColumn[],
  preferredId: string,
  name: string,
  type: BaseColumn["type"]
) {
  for (let suffix = 1; suffix <= BASE_COLUMN_LIMIT; suffix += 1) {
    const id = suffix === 1 ? preferredId : `${preferredId}_${suffix}`;
    const column = columns.find((candidate) => candidate.id === id);
    if (column?.type === type) return id;
    if (!column) {
      columns.push({ id, name, type });
      return id;
    }
  }
  throw new Error(`无法分配 ${preferredId} id`);
}

function legacyViewType(view: unknown) {
  if (!view || typeof view !== "object") return undefined;
  const config = (view as { config?: unknown }).config;
  if (!config || typeof config !== "object") return undefined;
  return (config as { type?: unknown }).type;
}

function refinePortableSnapshot(
  snapshot: PortableBody,
  context: z.RefinementCtx
) {
  uniqueIds(snapshot.columns, "columns", context);
  uniqueIds(snapshot.views, "views", context);
  uniqueIds(snapshot.rows, "rows", context);
  refineGalleryViewColumns(snapshot.columns, snapshot.views, context);
  const columnIds = new Set(snapshot.columns.map((column) => column.id));
  for (const [index, row] of snapshot.rows.entries()) {
    if (utf8Bytes(row) > BASE_ROW_BYTE_LIMIT) {
      context.addIssue({
        code: "custom",
        path: ["rows", index],
        message: `row ${row.id} 超过 ${BASE_ROW_BYTE_LIMIT} 字节`,
      });
    }
    for (const columnId of Object.keys(row.values)) {
      if (columnIds.has(columnId)) continue;
      context.addIssue({
        code: "custom",
        path: ["rows", index, "values", columnId],
        message: `row ${row.id} 引用了未知列 ${columnId}`,
      });
    }
  }
  if (utf8Bytes(snapshot.rows) > BASE_ROWS_BYTE_LIMIT) {
    context.addIssue({
      code: "custom",
      path: ["rows"],
      message: `rows 总量超过 ${BASE_ROWS_BYTE_LIMIT} 字节`,
    });
  }
}
