/**
 * [INPUT]: Depends on main-owned plugin roots, unified manifests, the existing bundled-Node HostRuntime and the trusted host RPC broker.
 * [OUTPUT]: Provides createPluginProcessRuntime with schema/method-verified lifecycle, dynamic tools, captured-activation failures/dispatch, call-scoped host cancellation and awaited disposal.
 * [POS]: Unified plugin background runtime; uses the Host Package path and Seatbelt while retaining source/data/build separation.
 */
import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join, relative, isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";
import type { UnifiedPluginManifest, PluginServiceContext } from "@bottega/contracts/plugins/platform";
import type { HostRuntime } from "../../host/composition";
import { hostChildEnvironment } from "../../host/processes/process-port";
import type { PluginToolRegistry } from "../../tools/registry";
import { pluginBootstrap } from "./bootstrap";
import { PluginHostRpcBroker, type PluginRpcCaller } from "./rpc";
import { assertPluginPath } from "./paths";
export type PluginProcessInput = { manifest: UnifiedPluginManifest; revision: string; activationId: string;
  sourceRoot: string; dataRoot: string; buildRoot: string; signal: AbortSignal };
const moduleUrl = async (root: string, entry: string) => {
  const path = await assertPluginPath(join(root, entry)), rel = relative(await assertPluginPath(root), path);
  if (rel.startsWith("..") || isAbsolute(rel)) throw new Error("Plugin entry escapes its compiled revision");
  return pathToFileURL(path).href;
};
export type PreparedPluginProcess = {
  readiness: { contributionId: string; kind: "service" | "tool"; ready: true }[];
  activate(context?: PluginServiceContext): Promise<void>;
  drain(context?: PluginServiceContext): Promise<void>;
  dispose(context?: PluginServiceContext): Promise<void>;
  hostId: string;
  revision: string;
  activationId: string;
  invoke(method: string, input: unknown, signal: AbortSignal): Promise<unknown>;
};
export function createPluginProcessRuntime(ports: { hosts: HostRuntime; registry: PluginToolRegistry; rpc: PluginHostRpcBroker }) {
  const live = new Map<string, PreparedPluginProcess>();
  const failures = new Set<(input: { pluginId: string; revision: string; activationId: string; reason: string }) => void>();
  const releaseExit = ports.hosts.onExit((hostId, reason) => {
    if (reason === "stopped") return;
    const entry = [...live.entries()].find(([, runtime]) => runtime.hostId === hostId);
    if (!entry) return;
    ports.registry.unregisterPlugin(entry[0], entry[1].revision);
    for (const listener of failures) { try { listener({ pluginId: entry[0], revision: entry[1].revision, activationId: entry[1].activationId, reason }); } catch (cause) { console.warn("[plugin-process] failure observer failed", cause); } }
  });
  async function prepare(input: PluginProcessInput): Promise<PreparedPluginProcess> {
    input.signal.throwIfAborted();
    const { manifest } = input;
    ports.registry.validatePluginTools(manifest, input.revision);
    for (const path of [input.sourceRoot, input.dataRoot, input.buildRoot]) { await assertPluginPath(path); await mkdir(path, { recursive: true, mode: 0o700 }); }
    const paths = manifest.contributions.flatMap(item => item.kind === "service" ? [item.entry] : item.kind === "tool" ? [item.executor.entry] : []);
    const urls = await Promise.all(paths.map(entry => moduleUrl(input.buildRoot, entry)));
    const hostId = `p${createHash("sha256").update(`${manifest.id}/${input.revision}/${input.activationId}`).digest("hex").slice(0, 24)}`;
    const wrapperRoot = join(input.dataRoot, ".runtime", input.activationId);
    await mkdir(wrapperRoot, { recursive: true, mode: 0o700 });
    const wrapper = join(wrapperRoot, "host.mjs");
    await writeFile(wrapper, pluginBootstrap(urls), { mode: 0o600 });
    let caller: PluginRpcCaller;
    const createHost = (candidate: boolean) => {
      const identity = candidate ? `${hostId}-prepare` : hostId;
      const ownedCaller: PluginRpcCaller = { hostId: identity, pluginId: manifest.id, revision: input.revision, activationId: input.activationId, phase: "prepare" };
      caller = ownedCaller;
      return ports.hosts.create({ hostId: identity, kind: "extension-host", entry: wrapper,
        entrySha256: createHash("sha256").update(pluginBootstrap(urls)).digest("hex"), env: hostChildEnvironment({ BOTTEGA_PLUGIN_ID: manifest.id, BOTTEGA_PLUGIN_REVISION: input.revision }) },
        { packageFence: { identity: manifest.id, trustedPlugin: true, network: !candidate,
          readRoots: [input.buildRoot, input.sourceRoot, input.dataRoot], writeRoots: candidate ? [] : [input.sourceRoot, input.dataRoot], protectedRoots: [input.buildRoot, wrapperRoot], readOnly: candidate },
          pluginRpc: (operation, raw, signal) => ports.rpc.dispatch(ownedCaller, operation, raw, signal) });
    };
    let host = createHost(true);
    const invoke = async (method: string, params: unknown, signal = new AbortController().signal, timeoutMs = 30_000) => {
      const combined = AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]);
      combined.throwIfAborted();
      let stop!: () => void;
      const stopped = new Promise<never>((_, reject) => { stop = () => reject(combined.reason); combined.addEventListener("abort", stop, { once: true }); });
      try { return await Promise.race([host.invoke(method, params), stopped]); }
      finally { combined.removeEventListener("abort", stop); }
    };
    const tools = await Promise.all(manifest.contributions.flatMap(item => item.kind === "tool" ? [moduleUrl(input.buildRoot, item.executor.entry).then(entry => ({ entry, method: item.executor.method }))] : []));
    const context = { tools, pluginId: manifest.id, revision: input.revision, activationId: input.activationId };
    let disposed = false;
    try { await host.start(); input.signal.throwIfAborted(); await invoke("plugin.prepare", context, input.signal); input.signal.throwIfAborted(); }
    catch (cause) { await ports.hosts.remove(host.plan.hostId); throw cause; }
    const runtime = {
      readiness: manifest.contributions.flatMap(contribution => contribution.kind === "service" || contribution.kind === "tool" ? [{ contributionId: contribution.id, kind: contribution.kind, ready: true as const }] : []),
      async activate(_context?: PluginServiceContext) {
        if (disposed) throw new Error("Plugin runtime disposed");
        const signal = _context?.signal ?? input.signal; signal.throwIfAborted();
        await ports.hosts.remove(host.plan.hostId); signal.throwIfAborted();
        host = createHost(false);
        try { await host.start(); signal.throwIfAborted(); await invoke("plugin.prepare", context, signal); caller!.phase = "active"; await invoke("plugin.activate", context, signal); signal.throwIfAborted(); }
        catch (cause) { await ports.hosts.remove(host.plan.hostId); throw cause; }
        ports.registry.registerPluginTools(manifest, input.revision, async (tool, args, invocation) => {
          const abort = () => { void host.invoke("plugin.cancel", { invocationId: invocation.invocationId }).catch(() => undefined); };
          invocation.signal.addEventListener("abort", abort, { once: true });
          try { return await ports.rpc.withInvocation(hostId, invocation, async () => host.invoke("plugin.invoke", {
            entry: await moduleUrl(input.buildRoot, tool.executor.entry), method: tool.executor.method, args, invocationId: invocation.invocationId,
          })); } finally { invocation.signal.removeEventListener("abort", abort); }
        });
        live.set(manifest.id, runtime);
      },
      async drain(_context?: PluginServiceContext) {
        ports.registry.unregisterPlugin(manifest.id, input.revision);
        caller!.phase = "drain";
        if (host.state === "running") await invoke("plugin.drain", context);
        host.drain();
      },
      async dispose(_context?: PluginServiceContext) {
        if (disposed) return;
        ports.registry.unregisterPlugin(manifest.id, input.revision);
        caller!.phase = "drain";
        if (host.state === "running") { host.resume(); await invoke("plugin.dispose", context, undefined, 5_000).catch(() => undefined); }
        await ports.hosts.remove(host.plan.hostId);
        disposed = true;
        if (live.get(manifest.id) === runtime) live.delete(manifest.id);
      },
      hostId, revision: input.revision, activationId: input.activationId,
      async invoke(method: string, value: unknown, signal: AbortSignal) {
        if (disposed || caller!.phase !== "active" || !/^[A-Za-z][A-Za-z0-9_.-]{0,127}$/.test(method)) throw new Error("Plugin service is unavailable");
        signal.throwIfAborted();
        const callId = randomUUID();
        const abort = () => { void host.invoke("plugin.cancel", { invocationId: callId }).catch(() => undefined); };
        signal.addEventListener("abort", abort, { once: true });
        try { const result = await ports.rpc.withServiceCall(hostId, callId, signal, () => invoke("plugin.surface", { method, input: value, callId }, signal)); signal.throwIfAborted(); return result; }
        finally { signal.removeEventListener("abort", abort); }
      },
    };
    return runtime;
  }
  return { prepare,
    onFailure(listener: (input: { pluginId: string; revision: string; activationId: string; reason: string }) => void) { failures.add(listener); return () => { failures.delete(listener); }; },
    async invoke(input: { pluginId: string; revision: string; activationId: string; method: string; input: unknown; signal: AbortSignal }) {
      const runtime = live.get(input.pluginId);
      if (!runtime || runtime.revision !== input.revision || runtime.activationId !== input.activationId) throw new Error("Plugin service activation is unavailable");
      return runtime.invoke(input.method, input.input, input.signal);
    },
    async close() { releaseExit(); await Promise.all([...live.values()].map(runtime => runtime.dispose())); } };
}

let installedRuntime: ReturnType<typeof createPluginProcessRuntime> | null = null;
export function installPluginProcessRuntime(runtime: ReturnType<typeof createPluginProcessRuntime> | null) { installedRuntime = runtime; }
export const pluginProcessRuntime = () => installedRuntime;
