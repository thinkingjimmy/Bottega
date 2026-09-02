/**
 * [INPUT]: Depends on zod, canonical Base filter/value schemas, and Base entity identifiers
 * [OUTPUT]: Provides Base GUI Query V1 request shape types plus the request/page zod schemas that executor and SDK parse
 * [POS]: Shared app-gui query dialect; executor and generation-embedded SDK parse the same wire contract
 */

import { z } from "zod";
import { BASE_ENTITY_ID_PATTERN } from "../bases-ipc";
import { baseCellValueSchema, baseFilterSchema } from "../bases-schema";
import type { BaseFilter } from "../base-view-config";

const entityIdSchema = z.string().regex(BASE_ENTITY_ID_PATTERN);
const digestSchema = z
  .string()
  .regex(/^sha256:[a-f0-9]{64}$/)
  .transform((value) => value as `sha256:${string}`);
const directionSchema = z.enum(["asc", "desc"]);

export const BASE_GUI_QUERY_AGGREGATIONS = [
  "average",
  "empty",
  "filled",
  "max",
  "median",
  "min",
  "range",
  "stddev",
  "sum",
  "unique",
] as const;

export type BaseAggregationV1 = (typeof BASE_GUI_QUERY_AGGREGATIONS)[number];
export type BaseRowQueryShapeV1 = Readonly<{
  version: 1;
  mode: "rows";
  projection: readonly string[];
  filter?: BaseFilter;
  sort?: readonly Readonly<{ columnId: string; direction: "asc" | "desc" }>[];
}>;
export type BaseGroupQueryShapeV1 = Readonly<{
  version: 1;
  mode: "groups";
  filter?: BaseFilter;
  groupBy: readonly [string, ...string[]];
  aggregates: readonly Readonly<{ id: string; columnId: string; op: BaseAggregationV1 }>[];
  sort?: readonly (
    | Readonly<{ kind: "group"; index: number; direction: "asc" | "desc" }>
    | Readonly<{ kind: "aggregate"; aggregateId: string; direction: "asc" | "desc" }>
  )[];
}>;
export type BaseGuiQueryRequestV1 = Readonly<{
  shape: BaseRowQueryShapeV1 | BaseGroupQueryShapeV1;
  page: Readonly<{ limit?: number; cursor?: string }>;
}>;

const aggregationSchema = z.enum(BASE_GUI_QUERY_AGGREGATIONS);
const rowSortSchema = z
  .object({ columnId: entityIdSchema, direction: directionSchema })
  .strict();
const groupSortSchema = z
  .object({
    kind: z.literal("group"),
    index: z.number().int().min(0).max(1),
    direction: directionSchema,
  })
  .strict();
const aggregateSortSchema = z
  .object({
    kind: z.literal("aggregate"),
    aggregateId: entityIdSchema,
    direction: directionSchema,
  })
  .strict();

const rawBaseRowQueryShapeV1Schema = z
  .object({
    version: z.literal(1),
    mode: z.literal("rows"),
    projection: z.array(entityIdSchema).max(32),
    filter: baseFilterSchema.optional(),
    sort: z.array(rowSortSchema).max(4).optional(),
  })
  .strict();

const rawBaseGroupQueryShapeV1Schema = z
  .object({
    version: z.literal(1),
    mode: z.literal("groups"),
    filter: baseFilterSchema.optional(),
    groupBy: z.tuple([entityIdSchema], entityIdSchema).refine((value) => value.length <= 2),
    aggregates: z
      .array(
        z.object({ id: entityIdSchema, columnId: entityIdSchema, op: aggregationSchema }).strict()
      )
      .max(8),
    sort: z.array(z.discriminatedUnion("kind", [groupSortSchema, aggregateSortSchema])).max(4).optional(),
  })
  .strict();

