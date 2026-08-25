/**
 * [INPUT]: Depends on zod, shared Bases schema and builtin-tools/platform queries/annotations/spec
 * [OUTPUT]: Provides three-mode cross-Section read_base cross-sectional scrutiny with registration phase, six row-backed views, Gallery/Chart configuration and batch updates, and 10 static specs and `$ref`-free wire schema
 * [POS]: The truth about the Bases field of builtin-tools; The platform is down to the shared IPC
 */

import { z } from "zod";
import {
  BASE_COLUMN_LIMIT,
  BASE_DELETE_LIMIT,
  BASE_INSERT_LIMIT,
  BASE_VIEW_LIMIT,
  BASE_AGGREGATIONS,
} from "../bases-ipc";
import {
  baseCellValueSchema,
  baseColumnSchema,
  baseFilterSchema,
  baseNameSchema,
  baseRowSchema,
  baseViewSchema,
} from "../bases-schema";
import { CHART_TYPES } from "../chart-payload";
import {
  baseFilterWireSchema,
  baseQueryShape,
  entityId,
  mutation,
  read,
  sectionId,
  type BuiltinToolSpec,
} from "./platform";

const basesHint =
  "Base 是当前 chat 可写的本地数据表：优先使用 chat 自有 Base，无自有 Base 时使用所属 Project 的共享 Base；用户要建表格/记账/清单时优先使用 Base 工具，不要在工作区另建电子表格文件。操作本轮已附加 App 的 Base 时必须显式传 target。";
/* target 的语义必须写在参数自己身上：工具 description 走 tools/list，是四家
   CLI 都必然转交模型的通道；server-level instructions 则不是（部分 CLI 丢弃）。 */
const appTarget = z
  .string()
  .regex(/^app:[a-z0-9]{10}$/)
  .optional()
  .describe(
    '省略＝当前 chat 可写的 Base；"app:<id>"＝本轮已附加 App 的 Base（仅支持读与行级写），可用 id 见本轮上下文的 Attached App 说明'
  );

const sortWireSchema = z
  .array(
    z.object({ columnId: entityId, direction: z.enum(["asc", "desc"]) }).strict()
  )
  .max(BASE_COLUMN_LIMIT)
  .optional();
const commonViewWire = { filter: baseFilterWireSchema.optional(), sorts: sortWireSchema };
const chartItemWireSchema = z
  .object({
    id: entityId,
    name: z.string().trim().min(1).max(60).optional(),
    chartType: z.enum(CHART_TYPES),
    dimensionColumnId: entityId.optional(),
    dateBucket: z.enum(["day", "month"]).optional(),
    valueColumnIds: z.array(entityId).max(3).optional(),
    seriesColumnId: entityId.optional(),
    aggregation: z.enum(BASE_AGGREGATIONS).optional(),
    accessibleColors: z
      .boolean()
      .optional()
      .describe("是否用纹理辅助区分数据系列；默认 false"),
    filter: baseFilterWireSchema.optional(),
    filterScrubbed: z.literal(true).optional(),
    colSpan: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
    rowSpan: z.union([z.literal(1), z.literal(2)]),
  })
  .strict();
const baseViewConfigWireSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("table"), ...commonViewWire,
    visibleColumnIds: z.array(entityId).max(BASE_COLUMN_LIMIT).optional(),
    columnWidths: z.record(entityId, z.number().int().min(80).max(640)).optional(),
    groupByColumnId: entityId.optional(),
    columnAggregations: z.record(entityId, z.enum(BASE_AGGREGATIONS).nullable()).optional(),
  }).strict(),
  z.object({ type: z.literal("list"), ...commonViewWire,
    visibleColumnIds: z.array(entityId).max(BASE_COLUMN_LIMIT).optional(),
    groupByColumnId: entityId.optional(),
  }).strict(),
  z.object({ type: z.literal("kanban"), ...commonViewWire,
    visibleColumnIds: z.array(entityId).max(BASE_COLUMN_LIMIT).optional(),
    groupByColumnId: entityId.optional(),
  }).strict(),
  z.object({ type: z.literal("map"), ...commonViewWire,
    locationColumnId: entityId.optional(), labelColumnId: entityId.optional(),
  }).strict(),
  z.object({ type: z.literal("chart"), ...commonViewWire,
    charts: z.array(chartItemWireSchema).max(12),
    viewFilterScrubbed: z.literal(true).optional(),
  }).strict(),
  z.object({ type: z.literal("gallery"), ...commonViewWire,
    attachmentColumnId: entityId,
    titleColumnId: entityId.optional(),
    groupByDateColumnId: entityId.optional(),
    dateBucket: z.enum(["minute", "hour", "day", "week", "month"]).optional(),
  }).strict(),
]).superRefine((config, context) => {
  if (config.type === "gallery" && config.dateBucket && !config.groupByDateColumnId) {
    context.addIssue({
      code: "custom",
      path: ["dateBucket"],
      message: "Gallery dateBucket 需要 groupByDateColumnId",
    });
  }
});
const baseViewWireSchema = z.object({
  id: entityId,
  name: baseNameSchema,
  order: z.number().int().nonnegative().max(BASE_VIEW_LIMIT - 1),
  config: baseViewConfigWireSchema,
}).strict();
const renameSchema = z.object({ column_id: entityId, name: baseNameSchema }).strict();
const uniqueIds = (values: readonly string[]) => new Set(values).size === values.length;
const updateColumnsSchema = z
  .object({
    renames: z.array(renameSchema).min(1).max(16).optional(),
    remove_column_ids: z.array(entityId).min(1).max(16).refine(uniqueIds, "remove_column_ids 必须唯一").optional(),
    expected_revision: z.number().int().nonnegative(),
    target: appTarget,
  })
  .strict()
  .superRefine((value, context) => {
    const renameIds = (value.renames ?? []).map((item) => item.column_id);
    if (!renameIds.length && !value.remove_column_ids?.length) {
      context.addIssue({ code: "custom", message: "至少提供 renames 或 remove_column_ids" });
    }
    if (!uniqueIds(renameIds)) {
      context.addIssue({ code: "custom", path: ["renames"], message: "rename column_id 必须唯一" });
    }
    const removed = new Set(value.remove_column_ids ?? []);
    if (renameIds.some((id) => removed.has(id))) {
      context.addIssue({ code: "custom", message: "改名与删除列集合不能相交" });
    }
  });

const readBaseSchema = (filter: z.ZodType) =>
  baseQueryShape(filter)
    .extend({
      section_id: sectionId.optional(),
      target: appTarget,
      row_ids: z.array(entityId).min(1).max(100).optional(),
      options_for: entityId.optional(),
    })
    .superRefine((value, context) => {
      if (Boolean(value.section_id) === Boolean(value.target)) {
        context.addIssue({
          code: "custom",
          path: ["target"],
          message: "section_id 与 target 必须且只能提供一个",
        });
      }
      const hasQuery =
        value.filter !== undefined ||
        value.sort !== undefined ||
        value.columns !== undefined;
      if (
        value.row_ids &&
        (value.options_for !== undefined ||
          hasQuery ||
          value.cursor !== undefined)
      ) {
        context.addIssue({
          code: "custom",
          path: ["row_ids"],
          message:
            "row_ids 与 filter/sort/columns/cursor/options_for 互斥",
        });
      }
      if (value.options_for !== undefined && hasQuery) {
        context.addIssue({
          code: "custom",
          path: ["options_for"],
          message: "options_for 与 filter/sort/columns 互斥",
        });
      }
    });

