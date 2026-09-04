/**
 * [INPUT]: Depends on the portable column, view, row schema, Gallery column references refine with unique Ids, and the budget constants for shared/bases-ipc
 * [OUTPUT]: Provides BaseSnapshotFile/BaseSnapshotFileV2 and the strict portable baseSnapshotFileSchema
 * [POS]: The only agreement shared by base.json; one portable body, schemaVersion 1 or 2 on read, always 2 on write, and owner/revision never leak into it
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

/**
 * v1 与 v2 的可移植正文完全同构：v1 里唯一真正不同的东西（embed 视图、
 * 缺 attachmentColumnId 的 gallery）本来就过不了 strict 视图 schema。
 * 于是「版本」退化成一个允许两个字面量的字段，读侧不需要第二条通道，
 * 写侧一律落 2。
 */
const portableSchema = z
  .object({
    schemaVersion: z.union([z.literal(1), z.literal(2)]),
    name: baseNameSchema,
    columns: z.array(baseColumnSchema).max(BASE_COLUMN_LIMIT),
    views: z.array(baseViewSchema).min(1).max(BASE_VIEW_LIMIT),
    rows: z.array(baseRowSchema).max(BASE_ROW_LIMIT),
  })
  .strict()
  .superRefine(refinePortableSnapshot);

export const baseSnapshotFileSchema = portableSchema;

type PortableBody = {
  name: string;
  columns: BaseColumn[];
  views: BaseView[];
  rows: BaseRow[];
};

export type BaseSnapshotFileV2 = PortableBody & { schemaVersion: 2 };
export type BaseSnapshotFile = PortableBody & { schemaVersion: 1 | 2 };

/** 导出永远写 2；读侧接受 1 只是为了不给存量包再造一次迁移。 */
export function baseSnapshotFile(snapshot: BaseSnapshot): BaseSnapshotFileV2 {
  const file = baseSnapshotFileSchema.parse({
    schemaVersion: 2,
    name: snapshot.meta.name,
    columns: snapshot.meta.columns,
    views: snapshot.meta.views,
    rows: snapshot.rows,
  });
  return { ...file, schemaVersion: 2 };
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