export const baseGuiQueryRequestV1Schema: z.ZodType<BaseGuiQueryRequestV1> = z
  .object({
    shape: z.discriminatedUnion("mode", [rawBaseRowQueryShapeV1Schema, rawBaseGroupQueryShapeV1Schema]),
    page: z
      .object({
        limit: z.number().int().min(1).max(200).optional(),
        cursor: z.string().max(4_096).optional(),
      })
      .strict(),
  })
  .strict()
  .superRefine((request, context) => {
    assertUnique(request.shape.mode === "rows" ? request.shape.projection : request.shape.groupBy, context, ["shape"]);
    if (request.shape.mode === "rows") {
      assertUnique(request.shape.sort?.map((item) => item.columnId) ?? [], context, ["shape", "sort"]);
      return;
    }
    const groupShape = request.shape;
    assertUnique(groupShape.aggregates.map((item) => item.id), context, ["shape", "aggregates"]);
    const aggregateIds = new Set(groupShape.aggregates.map((item) => item.id));
    const sortTargets = groupShape.sort?.map((item) =>
      item.kind === "group" ? `group:${item.index}` : `aggregate:${item.aggregateId}`
    ) ?? [];
    assertUnique(sortTargets, context, ["shape", "sort"]);
    groupShape.sort?.forEach((item, index) => {
      const valid = item.kind === "group"
        ? item.index < groupShape.groupBy.length
        : aggregateIds.has(item.aggregateId);
      if (!valid) context.addIssue({ code: "custom", path: ["shape", "sort", index], message: "query sort target is not declared by this shape" });
    });
  });

export function baseGuiQueryPageSchema(request: BaseGuiQueryRequestV1) {
  const shape = request.shape;
  if (shape.mode === "rows") {
    const projection = new Set(shape.projection);
    return z
      .object({
        version: z.literal(1),
        semanticsVersion: z.literal("base-gui-query-v1"),
        mode: z.literal("rows"),
        baseInstanceId: entityIdSchema,
        revision: z.number().int().nonnegative(),
        rows: z.array(z.object({ rowId: entityIdSchema, values: z.record(entityIdSchema, baseCellValueSchema.nullable()) }).strict()).max(200),
        nextCursor: z.string().max(4_096).optional(),
      })
      .strict()
      .superRefine((page, context) => {
        assertUnique(page.rows.map((row) => row.rowId), context, ["rows"]);
        page.rows.forEach((row, index) => {
          if (!sameKeys(Object.keys(row.values), projection)) context.addIssue({ code: "custom", path: ["rows", index, "values"], message: "row projection keys do not match the request" });
        });
      });
  }
  const aggregateIds = new Set(shape.aggregates.map((item) => item.id));
  return z
    .object({
      version: z.literal(1),
      semanticsVersion: z.literal("base-gui-query-v1"),
      mode: z.literal("groups"),
      baseInstanceId: entityIdSchema,
      revision: z.number().int().nonnegative(),
      groups: z.array(z.object({
        groupId: digestSchema,
        keys: z.array(baseCellValueSchema.nullable()).max(2),
        rowCount: z.number().int().nonnegative(),
        aggregates: z.record(entityIdSchema, z.number().finite().nullable()),
      }).strict()).max(200),
      nextCursor: z.string().max(4_096).optional(),
    })
    .strict()
    .superRefine((page, context) => {
      assertUnique(page.groups.map((group) => group.groupId), context, ["groups"]);
      page.groups.forEach((group, index) => {
        if (group.keys.length !== shape.groupBy.length) context.addIssue({ code: "custom", path: ["groups", index, "keys"], message: "group key count does not match the request" });
        if (!sameKeys(Object.keys(group.aggregates), aggregateIds)) context.addIssue({ code: "custom", path: ["groups", index, "aggregates"], message: "aggregate keys do not match the request" });
      });
    });
}

function assertUnique(values: readonly string[], context: z.RefinementCtx, path: (string | number)[]) {
  if (new Set(values).size !== values.length) {
    context.addIssue({ code: "custom", path, message: "query fields must be unique" });
  }
}

function sameKeys(keys: readonly string[], expected: ReadonlySet<string>) {
  return keys.length === expected.size && keys.every((key) => expected.has(key));
}