export const BASE_TOOL_SPECS = [
  {
    name: "base_describe",
    domainId: "bases",
    access: "read",
    description: `读取当前 chat 可写 Base 的 owner、列、视图、revision 与行数。${basesHint}`,
    inputSchema: z.object({ target: appTarget }).strict(),
    annotations: read,
  },
  {
    name: "base_query",
    domainId: "bases",
    access: "read",
    description:
      "分页查询当前 chat 可写的 Base；支持 Filter AST、排序和 columns 投影，返回 nextCursor。",
    inputSchema: baseQueryShape(baseFilterSchema).extend({ target: appTarget }),
    wireInputSchema: baseQueryShape(baseFilterWireSchema).extend({ target: appTarget }),
    annotations: read,
  },
  {
    name: "read_base",
    domainId: "bases",
    access: "read",
    description:
      "跨 Section 读取 Base，三种模式互斥：默认按 filter/sort/columns 查询；row_ids 按给定顺序直取并以 missing_row_ids/remaining_row_ids 保证续读前进；options_for 分页读取 select 列完整 options。column_meta 只覆盖投影列，options_truncated 时改用 options_for。",
    inputSchema: readBaseSchema(baseFilterSchema),
    wireInputSchema: readBaseSchema(baseFilterWireSchema),
    annotations: read,
  },
  {
    name: "base_export_csv",
    domainId: "bases",
    access: "read",
    description:
      "把当前 Base 完整导出到应用私有 exports 目录，返回 path/bytes/rowCount 元数据，不内联文件正文。",
    inputSchema: z.object({ target: appTarget }).strict(),
    annotations: read,
  },
  {
    name: "base_set_view",
    domainId: "bases",
    access: "mutate",
    description:
      "创建、替换或追加当前 Base 的单个命名视图，统一归一 order；可原子设为 active。view.config.type 固定为 table｜list｜kanban｜map｜chart｜gallery。Gallery 必须指定 attachmentColumnId，可选 titleColumnId、groupByDateColumnId 与 minute/hour/day/week/month dateBucket，并与其它视图一样支持 filter/sorts。chart 视图的 charts 数组最多 12 个图，每图 chartType 支持 pie/bar/line/stacked-bar/scatter/radar/heatmap，可选 aggregation 聚合、dateBucket 时间分桶与 accessibleColors 无障碍颜色（默认关闭）。附加 App 的 Base（target）不支持视图变更，见 target 参数说明。",
    crossReferences: [
      {
        mentions: ["base_describe"],
        text: "先 base_describe 取列 id 与 expected_revision。",
      },
    ],
    inputSchema: z.object({
      view: baseViewSchema,
      set_active: z.boolean().default(false),
      expected_revision: z.number().int().nonnegative(),
      target: appTarget,
    }).strict(),
    wireInputSchema: z.object({
      view: baseViewWireSchema,
      set_active: z.boolean().default(false),
      expected_revision: z.number().int().nonnegative(),
      target: appTarget,
    }).strict(),
    annotations: mutation,
  },
  {
    name: "base_update_columns",
    domainId: "bases",
    access: "mutate",
    description:
      "在不改变类型的前提下批量改名或删除当前 Base 的列；删除会清理行值与视图引用。附加 App 的 Base 不支持此操作：带 target 调用必返 403；列/视图变更请让用户在该 App 的 Use chat 里做，或在 Base 界面手动操作。",
    inputSchema: updateColumnsSchema,
    annotations: { ...mutation, destructiveHint: true },
  },
  {
    name: "base_add_columns",
    domainId: "bases",
    access: "mutate",
    description:
      "向当前 Base 追加列；不支持改类型或删除列。附加 App 的 Base 不支持此操作：带 target 调用必返 403；列/视图变更请让用户在该 App 的 Use chat 里做，或在 Base 界面手动操作。",
    inputSchema: z
      .object({
        columns: z.array(baseColumnSchema).min(1).max(16),
        expected_revision: z.number().int().nonnegative(),
        target: appTarget,
      })
      .strict(),
    annotations: mutation,
  },
  {
    name: "base_insert_rows",
    domainId: "bases",
    access: "mutate",
    description: "按调用方稳定 row id 幂等插入当前 Base；同 id 同内容跳过、不同内容返回 409，单批最多 500 行。",
    inputSchema: z
      .object({
        rows: z.array(baseRowSchema).min(1).max(BASE_INSERT_LIMIT),
        target: appTarget,
      })
      .strict(),
    annotations: mutation,
  },
  {
    name: "base_patch_rows",
    domainId: "bases",
    access: "mutate",
    description: "字段级 LWW 批量 patch 当前 Base；null 清空单元格，目标行被并发删除时报 404，单批最多 100 行。",
    inputSchema: z
      .object({
        rows: z
          .array(
            z
              .object({
                row_id: entityId,
                patch: z.record(entityId, baseCellValueSchema.nullable()),
              })
              .strict()
          )
          .min(1)
          .max(100),
        target: appTarget,
      })
      .strict(),
    annotations: mutation,
  },
  {
    name: "base_delete_rows",
    domainId: "bases",
    access: "mutate",
    description: "删除当前 Base 的行，单批最多 100 行；不存在的 id 是 no-op。",
    inputSchema: z
      .object({
        row_ids: z.array(entityId).min(1).max(Math.min(100, BASE_DELETE_LIMIT)),
        target: appTarget,
      })
      .strict(),
    annotations: { ...mutation, destructiveHint: true },
  },
] as const satisfies readonly BuiltinToolSpec[];
