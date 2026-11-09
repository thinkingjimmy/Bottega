/**
 * [INPUT]: Depends on plugin-owned official declarations, zod schemas and the aggregation-free tool platform.
 * [OUTPUT]: Provides dynamic plugin tool declaration registration, identity lookup, Provider names, availability and turn projections.
 * [POS]: Shared metadata catalogue; main owns execution and leases freeze a versioned subset for each turn.
 */
import { z } from "zod";
import { officialToolPlugins } from "./official";
import { type PluginToolAccess, type PluginToolSpec } from "./platform";
import "./budgets";

export type PluginToolName = string;
export type PluginToolSpecEntry = PluginToolSpec;
export type RegisteredPluginTool = PluginToolSpec & { pluginId: string; toolId: string; identity: string; revision: string; providerAlias: string; timeoutMs: number };
export const PLUGIN_MCP_SERVER_NAME = "bottega" as const;
const entries = new Map<string, RegisteredPluginTool>();
const aliases = new Map<string, string>();
let available: (pluginId: string) => boolean = () => true;
export function setPluginToolAvailabilityResolver(resolver: ((pluginId: string) => boolean) | null) { available = resolver ?? (() => true); }
export function pluginToolsAvailable(pluginId: string) { return available(pluginId); }
export function registeredToolSpecs(): RegisteredPluginTool[] { return [...entries.values()]; }
export function registeredToolNames(): string[] { return [...entries.keys()]; }
export function toolSpec(nameOrIdentity: string): RegisteredPluginTool | undefined {
  return entries.get(nameOrIdentity) ?? [...entries.values()].find(spec => spec.identity === nameOrIdentity);
}
export function registerToolDeclarations(pluginId: string, revision: string, providerAlias: string, declarations: readonly PluginToolSpec[], options: { replace?: boolean; validateOnly?: boolean } = {}) {
  if (!/^[a-z][a-z0-9_]{0,19}$/.test(providerAlias)) throw new Error(`Invalid plugin Provider alias: ${providerAlias}`);
  const owner = aliases.get(providerAlias);
  if (owner && owner !== pluginId) throw new Error(`Plugin Provider alias conflict: ${providerAlias} belongs to ${owner}`);
  const next = declarations.map(spec => {
    const toolId = spec.toolId ?? spec.name;
    const identity = `${pluginId}/${toolId}`;
    if (!/^[a-z0-9_]+$/.test(spec.name)) throw new Error(`Invalid Provider tool name: ${spec.name}`);
    if (`mcp__${PLUGIN_MCP_SERVER_NAME}__${spec.name}`.length > 64) throw new Error(`Provider tool name exceeds 64 characters: ${spec.name}`);
    const prior = entries.get(spec.name);
    if (prior && (prior.identity !== identity || prior.revision !== revision && !options.replace)) throw new Error(`Tool name conflict: ${spec.name}`);
    if ([...entries.values()].some(item => item.identity === identity && item.name !== spec.name)) throw new Error(`Duplicate plugin tool identity: ${identity}`);
    const timeoutMs = spec.timeoutMs ?? 600_000;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 600_000) throw new Error(`Invalid tool timeout: ${identity}`);
    return Object.freeze({ ...spec, pluginId, toolId, identity, revision, providerAlias, timeoutMs,
      outputSchema: spec.outputSchema ?? z.json(), outputJsonSchema: spec.outputJsonSchema ?? {} });
  });
  if (new Set(next.map(spec => spec.name)).size !== next.length || new Set(next.map(spec => spec.identity)).size !== next.length) throw new Error(`Duplicate tools in plugin ${pluginId}`);
  if (options.validateOnly) return next;
  if (options.replace) for (const [name, spec] of entries) if (spec.pluginId === pluginId) entries.delete(name);
  aliases.set(providerAlias, pluginId);
  for (const spec of next) entries.set(spec.name, spec);
  return next;
}
export function unregisterToolDeclarations(pluginId: string, revision?: string) {
  for (const [name, spec] of entries) if (spec.pluginId === pluginId && (!revision || spec.revision === revision)) entries.delete(name);
  for (const [alias, owner] of aliases) if (owner === pluginId && ![...entries.values()].some(spec => spec.pluginId === pluginId)) aliases.delete(alias);
}
for (const plugin of officialToolPlugins) registerToolDeclarations(plugin.id, "official", plugin.hostInfrastructure ? `host_${plugin.alias}` : plugin.alias,
  plugin.tools);

export function toolWireSchema(spec: PluginToolSpec) { return spec.wireInputSchema ?? spec.inputSchema; }
export function toolDescription(spec: PluginToolSpec, allowed: readonly string[]) {
  const names = new Set(allowed);
  return `${spec.description}${(spec.crossReferences ?? []).filter(reference => reference.mentions.every(name => names.has(name))).map(reference => reference.text).join("")}`;
}
export type BaseToolsAvailability = "read-write" | "read-only" | "write-only" | "none";
export function baseToolsAvailability(allowed: readonly string[]): BaseToolsAvailability {
  const specs = allowed.map(toolSpec).filter(spec => spec?.pluginId === "base");
  const readable = specs.some(spec => spec?.access === "read");
  const writable = specs.some(spec => ["base_insert_rows", "base_patch_rows", "base_delete_rows"].includes(spec!.toolId));
  return readable ? writable ? "read-write" : "read-only" : writable ? "write-only" : "none";
}
export type BuiltinTurnKind = "manual" | "relay";
export function allowedToolsFor(access: "none" | PluginToolAccess, turnKind: BuiltinTurnKind, planMode = false) {
  if (access === "none") return [];
  return registeredToolSpecs().filter(spec => pluginToolsAvailable(spec.pluginId) &&
    (access === "mutate" || spec.access === "read") && (turnKind === "manual" || !spec.manualTurnOnly) &&
    (!planMode || !spec.planExcluded) && !spec.exactIssued).map(spec => spec.name);
}
export * from "./official";
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
export * from "./agent/dataviz";
export * from "./agent/subagents";
