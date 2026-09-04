/**
 * [INPUT]: Depends on nine domain specs and the aggregation-free platform contract
 * [OUTPUT]: Exposes the aggregate BuiltinToolSpec registry, exact tool names, wire schemas, Base capability projection, product-context fragments, and access projection
 * [POS]: The only public access to shared builtin-tools; declaration order is sections → subagents → projects → bases → search → browser → design → apps → skills
 */

import { APP_TOOL_SPECS } from "./apps";
import { BASE_TOOL_SPECS } from "./bases";
import { BROWSER_TOOL_SPECS } from "./browser";
import { DESIGN_TOOL_SPECS } from "./design";
import { type BuiltinToolAccess, type BuiltinToolSpec } from "./platform";
import { PROJECT_TOOL_SPECS } from "./projects";
import { SECTION_TOOL_SPECS } from "./sections";
import { SEARCH_TOOL_SPECS } from "./search";
import { SKILL_TOOL_SPECS } from "./skills";
import { SUBAGENT_TOOL_SPECS } from "./subagents";

export const BUILTIN_TOOL_SPECS = [
  ...SECTION_TOOL_SPECS,
  ...SUBAGENT_TOOL_SPECS,
  ...PROJECT_TOOL_SPECS,
  ...BASE_TOOL_SPECS,
  ...SEARCH_TOOL_SPECS,
  ...BROWSER_TOOL_SPECS,
  ...DESIGN_TOOL_SPECS,
  ...APP_TOOL_SPECS,
  ...SKILL_TOOL_SPECS,
] as const satisfies readonly BuiltinToolSpec[];

export type BuiltinToolSpecEntry = (typeof BUILTIN_TOOL_SPECS)[number];
export type BuiltinToolName = BuiltinToolSpecEntry["name"];
const _noWiden: string extends BuiltinToolName ? never : true = true;
void _noWiden;

export const BUILTIN_TOOL_NAMES = BUILTIN_TOOL_SPECS.map(
  (spec) => spec.name
) as BuiltinToolName[];

export function builtinToolSpec(name: string): BuiltinToolSpec | undefined {
  return BUILTIN_TOOL_SPECS.find((spec) => spec.name === name);
}

export function builtinToolWireSchema(spec: BuiltinToolSpecEntry) {
  return (spec as BuiltinToolSpec).wireInputSchema ?? spec.inputSchema;
}

/** tools/list 的最终 description；交叉引用只有在被提及工具全部已签发时出现。 */
export function builtinToolDescription(
  spec: BuiltinToolSpec,
  allowed: readonly string[]
) {
  const names = new Set(allowed);
  return `${spec.description}${(spec.crossReferences ?? [])
    .filter((reference) =>
      reference.mentions.every((name) => names.has(name))
    )
    .map((reference) => reference.text)
    .join("")}`;
}

const BASE_READ_TOOLS = [
  "base_describe",
  "read_base",
  "base_export_csv",
] as const;
const BASE_ROW_MUTATION_TOOLS = [
  "base_insert_rows",
  "base_patch_rows",
  "base_delete_rows",
] as const;

export type BaseToolsAvailability =
  | "read-write"
  | "read-only"
  | "write-only"
  | "none";

/** App instructions 与 lease 共用同一 allowed 集，只在这里折叠成四态。 */
export function baseToolsAvailability(
  allowed: readonly string[]
): BaseToolsAvailability {
  const names = new Set(allowed);
  const readable = BASE_READ_TOOLS.some((name) => names.has(name));
  const writable = BASE_ROW_MUTATION_TOOLS.some((name) => names.has(name));
  if (readable && writable) return "read-write";
  if (readable) return "read-only";
  return writable ? "write-only" : "none";
}

export type BuiltinTurnKind = "manual" | "relay";

export function allowedToolsFor(
  access: "none" | BuiltinToolAccess,
  turnKind: BuiltinTurnKind,
  planMode = false
) {
  if (access === "none") return [];
  return BUILTIN_TOOL_SPECS.filter(
    (spec) =>
      (access === "mutate" || spec.access === "read") &&
      (turnKind === "manual" || !("manualTurnOnly" in spec)) &&
      (!planMode ||
        !("planExcluded" in spec) ||
        spec.planExcluded !== true) &&
      (!("exactIssued" in spec) || spec.exactIssued !== true)
  ).map((spec) => spec.name);
}

export * from "./apps";
export * from "./bases";
export * from "./browser";
export * from "./design";
export * from "./instructions";
export * from "./platform";
export * from "./projects";
export * from "./sections";
export * from "./search";
export * from "./skills";
export * from "./subagents";
