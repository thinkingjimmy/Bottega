/**
 * [INPUT]: Depends on built-in domain specs and the aggregation-free platform contract
 * [OUTPUT]: Exposes the aggregate BuiltinToolSpec registry, exact tool names, wire schemas, Base capability projection, product-context fragments, and access projection per turn kind (manual; relay without manualTurnOnly; workflow: only Base and the Chat's own history, AGT-06 (a))
 * [POS]: The public registry for sections, subagents, projects, bases, search, current-Chat history, browser, design, apps, plugins, skills and workflows
 */

import { HISTORY_TOOL_SPECS } from "../chat-agent/history-tool";
import { APP_TOOL_SPECS } from "./catalog/apps";
import { BASE_TOOL_SPECS } from "./catalog/bases";
import { BROWSER_TOOL_SPECS } from "./catalog/browser";
import { DESIGN_TOOL_SPECS } from "./catalog/design";
import { type BuiltinToolAccess, type BuiltinToolSpec } from "./platform";
import { PROJECT_TOOL_SPECS } from "./catalog/projects";
import { PLUGIN_TOOL_SPECS } from "./plugins";
import { PREVIEW_TOOL_SPECS } from "./preview";
import { SECTION_TOOL_SPECS } from "./catalog/sections";
import { SEARCH_TOOL_SPECS } from "./catalog/search";
import { SKILL_TOOL_SPECS } from "./agent/skills";
import { SUBAGENT_TOOL_SPECS } from "./agent/subagents";
import { WORKFLOW_TOOL_SPECS } from "./agent/workflows";

export const BUILTIN_TOOL_SPECS = [
  ...SECTION_TOOL_SPECS,
  ...SUBAGENT_TOOL_SPECS,
  ...PROJECT_TOOL_SPECS,
  ...BASE_TOOL_SPECS,
  ...SEARCH_TOOL_SPECS,
  ...HISTORY_TOOL_SPECS,
  ...BROWSER_TOOL_SPECS,
  ...DESIGN_TOOL_SPECS,
  ...APP_TOOL_SPECS,
  ...PLUGIN_TOOL_SPECS,
  ...PREVIEW_TOOL_SPECS,
  ...SKILL_TOOL_SPECS,
  ...WORKFLOW_TOOL_SPECS,
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

export type BuiltinTurnKind = "manual" | "relay" | "workflow";

/** AGT-06 (a): a workflow role's "Base · linked chats only" scope — Base tools and its own Chat's history, nothing else. */
const WORKFLOW_TURN_DOMAINS: ReadonlySet<string> = new Set(["bases", "history"]);

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
      (turnKind !== "workflow" || WORKFLOW_TURN_DOMAINS.has(spec.domainId)) &&
      (!planMode ||
        !("planExcluded" in spec) ||
        spec.planExcluded !== true) &&
      (!("exactIssued" in spec) || spec.exactIssued !== true)
  ).map((spec) => spec.name);
}

export * from "./catalog/apps";
export * from "./catalog/bases";
export * from "./catalog/browser";
export * from "./catalog/design";
export * from "./agent/instructions";
export * from "./platform";
export * from "./catalog/projects";
export * from "./plugins";
export * from "./catalog/sections";
export * from "./catalog/search";
export * from "./agent/skills";
export * from "./agent/subagents";
