/**
 * [INPUT]: Depends on zod; Receive Base Chart Projection and Chat Chart Structured Chart Data used by the Fence
 * [OUTPUT]: Provides seven ChartType, ChartPayload, 12KB byte budget and strict chartPayloadSchema
 * [POS]: The shared graph protocol is the single source of truth; Base Live sharing with chat snapshots, prohibiting hosts from privatizing a second schema
 */

import { z } from "zod";

export const CHART_TYPES = [
  "pie",
  "bar",
  "line",
  "stacked-bar",
  "scatter",
  "radar",
  "heatmap",
] as const;

export type ChartType = (typeof CHART_TYPES)[number];
export const CHART_PAYLOAD_BYTE_LIMIT = 12 * 1024;
export const CHART_LABEL_LIMIT = 120;
export const CHART_SERIES_LIMIT = 12;
export const CHART_POINT_LIMIT = 2_000;
export const CHART_TEXT_LIMIT = 40;

export type ChartPayload = {
  type: ChartType;
  title?: string;
  labels: string[];
  series: Array<{
    name?: string;
    data: Array<number | null>;
  }>;
};

const chartSeriesSchema = z
  .object({
    name: z.string().max(CHART_TEXT_LIMIT, "序列名不能超过 40 个字符").optional(),
    data: z.array(z.number().finite().nullable()),
  })
  .strict();

export const chartPayloadSchema: z.ZodType<ChartPayload> = z
  .object({
    type: z.enum(CHART_TYPES),
    title: z.string().max(120, "标题不能超过 120 个字符").optional(),
    labels: z
      .array(z.string().max(CHART_TEXT_LIMIT, "标签不能超过 40 个字符"))
      .min(1, "图表至少需要一个标签")
      .max(CHART_LABEL_LIMIT, "标签数量不能超过 120"),
    series: z
      .array(chartSeriesSchema)
      .min(1, "图表至少需要一个序列")
      .max(CHART_SERIES_LIMIT, "序列数量不能超过 12"),
  })
  .strict()
  .superRefine((payload, context) => {
    payload.series.forEach((series, index) => {
      if (series.data.length !== payload.labels.length) {
        context.addIssue({
          code: "custom",
          path: ["series", index, "data"],
          message: "每个序列的数据长度必须与标签数量一致",
        });
      }
    });
    const points = payload.labels.length * payload.series.length;
    if (points > CHART_POINT_LIMIT) {
      context.addIssue({
        code: "custom",
        path: ["series"],
        message: "图表数据点不能超过 2000",
      });
    }
    if (payload.type === "pie" && payload.series.length !== 1) {
      context.addIssue({
        code: "custom",
        path: ["series"],
        message: "饼图必须且只能包含一个序列",
      });
    }
    if (payload.type === "scatter" && payload.series.length !== 2) {
      context.addIssue({
        code: "custom",
        path: ["series"],
        message: "散点图必须包含两个序列",
      });
    }
    if (payload.type === "heatmap") {
      payload.series.forEach((series, index) => {
        if (!series.name?.trim()) {
          context.addIssue({
            code: "custom",
            path: ["series", index, "name"],
            message: "热力图的每个序列都必须命名",
          });
        }
      });
    }
    if (payload.series.length > 1) {
      const names = payload.series.map((series) => series.name?.trim() ?? "");
      if (names.some((name) => !name)) {
        context.addIssue({
          code: "custom",
          path: ["series"],
          message: "多序列图表的每个序列都必须命名",
        });
      }
      if (new Set(names).size !== names.length) {
        context.addIssue({
          code: "custom",
          path: ["series"],
          message: "多序列图表的序列名必须唯一",
        });
      }
    }
    if (!payload.series.some((series) => series.data.some((value) => value !== null))) {
      context.addIssue({
        code: "custom",
        path: ["series"],
        message: "图表至少需要一个非空数据点",
      });
    }
    const bytes = new TextEncoder().encode(JSON.stringify(payload)).byteLength;
    if (bytes > CHART_PAYLOAD_BYTE_LIMIT) {
      context.addIssue({
        code: "custom",
        message: "图表数据超过 12KB，请减少标签或序列",
      });
    }
  });
