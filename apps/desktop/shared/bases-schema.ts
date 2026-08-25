/**
 * [INPUT]: Depends on the constants and types of zod, bases-ipc, chart-payload of CHART_TYPES, base-aggregations, base-view-config and attachment schema of bases/gallery-attachments
 * [OUTPUT]: Provides Base owner/columns/rows/filters/six-category row-backed views/meta, stable XLSX issue report, all IPC input differential mutation result checker, and uniqueIds/Gallery column references shared across files
 * [POS]: The shared Base Scanner is the single source of truth; With the agent-IPC/agent-schema and the same configuration as the base-ipc, only the type, constant and pure functions are left, the calibrator always stays here, and the renderer is not required to be the zod for IPC calibration
 */

import { z } from "zod";
import { CHART_TYPES } from "./chart-payload";
import { BASE_AGGREGATIONS } from "./base-aggregations";
import { BASE_FORMULA_EXPRESSION_LIMIT } from "./base-formula";
import { baseAttachmentValueSchema } from "./bases/gallery-attachments";
import type {
  BaseCellValue,
  BaseColumn,
  BaseRow,
} from "./base-values";
import type {
  BaseFilter,
  BaseFilterComparison,
  BaseViewConfig,
  ChartItem,
} from "./base-view-config";
import {
  BASE_CELL_STRING_LIMIT,
  BASE_CHAT_ID_PATTERN,
  BASE_COLUMN_LIMIT,
  BASE_COLUMN_WIDTH_MAX,
  BASE_COLUMN_WIDTH_MIN,
  BASE_DELETE_LIMIT,
  BASE_ENTITY_ID_PATTERN,
  BASE_FILTER_DEPTH_LIMIT,
  BASE_FILTER_NODE_LIMIT,
  BASE_INSERT_LIMIT,
  BASE_MUTATION_OPERATIONS,
  BASE_NAME_LIMIT,
  BASE_OWNER_KEY_PATTERN,
  BASE_ROW_LIMIT,
  BASE_SELECT_OPTION_LIMIT,
  BASE_VIEW_LIMIT,
  BASE_XLSX_ISSUE_REASONS,
  CHART_ITEM_LIMIT,
  type BaseMeta,
  type BaseOwner,
  type BaseView,
} from "./bases-ipc";

export const baseOwnerSchema: z.ZodType<BaseOwner> = z.discriminatedUnion(
  "kind",
  [
  z
    .object({
      kind: z.literal("chat"),
      chatId: z.string().regex(BASE_CHAT_ID_PATTERN),
      incarnationId: z.string().regex(BASE_ENTITY_ID_PATTERN),
    })
    .strict(),
  z
    .object({
      kind: z.literal("project"),
      projectId: z.string().regex(BASE_ENTITY_ID_PATTERN),
    })
    .strict(),
  ]
);

const entityIdSchema = z.string().regex(BASE_ENTITY_ID_PATTERN);
export const baseNameSchema = z.string().trim().min(1).max(BASE_NAME_LIMIT);
/* 与 parser 同一把尺：口径是 UTF-8 字节，不是 UTF-16 码元。用 .max() 的话
   4096 个汉字能过 zod，却在求值时被 parser 判成 #LIMIT!——两把尺必须合一。 */
const formulaExpressionSchema = z
  .string()
  .trim()
  .min(1)
  .refine(
    (value) =>
      new TextEncoder().encode(value).byteLength <=
      BASE_FORMULA_EXPRESSION_LIMIT,
    { message: `公式表达式超过 ${BASE_FORMULA_EXPRESSION_LIMIT} 字节` }
  );
const locationSchema = z
  .object({
    lat: z.number().finite().min(-90).max(90),
    lng: z.number().finite().min(-180).max(180),
  })
  .strict();

export const baseCellValueSchema: z.ZodType<BaseCellValue> = z.union([
  z.string().max(BASE_CELL_STRING_LIMIT),
  z.number().finite(),
  z.boolean(),
  locationSchema,
  baseAttachmentValueSchema,
]);

const selectOptionSchema = z
  .object({
    id: entityIdSchema,
    label: baseNameSchema,
    color: z.string().max(64).optional(),
  })
  .strict();

