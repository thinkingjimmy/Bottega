/**
 * [INPUT]: Public plugin lifecycle, host API and manifest types only.
 * [OUTPUT]: definePlugin and createPluginLifecycle with explicit preparation, activation and drain admission.
 * [POS]: Package-side unified runtime shared by trusted plugin process adapters and author tooling.
 */
import type { PluginHostApi, PluginServiceContext, PluginServicePhase, PluginServiceRuntime } from "@bottega/contracts/plugins/platform";

export type PluginHandler = (input: unknown, context: PluginServiceContext) => unknown | Promise<unknown>;
export type PreparedPlugin = Readonly<{
  handlers?: Readonly<Record<string, PluginHandler>>;
  activate?(context: PluginServiceContext): void | Promise<void>;
  drain?(context: PluginServiceContext): void | Promise<void>;
  dispose?(context: PluginServiceContext): void | Promise<void>;
}>;
export type PluginDefinition = Readonly<{
  prepare(context: PluginServiceContext, api?: PluginHostApi): PreparedPlugin | Promise<PreparedPlugin>;
}>;
export type PluginLifecycle = PluginServiceRuntime & Readonly<{
  readonly phase: PluginServicePhase;
  invoke(method: string, input: unknown, context: PluginServiceContext): Promise<unknown>;
}>;

/** Preparation allocates and validates. The active hook starts business effects only after the host commits ownership. */
export function definePlugin<T extends PluginDefinition>(definition: T): T {
  return definition;
}

export function createPluginLifecycle(definition: PluginDefinition, api?: PluginHostApi): PluginLifecycle {
  let phase: PluginServicePhase = "unprepared";
  let identity: string | undefined;
  let prepared: PreparedPlugin | undefined;
  const inflight = new Set<Promise<unknown>>();
  const key = (context: PluginServiceContext) => [context.pluginId, context.revision, context.activationId].join("\0");
  const checkIdentity = (context: PluginServiceContext) => {
    if (identity !== key(context)) throw new Error("Plugin activation identity differs from the prepared owner");
  };
  return {
    get phase() { return phase; },
    async prepare(context) {
      if (phase !== "unprepared") throw new Error("Plugin has already been prepared");
      if (context.signal.aborted) throw new Error("Plugin preparation was cancelled");
      phase = "preparing"; identity = key(context);
      try { prepared = await definition.prepare(context, api); phase = "prepared"; }
      catch (cause) { phase = "failed"; throw cause; }
    },
    async activate(context) {
      checkIdentity(context);
      if (phase !== "prepared") throw new Error("Plugin is not prepared");
      if (context.signal.aborted) throw new Error("Plugin activation was cancelled");
      try { await prepared?.activate?.(context); phase = "active"; }
      catch (cause) { phase = "failed"; throw cause; }
    },
    async invoke(method, input, context) {
      if (phase !== "active") throw new Error("Plugin is not active");
      checkIdentity(context);
      if (context.signal.aborted) throw new Error("Plugin call was cancelled");
      const handler = prepared?.handlers?.[method];
      if (!handler) throw new Error("Unknown plugin method: " + method);
      const call = Promise.resolve().then(() => handler(input, context));
      inflight.add(call);
      try { return await call; } finally { inflight.delete(call); }
    },
    async drain(context) {
      checkIdentity(context);
      if (phase === "disposed" || phase === "draining") return;
      phase = "draining";
      try { await prepared?.drain?.(context); await Promise.allSettled([...inflight]); }
      catch (cause) { phase = "failed"; throw cause; }
    },
    async dispose(context) {
      checkIdentity(context);
      if (phase === "disposed") return;
      if (phase === "active") throw new Error("Drain the active plugin before disposal");
      try { await prepared?.dispose?.(context); phase = "disposed"; }
      catch (cause) { phase = "failed"; throw cause; }
    },
  };
}
export type { PluginHostApi, PluginServiceContext, PluginServicePhase, PluginServiceRuntime } from "@bottega/contracts/plugins/platform";
export { unifiedPluginManifestSchema, UNIFIED_PLUGIN_MANIFEST } from "@bottega/contracts/plugins/platform";
