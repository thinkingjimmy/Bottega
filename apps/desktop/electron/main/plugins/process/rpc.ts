/**
 * [INPUT]: Depends on the channel-owned HostRuntime, canonical SDK operation grammar, file/credential ports, frozen invocation context, lightweight installed Weather registry and Fetch Headers.forEach.
 * [OUTPUT]: Provides PluginHostRpcBroker for named features, file/process proxies, actual Browser cookies, credentials and bounded network requests with normalized string headers and call-scoped cancellation; official weather reads use the installed Main-owned registry.
 * [POS]: Trusted plugin RPC has no per-plugin capability filter; D-9 path rules and host-sealed Provider sessions remain mandatory.
 */
import { dirname } from "node:path";
import { runtimePort } from "../../runtime";
import { hostChildEnvironment } from "../../host/processes/process-port";
import { z } from "zod";
import { operationNameSchema } from "@bottega/contracts/model/capabilities";
import type { JsonValue } from "@bottega/contracts/core/canonical";
import type { HostRuntime } from "../../host/composition";
import type { PluginToolContext, PluginToolset } from "../../tools/registry";
import { PluginFileProxy } from "./files";
import { assertPluginPath } from "./paths";
import type { PluginCredentialPort } from "./credentials";
export type PluginCookiePort = { read(filter: { url?: string; name?: string; domain?: string; path?: string; secure?: boolean; session?: boolean }): Promise<unknown[]> };
export type PluginRpcCaller = { hostId: string; pluginId: string; revision: string; activationId: string; phase: "prepare" | "active" | "drain" };
export type PluginRpcContext = PluginRpcCaller & { signal: AbortSignal; invocation?: PluginToolContext };
export type PluginRpcHandler = (input: unknown, context: PluginRpcContext) => Promise<unknown> | unknown;
const envelope = z.object({ invocationId: z.string().max(128).optional(), serviceCallId: z.string().uuid().optional(), input: z.unknown().optional() }).strict();
const pathInput = z.object({ path: z.string().min(1).max(32768) }).strict();
export function featureRpcOperation(alias: string, name: string) {
  const suffix = name.startsWith(`${alias}_`) ? name.slice(alias.length + 1) : name;
  return operationNameSchema.parse(`${alias.replaceAll("_", "-")}.${suffix.replaceAll("_", "-")}`);
}
export class PluginHostRpcBroker {
  private readonly handlers = new Map<string, PluginRpcHandler>();
  private readonly serviceCalls = new Map<string, AbortSignal>();
  private readonly invocations = new Map<string, PluginToolContext>();
  constructor(private readonly ports: { hosts: HostRuntime; credentials: PluginCredentialPort; files?: PluginFileProxy; cookies?: PluginCookiePort }) {
    const file = async (operation: "read" | "stat" | "list" | "write", input: unknown, context: PluginRpcContext) => {
      const value = operation === "write" ? z.object({ path: z.string(), content: z.string() }).strict().parse(input) : pathInput.parse(input);
      const path = await assertPluginPath(value.path);
      if (ports.files) return operation === "write" ? ports.files.write(path, ("content" in value && typeof value.content === "string" ? value.content : "")) : ports.files[operation](path);
      const launch = runtimePort().plan({ program: { kind: "entry", entry: "plugin-files" }, args: [], env: hostChildEnvironment(), cwd: dirname(path) });
      const result = await ports.hosts.runPluginProcess(context.hostId, { ...launch, stdin: JSON.stringify({ ...value, path, operation }) }, context.signal);
      if (result.code !== 0) throw new Error(`Plugin file operation denied: ${result.stderr.slice(0, 2048)}`);
      return JSON.parse(result.stdout);
    };
    for (const operation of ["read", "stat", "list", "write"] as const) this.register(`files.${operation}`, (input, context) => file(operation, input, context));
    if (ports.cookies) this.register("browser.cookies", async (input, context) => {
      const filter = z.object({ url: z.string().url().optional(), name: z.string().max(4096).optional(), domain: z.string().max(4096).optional(),
        path: z.string().max(4096).optional(), secure: z.boolean().optional(), session: z.boolean().optional() }).strict().parse(input ?? {});
      if (filter.url && !["https:", "http:"].includes(new URL(filter.url).protocol)) throw new Error("Browser Cookie URL must use HTTP or HTTPS");
      const cookies = await ports.cookies!.read(filter); context.signal.throwIfAborted();
      if (Buffer.byteLength(JSON.stringify(cookies)) > 4 * 1024 * 1024) throw new Error("Browser Cookie query exceeds its result budget; use a narrower filter");
      return cookies;
    });
    this.register("credentials.list", () => ports.credentials.list());
    this.register("credentials.read", input => ports.credentials.read(z.object({ key: z.string() }).strict().parse(input).key));
    this.register("credentials.write", input => { const value = z.object({ key: z.string(), value: z.string().nullable() }).strict().parse(input); return ports.credentials.write(value.key, value.value).then(() => ({ saved: true })); });
    this.register("weather.read", async (input, context) => {
      if (context.pluginId !== "bottega-weather") throw new Error("Weather host access is unavailable");
      const value = z.object({ configuration: z.unknown(), instanceId: z.string(), force: z.boolean().optional() }).strict().parse(input);
      const { weatherOwner } = await import("../official/weather/runtime");
      return weatherOwner().read(value, context.signal);
    });
    this.register("network.fetch", async (input, context) => {
      const value = z.object({ url: z.string().url(), method: z.enum(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"]).default("GET"),
        headers: z.record(z.string(), z.string()).optional(), body: z.string().max(4 * 1024 * 1024).optional() }).strict().parse(input);
      if (!["https:", "http:"].includes(new URL(value.url).protocol)) throw new Error("Network RPC accepts HTTP and HTTPS only");
      const response = await fetch(value.url, { method: value.method, headers: value.headers, body: value.body, signal: AbortSignal.any([context.signal, AbortSignal.timeout(30_000)]) });
      const reader = response.body?.getReader(); const chunks: Uint8Array[] = []; let bytes = 0;
      try { if (reader) while (true) { const chunk = await reader.read(); if (chunk.done) break; bytes += chunk.value.byteLength;
        if (bytes > 4 * 1024 * 1024) throw new Error("Network response exceeds plugin RPC budget"); chunks.push(chunk.value); } }
      finally { await reader?.cancel(); }
      const headers: Record<string, string> = Object.create(null);
      response.headers.forEach((headerValue, name) => { headers[name] = headerValue; });
      return { status: response.status, headers, body: Buffer.concat(chunks).toString("utf8") };
    });
    this.register("process.run", async (input, context) => {
      const value = z.object({ command: z.string(), args: z.array(z.string()).max(256), cwd: z.string(),
        env: z.record(z.string(), z.string()).optional(), timeoutMs: z.number().int().min(1).max(600_000).optional(), stdin: z.string().max(4 * 1024 * 1024).optional() }).strict().parse(input);
      await assertPluginPath(value.command); await assertPluginPath(value.cwd);
      return ports.hosts.runPluginProcess(context.hostId, value, context.signal);
    });
  }
  register(operation: string, handler: PluginRpcHandler) {
    operationNameSchema.parse(operation);
    if (this.handlers.has(operation)) throw new Error(`Host RPC operation conflict: ${operation}`);
    this.handlers.set(operation, handler);
    return () => { if (this.handlers.get(operation) === handler) this.handlers.delete(operation); };
  }
  registerFeature(alias: string, handlers: PluginToolset) {
    const disposers = Object.entries(handlers).map(([name, handler]) => this.register(featureRpcOperation(alias, name), (input, context) => {
      if (!context.invocation || !handler) throw new Error("Feature RPC requires a current host-owned tool invocation");
      return handler(input as Record<string, unknown>, { ...context.invocation, signal: context.signal });
    }));
    return () => disposers.forEach(dispose => dispose());
  }
  async withInvocation<T>(hostId: string, context: PluginToolContext, run: () => Promise<T>) {
    const key = `${hostId}/${context.invocationId}`;
    if (this.invocations.has(key)) throw new Error("Plugin invocation already active");
    this.invocations.set(key, context);
    try { return await run(); } finally { if (this.invocations.get(key) === context) this.invocations.delete(key); }
  }
  async withServiceCall<T>(hostId: string, callId: string, signal: AbortSignal, run: () => Promise<T>) {
    const key = `${hostId}/${callId}`, lifetime = new AbortController();
    if (this.serviceCalls.has(key)) throw new Error("Plugin service call already active");
    this.serviceCalls.set(key, AbortSignal.any([signal, lifetime.signal]));
    try { return await run(); } finally { lifetime.abort(); this.serviceCalls.delete(key); }
  }
  async dispatch(caller: PluginRpcCaller, operation: string, raw: unknown, hostSignal: AbortSignal): Promise<JsonValue> {
    const handler = this.handlers.get(operation);
    if (!handler) throw new Error(`Host RPC unavailable: ${operation}`);
    if (caller.phase !== "active" && !["files.read", "files.stat", "files.list", "credentials.list", "credentials.read", "browser.cookies"].includes(operation)) throw new Error("Plugin prepare/drain cannot create side effects");
    const input = envelope.parse(raw);
    const invocation = input.invocationId ? this.invocations.get(`${caller.hostId}/${input.invocationId}`) : undefined;
    if (input.invocationId && !invocation) throw new Error("Plugin invocation is stale");
    const service = input.serviceCallId ? this.serviceCalls.get(`${caller.hostId}/${input.serviceCallId}`) : undefined;
    if (input.serviceCallId && !service) throw new Error("Plugin service call is stale");
    const signal = AbortSignal.any([hostSignal, ...(invocation ? [invocation.signal] : []), ...(service ? [service] : [])]);
    signal.throwIfAborted();
    const result = await handler(input.input, { ...caller, invocation, signal });
    signal.throwIfAborted();
    return z.json().parse(result ?? null) as JsonValue;
  }
}