export const baseColumnSchema: z.ZodType<BaseColumn> = z
  .object({
    id: entityIdSchema,
    name: baseNameSchema,
    type: z.enum([
      "text",
      "number",
      "date",
      "select",
      "checkbox",
      "url",
      "location",
      "attachment",
      "formula",
      "relation",
    ]),
    options: z.array(selectOptionSchema).max(BASE_SELECT_OPTION_LIMIT).optional(),
    formula: z
      .object({
        expression: formulaExpressionSchema,
        resultType: z.enum(["number", "text", "boolean"]),
        invalidReferences: z.array(entityIdSchema).max(BASE_COLUMN_LIMIT).optional(),
      })
      .strict()
      .optional(),
    relation: z
      .object({ labelColumnId: entityIdSchema.nullable() })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((column, context) => {
    if (column.type !== "select" && column.options !== undefined) {
      context.addIssue({
        code: "custom",
        path: ["options"],
        message: "只有 select 列可以声明 options",
      });
    }
    if (column.type !== "formula" && column.formula !== undefined) {
      context.addIssue({
        code: "custom",
        path: ["formula"],
        message: "只有 formula 列可以声明 formula",
      });
    }
    if (column.type === "formula" && column.formula === undefined) {
      context.addIssue({
        code: "custom",
        path: ["formula"],
        message: "formula 列必须声明表达式",
      });
    }
    if (column.type !== "relation" && column.relation !== undefined) {
      context.addIssue({
        code: "custom",
        path: ["relation"],
        message: "只有 relation 列可以声明 relation",
      });
    }
    if (column.type === "relation" && column.relation === undefined) {
      context.addIssue({
        code: "custom",
        path: ["relation"],
        message: "relation 列必须声明显示列",
      });
    }
  });

export const baseRowSchema: z.ZodType<BaseRow> = z
  .object({
    id: entityIdSchema,
    values: z.record(entityIdSchema, baseCellValueSchema),
  })
  .strict();

const valueComparisonSchema = z
  .object({
    kind: z.literal("condition"),
    columnId: entityIdSchema,
    operator: z.enum([
      "eq",
      "neq",
      "contains",
      "gt",
      "gte",
      "lt",
      "lte",
    ]),
    value: baseCellValueSchema,
  })
  .strict();

const emptyComparisonSchema = z
  .object({
    kind: z.literal("condition"),
    columnId: entityIdSchema,
    operator: z.enum(["is-empty", "not-empty"]),
  })
  .strict();

const comparisonSchema: z.ZodType<BaseFilterComparison> =
  z.discriminatedUnion("operator", [
    valueComparisonSchema,
    emptyComparisonSchema,
  ]);

const rawFilterSchema: z.ZodType<BaseFilter> = z.lazy(() =>
  z.union([
    comparisonSchema,
    z
      .object({
        kind: z.enum(["and", "or"]),
        filters: z.array(rawFilterSchema).min(1).max(BASE_FILTER_NODE_LIMIT),
      })
      .strict(),
    z
      .object({
        kind: z.literal("not"),
        filter: rawFilterSchema,
      })
      .strict(),
  ])
);

function filterBudget(filter: BaseFilter) {
  let nodes = 0;
  let depth = 0;
  const visit = (current: BaseFilter, level: number) => {
    nodes += 1;
    depth = Math.max(depth, level);
    if (current.kind === "not") visit(current.filter, level + 1);
    if (current.kind === "and" || current.kind === "or") {
      current.filters.forEach((child) => visit(child, level + 1));
    }
  };
  visit(filter, 1);
  return { nodes, depth };
}

export const baseFilterSchema: z.ZodType<BaseFilter> =
  rawFilterSchema.superRefine((filter, context) => {
    const budget = filterBudget(filter);
    if (budget.depth > BASE_FILTER_DEPTH_LIMIT) {
      context.addIssue({
        code: "custom",
        message: `Filter AST 深度不能超过 ${BASE_FILTER_DEPTH_LIMIT}`,
      });
    }
    if (budget.nodes > BASE_FILTER_NODE_LIMIT) {
      context.addIssue({
        code: "custom",
        message: `Filter AST 节点不能超过 ${BASE_FILTER_NODE_LIMIT}`,
      });
    }
  });

const sortSchema = z
  .object({
    columnId: entityIdSchema,
    direction: z.enum(["asc", "desc"]),
  })
  .strict();

const commonViewShape = {
  filter: baseFilterSchema.optional(),
  sorts: z.array(sortSchema).max(BASE_COLUMN_LIMIT).optional(),
};

const chartItemSchema: z.ZodType<ChartItem> = z
  .object({
    id: entityIdSchema,
    name: z.string().trim().min(1).max(60).optional(),
    chartType: z.enum(CHART_TYPES),
    dimensionColumnId: entityIdSchema.optional(),
    dateBucket: z.enum(["day", "month"]).optional(),
    valueColumnIds: z.array(entityIdSchema).max(3).optional(),
    seriesColumnId: entityIdSchema.optional(),
    aggregation: z.enum(BASE_AGGREGATIONS).optional(),
    accessibleColors: z.boolean().optional(),
    filter: baseFilterSchema.optional(),
    filterScrubbed: z.literal(true).optional(),
    colSpan: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
    rowSpan: z.union([z.literal(1), z.literal(2)]),
  })
  .strict()
  .superRefine((item, context) => {
    const ids = item.valueColumnIds ?? [];
    if (new Set(ids).size !== ids.length) {
      context.addIssue({
        code: "custom",
        path: ["valueColumnIds"],
        message: "valueColumnIds 必须唯一",
      });
    }
  });

const chartItemsSchema = z
  .array(chartItemSchema)
  .max(CHART_ITEM_LIMIT)
  .superRefine((items, context) => uniqueIds(items, "charts", context));

const columnWidthsSchema = z
  .record(
    entityIdSchema,
    z
      .number()
      .int()
      .min(BASE_COLUMN_WIDTH_MIN)
      .max(BASE_COLUMN_WIDTH_MAX)
  )
  .superRefine((widths, context) => {
    if (Object.keys(widths).length > BASE_COLUMN_LIMIT) {
      context.addIssue({
        code: "custom",
        message: "列宽数量超限",
      });
    }
  });

const columnAggregationsSchema = z
  .record(entityIdSchema, z.enum(BASE_AGGREGATIONS).nullable())
  .superRefine((aggregations, context) => {
    if (Object.keys(aggregations).length > BASE_COLUMN_LIMIT) {
      context.addIssue({
        code: "custom",
        message: "列统计数量超限",
      });
    }
  });

export const baseViewConfigSchema: z.ZodType<BaseViewConfig> =
  z.discriminatedUnion("type", [
    z
      .object({
        type: z.literal("table"),
        ...commonViewShape,
        visibleColumnIds: z.array(entityIdSchema).max(BASE_COLUMN_LIMIT).optional(),
        columnWidths: columnWidthsSchema.optional(),
        groupByColumnId: entityIdSchema.optional(),
        columnAggregations: columnAggregationsSchema.optional(),
      })
      .strict(),
    z
      .object({
        type: z.literal("list"),
        ...commonViewShape,
        visibleColumnIds: z.array(entityIdSchema).max(BASE_COLUMN_LIMIT).optional(),
        groupByColumnId: entityIdSchema.optional(),
      })
      .strict(),
    z
      .object({
        type: z.literal("kanban"),
        ...commonViewShape,
        visibleColumnIds: z.array(entityIdSchema).max(BASE_COLUMN_LIMIT).optional(),
        groupByColumnId: entityIdSchema.optional(),
      })
      .strict(),
    z
      .object({
        type: z.literal("map"),
        ...commonViewShape,
        locationColumnId: entityIdSchema.optional(),
        labelColumnId: entityIdSchema.optional(),
      })
      .strict(),
    z
      .object({
        type: z.literal("chart"),
        ...commonViewShape,
        charts: chartItemsSchema,
        viewFilterScrubbed: z.literal(true).optional(),
      })
      .strict(),
    z
      .object({
        type: z.literal("gallery"),
        ...commonViewShape,
        attachmentColumnId: entityIdSchema,
        titleColumnId: entityIdSchema.optional(),
        groupByDateColumnId: entityIdSchema.optional(),
        dateBucket: z
          .enum(["minute", "hour", "day", "week", "month"])
          .optional(),
      })
      .strict(),
  ]).superRefine((config, context) => {
    if (
      config.type === "gallery" &&
      config.dateBucket &&
      !config.groupByDateColumnId
    ) {
      context.addIssue({
        code: "custom",
        path: ["dateBucket"],
        message: "Gallery dateBucket 需要 groupByDateColumnId",
      });
    }
  });

export const baseViewSchema: z.ZodType<BaseView> = z
  .object({
    id: entityIdSchema,
    name: baseNameSchema,
    order: z.number().int().nonnegative().max(BASE_VIEW_LIMIT - 1),
    config: baseViewConfigSchema,
  })
  .strict();

export const baseMetaSchema: z.ZodType<BaseMeta> = z
  .object({
    owner: baseOwnerSchema,
    ownerInstanceId: entityIdSchema,
    name: baseNameSchema,
    pinned: z.boolean(),
    columns: z.array(baseColumnSchema).max(BASE_COLUMN_LIMIT),
    views: z.array(baseViewSchema).min(1).max(BASE_VIEW_LIMIT),
    activeViewId: entityIdSchema,
    revision: z.number().int().nonnegative(),
    rowsGeneration: z.number().int().nonnegative(),
    galleryGeneration: z.number().int().nonnegative().default(0),
    historyGeneration: z.number().int().nonnegative().default(0),
  })
  .strict()
  .superRefine((meta, context) => {
    if (
      meta.owner.kind === "chat" &&
      meta.owner.incarnationId !== meta.ownerInstanceId
    ) {
      context.addIssue({
        code: "custom",
        path: ["ownerInstanceId"],
        message: "chat Base 的 ownerInstanceId 必须等于 incarnationId",
      });
    }
    uniqueIds(meta.columns, "columns", context);
    uniqueIds(meta.views, "views", context);
    refineGalleryViewColumns(meta.columns, meta.views, context);
    if (!meta.views.some((view) => view.id === meta.activeViewId)) {
      context.addIssue({
        code: "custom",
        path: ["activeViewId"],
        message: "activeViewId 必须指向现有视图",
      });
    }
  });

/** 供本文件与 base-snapshot 的 zod refine 共用；同一约束不写第二遍。 */
export function uniqueIds(
  values: Array<{ id: string }>,
  path: string,
  context: z.RefinementCtx
) {
  if (new Set(values.map((value) => value.id)).size !== values.length) {
    context.addIssue({
      code: "custom",
      path: [path],
      message: `${path} id 必须唯一`,
    });
  }
}

/** Gallery 的 required attachment 与可选日期列在同一份 schema 上机械交叉校验。 */
export function refineGalleryViewColumns(
  columns: BaseColumn[],
  views: BaseView[],
  context: z.RefinementCtx
) {
  const byId = new Map(columns.map((column) => [column.id, column]));
  views.forEach((view, index) => {
    if (view.config.type !== "gallery") return;
    const attachment = byId.get(view.config.attachmentColumnId);
    if (attachment?.type !== "attachment") {
      context.addIssue({
        code: "custom",
        path: ["views", index, "config", "attachmentColumnId"],
        message: attachment
          ? `Gallery attachmentColumnId 必须指向 attachment 列`
          : `Gallery 引用了未知附件列 ${view.config.attachmentColumnId}`,
      });
    }
    if (view.config.titleColumnId && !byId.has(view.config.titleColumnId)) {
      context.addIssue({
        code: "custom",
        path: ["views", index, "config", "titleColumnId"],
        message: `Gallery 引用了未知标题列 ${view.config.titleColumnId}`,
      });
    }
    if (view.config.groupByDateColumnId) {
      const date = byId.get(view.config.groupByDateColumnId);
      if (date?.type !== "date") {
        context.addIssue({
          code: "custom",
          path: ["views", index, "config", "groupByDateColumnId"],
          message: date
            ? `Gallery groupByDateColumnId 必须指向 date 列`
            : `Gallery 引用了未知日期列 ${view.config.groupByDateColumnId}`,
        });
      }
    }
  });
}

const ownerInputSchema = z
  .object({ ownerKey: z.string().regex(BASE_OWNER_KEY_PATTERN) })
  .strict();

export const baseGetInputSchema = ownerInputSchema;

const authorityLeaseIdSchema = z.string().uuid();

export const baseAuthorizeMutationInputSchema = z
  .object({
    ownerKey: z.string().regex(BASE_OWNER_KEY_PATTERN),
    operation: z.enum(BASE_MUTATION_OPERATIONS),
    expectedRevision: z.number().int().nonnegative().nullable(),
    surfaceLeaseId: z.string().uuid().optional(),
  })
  .strict();

export const baseUpdateMetaInputSchema = z
  .object({
    ownerKey: z.string().regex(BASE_OWNER_KEY_PATTERN),
    expectedRevision: z.number().int().nonnegative(),
    patch: z
      .object({
        name: baseNameSchema.optional(),
        // pinned 不在 patch 面：pin 已冻结，wire 上不留任何新写入口
        columns: z.array(baseColumnSchema).max(BASE_COLUMN_LIMIT).optional(),
        views: z.array(baseViewSchema).min(1).max(BASE_VIEW_LIMIT).optional(),
        activeViewId: entityIdSchema.optional(),
      })
      .strict(),
    authorityLeaseId: authorityLeaseIdSchema,
  })
  .strict();

export const baseInsertRowsInputSchema = z
  .object({
    ownerKey: z.string().regex(BASE_OWNER_KEY_PATTERN),
    rows: z.array(baseRowSchema).min(1).max(BASE_INSERT_LIMIT),
    authorityLeaseId: authorityLeaseIdSchema,
  })
  .strict();

export const basePatchRowInputSchema = z
  .object({
    ownerKey: z.string().regex(BASE_OWNER_KEY_PATTERN),
    rowId: entityIdSchema,
    patch: z.record(entityIdSchema, baseCellValueSchema.nullable()),
    authorityLeaseId: authorityLeaseIdSchema,
  })
  .strict();

export const baseDeleteRowsInputSchema = z
  .object({
    ownerKey: z.string().regex(BASE_OWNER_KEY_PATTERN),
    rowIds: z.array(entityIdSchema).min(1).max(BASE_DELETE_LIMIT),
    expectedRevision: z.number().int().nonnegative(),
    authorityLeaseId: authorityLeaseIdSchema,
  })
  .strict();

export const baseExportCsvInputSchema = ownerInputSchema;
export const baseExportJsonInputSchema = ownerInputSchema;
export const baseExportXlsxInputSchema = ownerInputSchema;
export const baseImportJsonInputSchema = z
  .object({
    ownerKey: z.string().regex(BASE_OWNER_KEY_PATTERN),
    expectedRevision: z.number().int().nonnegative(),
    authorityLeaseId: authorityLeaseIdSchema,
  })
  .strict();
export const baseImportXlsxInputSchema = baseImportJsonInputSchema;
export const baseRowHistoryInputSchema = z
  .object({
    ownerKey: z.string().regex(BASE_OWNER_KEY_PATTERN),
    rowId: entityIdSchema,
  })
  .strict();

const baseMutationErrorSchema = z
  .object({
    code: z.string().min(1).max(128),
    message: z.string().min(1).max(4_096),
    currentRevision: z.number().int().nonnegative().optional(),
    issues: z
      .array(
        z
          .object({
            rowIndex: z.number().int().nonnegative(),
            columnId: entityIdSchema,
            reason: z.string().min(1).max(128),
          })
          .strict()
      )
      .max(BASE_INSERT_LIMIT)
      .optional(),
    /* 可本地化的错误细节：现在只有 formula_cycle 的环路径列名。 */
    detail: z
      .object({ columns: z.array(baseNameSchema).max(BASE_COLUMN_LIMIT) })
      .strict()
      .optional(),
  })
  .strict();

const baseMutationSnapshotSchema = z
  .object({
    meta: baseMetaSchema,
    rows: z.array(baseRowSchema).max(BASE_ROW_LIMIT),
    warning: z.string().optional(),
  })
  .strict();

export const baseMutationSnapshotResultSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), snapshot: baseMutationSnapshotSchema }).strict(),
  z.object({ ok: z.literal(false), error: baseMutationErrorSchema }).strict(),
]);

