/**
 * [INPUT]: Depends on React/browser type vocabulary, the shared APP_GUI_RUNTIME_ERROR_CODES tuple, and the compiler-signed ECharts dependency subset
 * [OUTPUT]: Provides immutable SDK declaration and charts runtime/declaration virtual-module sources
 * [POS]: gui-build/product-modules virtual contract snapshot; compiler maps public specifiers to these exact product bytes
 */

import { APP_GUI_RUNTIME_ERROR_CODES } from "../../../../../shared/app-gui/contracts";

/* 作者面看到的 code 联合体由共享元组生成，不手抄。手抄的那一份必然与
   主进程真实产出分叉，而分叉的代价是作者写出的 switch 在类型上通过、
   在运行期永远走不到某一支。生成即没有可分叉的第二份。 */
const RUNTIME_ERROR_CODE_UNION = APP_GUI_RUNTIME_ERROR_CODES
  .map((code) => `"${code}"`)
  .join(" | ");

export const SDK_TYPES_SOURCE = `
declare module "@bottega/app-react" {
  import type { ReactElement } from "react";
  export type RuntimeErrorCode = ${RUNTIME_ERROR_CODE_UNION};
  export type RuntimeError = Readonly<{ code: RuntimeErrorCode; message: string; retryable: boolean }>;
  export type AsyncState<T> =
    | Readonly<{ status: "loading"; retry(): void; critical: boolean }>
    | Readonly<{ status: "success"; data: T; retry(): void; critical: boolean }>
    | Readonly<{ status: "error"; error: RuntimeError; retry(): void; critical: boolean }>;
  export function useAppEnvironment(): Readonly<{ language: string; locale: string; timeZone: string; colorScheme: "light" | "dark"; reducedMotion: boolean; density: "comfortable" | "compact"; viewport: Readonly<{ width: number; height: number }> }>;
  export function useBaseMeta(options?: { critical?: boolean }): AsyncState<unknown>;
  export function useBaseRows<T = unknown>(query: unknown, options?: { critical?: boolean }): AsyncState<T>;
  export type BaseMutation = Readonly<{ kind: "insert"; expectedBaseInstanceId: string; expectedRevision: number; rows: readonly Readonly<{ id: string; values: Readonly<Record<string, unknown>> }>[] }> | Readonly<{ kind: "patch"; expectedBaseInstanceId: string; expectedRevision: number; patches: readonly Readonly<{ rowId: string; patch: Readonly<Record<string, unknown>> }>[] }> | Readonly<{ kind: "delete"; expectedBaseInstanceId: string; expectedRevision: number; rowIds: readonly string[] }>;
  export function useBaseMutation(): (mutation: BaseMutation, options?: { signal?: AbortSignal }) => Promise<unknown>;
  export function useAttachment<T = unknown>(input: unknown, options?: { critical?: boolean }): AsyncState<T>;
  export function useAppPreferences<T = unknown>(options?: { critical?: boolean }): AsyncState<T> & Readonly<{ write(value: T, expectedRevision?: number): Promise<unknown>; reset(expectedRevision?: number): Promise<unknown> }>;
  export function useWorkspaceFiles<T = unknown>(options?: { limit?: number; cursor?: string; critical?: boolean }): AsyncState<T>;
  export function useWorkspaceVersions<T = unknown>(fileRef: string, options?: { limit?: number; cursor?: string; critical?: boolean }): AsyncState<T>;
  export function useWorkspaceSourceLine(input: { fileRef: string; htmlHint: string }, options?: { critical?: boolean }): AsyncState<number | null>;
  export function useWorkspacePreview(target: unknown, options?: { critical?: boolean }): AsyncState<string>;
  export function WorkspacePreview(props: { handle: string; mode?: "browse" | "element" | "region"; onSelection?: (selection: unknown) => void }): ReactElement;
  export function useHostAction(): (action: { type: "open-data" } | { type: "open-data-view"; viewId: string } | { type: "compose-text"; text: string }) => Promise<unknown>;
  export type FileExportRequest = Readonly<{ version: 1; suggestedName: string; mediaType: "text/plain;charset=utf-8" | "text/csv;charset=utf-8" | "application/json" | "image/png" | "image/jpeg" | "image/webp" | "image/gif"; byteLength: number; sha256: \`sha256:\${string}\` }>;
  export type FileExportResult = Readonly<{ status: "accepted"; exportId: string; maxChunkBytes: 65536 }> | Readonly<{ status: "cancelled" }> | Readonly<{ status: "declined"; reason: "permission" | "gesture" | "busy" }> | Readonly<{ status: "saved"; filename: string; byteLength: number; sha256: \`sha256:\${string}\` }> | Readonly<{ status: "failed"; code: "integrity" | "timeout" | "io" | "surface_closed" }>;
  export function useFileExport(): (input: Readonly<{ request: FileExportRequest; data: string | Uint8Array | ArrayBuffer; signal?: AbortSignal }>) => Promise<FileExportResult>;
}
`;

export const CHARTS_RUNTIME_SOURCE = `
import React, { useEffect, useRef } from "react";
import * as echarts from "echarts/core";
import { BarChart, LineChart, PieChart } from "echarts/charts";
import { CanvasRenderer } from "echarts/renderers";
import { GridComponent, LegendComponent, TooltipComponent } from "echarts/components";
echarts.use([BarChart, LineChart, PieChart, CanvasRenderer, GridComponent, LegendComponent, TooltipComponent]);
export function Chart({ option, ariaLabel = "Chart" }) { const ref = useRef(null); useEffect(() => { if (!ref.current) return; const chart = echarts.init(ref.current, undefined, { renderer: "canvas" }); chart.setOption(option, { notMerge: true }); const resize = () => chart.resize(); addEventListener("resize", resize); return () => { removeEventListener("resize", resize); chart.dispose(); }; }, [option]); return React.createElement("div", { ref, role: "img", "aria-label": ariaLabel, style: { width: "100%", minHeight: 240 } }); }
`;

export const CHARTS_TYPES_SOURCE = `
declare module "@bottega/charts" {
  import type { ReactElement } from "react";
  export function Chart(props: Readonly<{ option: Readonly<Record<string, unknown>>; ariaLabel?: string }>): ReactElement;
}
`;
