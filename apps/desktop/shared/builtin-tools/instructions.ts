/**
 * [INPUT]: Depends on the final release of this round
 * [OUTPUT]: Provides context-only text clips on the Base/Chart product that are requested by allowedTools
 * [POS]: The trans-tool semantic truth of builtin-tools; Only describe the ability to issue, not take prompt editing
 */

const BASE_READ_TOOLS = [
  "base_describe",
  "read_base",
  "base_export_csv",
  "search_bases",
] as const;

const BASE_MUTATION_TOOLS = [
  "base_set_view",
  "base_update_columns",
  "base_add_columns",
  "base_insert_rows",
  "base_patch_rows",
  "base_delete_rows",
] as const;

const CHART_READ_TOOLS = [
  "base_describe",
  "read_base",
  "search_bases",
] as const;

export const BASE_WRITE_CONTEXT =
  "[Base] Base 工具作用于当前 chat 可写的 Base：自有 Base 优先，否则是所属 Project 的共享 Base；带 target 参数时作用于本轮已附加 App 的 Base。用户要建表格/记账/清单时优先用 Base 工具，不要另建电子表格文件。";

export const BASE_READ_CONTEXT =
  "[Base] Base 读工具作用于当前 chat 可见的 Base：自有优先、Project 共享回退；本轮为只读，不要承诺写入或建表。";

export const CHART_CONTEXT =
  "[Chart] 需要在回复正文画图时，输出紧凑 ```chart JSON 围栏：{type:'pie|bar|line|stacked-bar|scatter|radar|heatmap',title?,labels:string[],series:[{name?,data:(number|null)[]}]}。单图≤12KB、每条回复≤2图；只画聚合结果，不塞原始行。";

export const CHART_VIEW_CONTEXT =
  "要“持续随 Base 数据更新”的图表请改用 base_set_view 建 chart 视图。";

export type ProductContextFragments = Readonly<{
  base?: string;
  chart?: string;
}>;

export function productContextFragments(
  allowedTools: readonly string[]
): ProductContextFragments {
  const allowed = new Set(allowedTools);
  const writable = BASE_MUTATION_TOOLS.some((name) => allowed.has(name));
  const readable = BASE_READ_TOOLS.some((name) => allowed.has(name));
  const chartReadable = CHART_READ_TOOLS.some((name) => allowed.has(name));
  return {
    ...(writable
      ? { base: BASE_WRITE_CONTEXT }
      : readable
        ? { base: BASE_READ_CONTEXT }
        : {}),
    ...(chartReadable
      ? {
          chart: `${CHART_CONTEXT}${
            allowed.has("base_set_view") ? CHART_VIEW_CONTEXT : ""
          }`,
        }
      : {}),
  };
}
