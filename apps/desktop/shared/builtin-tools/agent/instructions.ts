/**
 * [INPUT]: Depends only on the final allowedTools issued for the turn
 * [OUTPUT]: Provides ProductContextFragments and productContextFragments: compact Base/Chart/Preview and independent dataviz guidance within the unchanged fixed-context budget, selected only by issued allowedTools
 * [POS]: apps/desktop/shared/builtin-tools/agent; Cross-tool product-context truth of builtin-tools; it describes issued capability only and never edits prompts
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

const BASE_WRITE_CONTEXT =
  "[Base] Use this chat's writable Base: owned first, else Project-shared. target selects an App Base attached this turn. Use Base tools for tables/bookkeeping/lists; do not create spreadsheet files.";

const BASE_READ_CONTEXT =
  "[Base] Base 读工具作用于当前 chat 可见的 Base：自有优先、Project 共享回退；本轮为只读，不要承诺写入或建表。";

const CHART_CONTEXT =
  "[Chart] For reply charts, use compact ```chart JSON fences: {type:'pie|bar|line|stacked-bar|scatter|radar|heatmap',title?,labels:string[],series:[{name?,data:(number|null)[]}]} <=12KB/chart, <=2/reply; aggregates only, no raw rows.";

const CHART_VIEW_CONTEXT =
  " Use base_set_view for chart views that follow Base data.";

export type ProductContextFragments = Readonly<{
  base?: string;
  chart?: string;
  preview?: string;
}>;

export function productContextFragments(
  allowedTools: readonly string[]
): ProductContextFragments {
  const allowed = new Set(allowedTools);
  const writable = BASE_MUTATION_TOOLS.some((name) => allowed.has(name));
  const readable = BASE_READ_TOOLS.some((name) => allowed.has(name));
  const chartReadable = CHART_READ_TOOLS.some((name) => allowed.has(name));
  return {
    ...(allowed.has("preview_server_start") ? { preview: [
      "[Preview] Use preview_server_start for persistent live apps. Return its artifact fence.",
      ...(allowed.has("preview_server_list") ? ["Recheck with preview_server_list before finishing."] : []),
      ...(allowed.has("preview_server_stop") ? ["Use preview_server_stop to stop a managed app."] : []),
      "Never promise a remote URL before the user enables access.",
    ].join(" ") } : {}),
    ...(writable
      ? { base: BASE_WRITE_CONTEXT }
      : readable
        ? { base: BASE_READ_CONTEXT }
        : {}),
    ...(chartReadable || allowed.has("validate_palette")
      ? {
          chart: [
            ...(chartReadable ? [`${CHART_CONTEXT}${allowed.has("base_set_view") ? CHART_VIEW_CONTEXT : ""}`] : []),
            ...(allowed.has("validate_palette") ? ["[Dataviz] Load the dataviz Skill before chart code, colors or Dashboard layout. Run validate_palette on actual palette, surface and mode. Keep WARN; this does not verify data, layout or interaction."] : []),
          ].join(" "),
        }
      : {}),
  };
}
