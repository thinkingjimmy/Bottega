/**
 * [INPUT]: Depends on unified plugin tool contributions, dynamic shared declarations, zod and exact per-turn leases.
 * [OUTPUT]: Provides PluginToolRegistry with atomic plugin registration, versioned identity, schema checks, timeout, cancellation and unload.
 * [POS]: Domain-neutral execution boundary; host executors and trusted process executors use the same invocation path.
 */
import { createHash } from "node:crypto";
import { z } from "zod";
import type { UnifiedPluginManifest, PluginToolContribution } from "@bottega/contracts/plugins/platform";
import { registeredToolSpecs, registerToolDeclarations, unregisterToolDeclarations, pluginToolsAvailable,
  toolBudget, officialToolPlugins, type RegisteredPluginTool, type PluginToolSpec } from "../../../shared/plugin-tools";
import { statusError } from "../ipc/errors";
import type { BuiltinMcpLease } from "./lease";

export type PluginToolContext = { lease: BuiltinMcpLease; invocationId: string; signal: AbortSignal };
export type PluginToolHandler = (args: Record<string, unknown>, context: PluginToolContext) => Promise<unknown> | unknown;
export type PluginToolset = Partial<Record<string, PluginToolHandler>>;
export type PluginToolInvoker = (tool: PluginToolContribution, args: Record<string, unknown>, context: PluginToolContext) => Promise<unknown>;
export type ToolSnapshot = Readonly<{ name: string; identity: string; pluginId: string; toolId: string; revision: string;
  description: string; inputSchema: Record<string, unknown>; outputSchema: Record<string, unknown>;
  annotations: PluginToolSpec["annotations"]; domainId: string; timeoutMs: number }>;
type Execution = { spec: RegisteredPluginTool; handler: PluginToolHandler; life: AbortController };