export const baseXlsxIssuesSchema = z
  .array(
    z
      .object({
        rowIndex: z.number().int().nonnegative(),
        columnId: entityIdSchema,
        reason: z.enum(BASE_XLSX_ISSUE_REASONS),
      })
      .strict()
  )
  .max(BASE_INSERT_LIMIT);

/* 两级判别式：外层按 ok 分成功/失败，成功分支再按 cancelled 分取消/落库。
   裸 z.union 会把「缺 snapshot」报成三份并列的失配噪音，判别式直接指到那一支。 */
export const baseImportMutationResultSchema = z.discriminatedUnion("ok", [
  z.discriminatedUnion("cancelled", [
    z.object({ ok: z.literal(true), cancelled: z.literal(true) }).strict(),
    z
      .object({
        ok: z.literal(true),
        cancelled: z.literal(false),
        snapshot: baseMutationSnapshotSchema,
        issues: baseXlsxIssuesSchema.optional(),
      })
      .strict(),
  ]),
  z.object({ ok: z.literal(false), error: baseMutationErrorSchema }).strict(),
]);

export const baseResolveForSectionInputSchema = z
  .object({ sectionId: z.string().regex(BASE_CHAT_ID_PATTERN) })
  .strict();

export const basePromoteToProjectInputSchema = z
  .object({
    chatId: z.string().regex(BASE_CHAT_ID_PATTERN),
    requestId: z.string().min(1).max(128),
  })
  .strict();