export class PluginToolRegistry {
  private readonly executions = new Map<string, Execution>();
  constructor(...toolsets: PluginToolset[]) {
    if (!toolsets.length) return;
    const handlers = new Map<string, PluginToolHandler>();
    for (const set of toolsets) for (const [name, handler] of Object.entries(set)) {
      if (handlers.has(name)) throw new Error(`Duplicate tool handler: ${name}`);
      if (handler) handlers.set(name, handler);
    }
    const specs = registeredToolSpecs();
    for (const name of handlers.keys()) if (!specs.some(spec => spec.name === name)) throw new Error(`Unknown tool handler: ${name}`);
    const missing = specs.filter(spec => !handlers.has(spec.name));
    if (missing.length) throw new Error(`Missing tool handlers: ${missing.map(spec => spec.name).join(", ")}`);
    for (const spec of specs) this.executions.set(spec.name, { spec, handler: handlers.get(spec.name)!, life: new AbortController() });
  }
  registerHostPlugin(pluginId: string, revision: string, alias: string, specs: readonly PluginToolSpec[], handlers: PluginToolset) {
    if ([...this.executions.values()].some(entry => entry.spec.pluginId === pluginId)) throw new Error(`Plugin already registered: ${pluginId}`);
    const missing = specs.filter(spec => !handlers[spec.name]);
    if (missing.length) throw new Error(`Missing plugin handlers: ${missing.map(spec => spec.name).join(", ")}`);
    const unknown = Object.keys(handlers).filter(name => !specs.some(spec => spec.name === name));
    if (unknown.length) throw new Error(`Unknown plugin handlers: ${unknown.join(", ")}`);
    const next = registerToolDeclarations(pluginId, revision, alias, specs, { replace: true });
    for (const spec of next) this.executions.set(spec.name, { spec, handler: handlers[spec.name]!, life: new AbortController() });
  }
  validatePluginTools(manifest: UnifiedPluginManifest, revision: string) { this.registerPluginTools(manifest, revision, async () => null, { validateOnly: true }); }
  registerPluginTools(manifest: UnifiedPluginManifest, revision: string, invoke: PluginToolInvoker, options: { validateOnly?: boolean } = {}) {
    if (!options.validateOnly && [...this.executions.values()].some(entry => entry.spec.pluginId === manifest.id)) throw new Error(`Plugin already registered: ${manifest.id}`);
    const alias = manifest.providerAlias ?? `p_${createHash("sha256").update(manifest.id).digest("hex").slice(0, 10)}`;
    const officialPlugin = manifest.source.kind === "official" ? officialToolPlugins.find(plugin => plugin.id === manifest.id) : undefined;
    const tools = manifest.contributions.filter((entry): entry is PluginToolContribution => entry.kind === "tool");
    const specs: PluginToolSpec[] = tools.map(tool => {
      const official = officialPlugin?.tools.find(spec => spec.name === tool.id);
      const inputSchema = official?.inputSchema ?? z.fromJSONSchema(tool.inputSchema as Parameters<typeof z.fromJSONSchema>[0]);
      if (!(inputSchema instanceof z.ZodObject)) throw new Error(`Tool input schema must be an object: ${tool.id}`);
      return { ...official, name: officialPlugin ? tool.name : `${alias}_${tool.id}`, toolId: tool.id, domainId: tool.domain ?? manifest.id,
        description: tool.description, access: tool.access === "write" ? "mutate" : "read", inputSchema,
        outputSchema: z.fromJSONSchema(tool.outputSchema as Parameters<typeof z.fromJSONSchema>[0]), outputJsonSchema: tool.outputSchema,
        timeoutMs: tool.timeoutMs, resultByteLimit: tool.resultBytes, planExcluded: tool.planAllowed ? undefined : true,
        manualTurnOnly: tool.manualTurnOnly ? true : undefined, exactIssued: tool.exactIssued ? true : undefined,
        backendAllowlist: tool.backendAllowlist, workflowAllowed: Boolean(officialPlugin) && ["bases", "history"].includes(tool.domain ?? ""),
        annotations: { readOnlyHint: tool.access !== "write", destructiveHint: false, idempotentHint: tool.access !== "write" } };
    });
    const next = registerToolDeclarations(manifest.id, revision, alias, specs, { replace: Boolean(officialPlugin) || options.validateOnly, validateOnly: options.validateOnly });
    if (options.validateOnly) return [];
    next.forEach((spec, index) => this.executions.set(spec.name, { spec, life: new AbortController(), handler: (args, context) => invoke(tools[index]!, args, context) }));
    return this.snapshot().filter(tool => tool.pluginId === manifest.id);
  }
  unregisterPlugin(pluginId: string, revision?: string) {
    for (const [name, entry] of this.executions) if (entry.spec.pluginId === pluginId && (!revision || entry.spec.revision === revision)) {
      entry.life.abort(new Error(`Plugin unloaded: ${pluginId}`)); this.executions.delete(name);
    }
    unregisterToolDeclarations(pluginId, revision);
  }
  snapshot(names?: readonly string[]): ToolSnapshot[] {
    const allowed = names && new Set(names);
    return [...this.executions.values()].filter(entry => (!allowed || allowed.has(entry.spec.name)) && pluginToolsAvailable(entry.spec.pluginId)).map(({ spec }) => Object.freeze({
      name: spec.name, identity: spec.identity, pluginId: spec.pluginId, toolId: spec.toolId, revision: spec.revision,
      description: spec.description, inputSchema: z.toJSONSchema(spec.wireInputSchema ?? spec.inputSchema, { unrepresentable: "any" }) as Record<string, unknown>,
      outputSchema: spec.outputJsonSchema ?? {}, annotations: spec.annotations, domainId: spec.domainId, timeoutMs: spec.timeoutMs,
    }));
  }
  async call(tool: string, rawArgs: unknown, context: PluginToolContext) {
    const entry = this.executions.get(tool);
    if (!entry || !pluginToolsAvailable(entry.spec.pluginId)) throw statusError(404, `Tool unavailable: ${tool}`);
    const frozen = context.lease.toolSnapshot?.find(spec => spec.name === tool);
    if (context.lease.toolSnapshot && (!frozen || frozen.identity !== entry.spec.identity || frozen.revision !== entry.spec.revision)) throw statusError(409, `Tool revision is stale: ${tool}`);
    const parsed = entry.spec.inputSchema.safeParse(rawArgs ?? {});
    if (!parsed.success) throw statusError(400, `Invalid tool input parameters: ${parsed.error.message}`);
    const timeout = new AbortController();
    const signal = AbortSignal.any([context.signal, context.lease.signal, entry.life.signal, timeout.signal]);
    signal.throwIfAborted();
    const timer = setTimeout(() => timeout.abort(statusError(408, `Tool timed out: ${tool}`)), entry.spec.timeoutMs);
    let abort!: () => void;
    const stopped = new Promise<never>((_, reject) => { abort = () => reject(signal.reason); signal.addEventListener("abort", abort, { once: true }); });
    try {
      const result = await Promise.race([Promise.resolve(entry.handler(parsed.data, { ...context, signal })), stopped]);
      signal.throwIfAborted();
      const output = entry.spec.outputSchema!.safeParse(result);
      if (!output.success) throw statusError(500, `Invalid tool output result: ${output.error.message}`);
      const limit = Math.min(entry.spec.resultByteLimit ?? toolBudget(entry.spec.domainId).logicalResultByteLimit, context.lease.resultByteBudget);
      if (Buffer.byteLength(JSON.stringify(output.data), "utf8") > limit) throw statusError(413, `Tool result exceeds budget: ${tool}`);
      return output.data;
    } finally { clearTimeout(timer); signal.removeEventListener("abort", abort); }
  }
}
