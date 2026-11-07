/**
 * [INPUT]: Depends on canonical unified enablement and the existing Memory/Workflow/Artifact/Dock/Sketch execution owners.
 * [OUTPUT]: Provides native official contribution adapters, explicit feature switches with guarded original-state capture and truthful late-owner readiness.
 * [POS]: Main-owned native feature delegation; canonical installation state is authoritative and code updates never replay feature switches.
 */
import type { PluginView } from "@bottega/contracts/plugins/catalog";
import type { PluginCatalog } from "../../catalog";
import type { UnifiedPluginPlatform } from "../../platform/service";
import type { PluginEnablementRequest } from "../../platform/model";
const NATIVE = new Set(["memory", "workflow", "dock", "sketch"]);
const FEATURES = new Set([...NATIVE, "artifact"]);
type Ports = { platform: UnifiedPluginPlatform; catalog: Pick<PluginCatalog, "list" | "setEnabled" | "onChanged">; reportError?(cause: unknown): void };
export async function composeOfficialFeatureAdapters(ports: Ports) {
  const desired = new Map<string, boolean>(), views = new Map<string, PluginView>(), pending = new Set<string>(), errors = new Map<string, string>();
  const registered = new Map<string, () => void>(); let closed = false, chain: Promise<unknown> = Promise.resolve();
  const enqueue = <T>(run: () => Promise<T>): Promise<T> => { const task = chain.catch(() => undefined).then(run); chain = task; return task; };
  const reload = async () => { const items = await ports.catalog.list(); views.clear(); for (const item of items) if (FEATURES.has(item.id)) views.set(item.id, item); };
  const ready = (id: string) => {
    if (id !== "artifact") return true;
    const view = views.get(id); return Boolean(view?.enabled && view.availability.state !== "unsupported" && !errors.has(id));
  };
  async function applyOwner(id: string, enabled: boolean, strict: boolean) {
    const view = views.get(id);
    const refuse = (message: string) => { errors.set(id, message); pending.add(id); if (strict) throw new Error(message); return false; };
    if (!view) return refuse("Official feature owner is not ready: " + id);
    if (enabled === view.enabled) { errors.delete(id); pending.delete(id); return true; }
    if (enabled && view.availability.state === "unsupported") return refuse("Official feature is unavailable on this computer: " + id);
    if (enabled && view.turnOn.mode === "setup") return refuse("plugin-setup-required: " + id);
    try {
      await ports.catalog.setEnabled(id, enabled); await reload();
      if (views.get(id)?.enabled !== enabled) return refuse("Official feature switch did not settle: " + id);
      errors.delete(id); pending.delete(id); return true;
    } catch (cause) { errors.set(id, String((cause as Error).message)); pending.add(id); if (strict) throw cause; ports.reportError?.(cause); return false; }
  }
  async function refresh() {
    if (closed) return;
    await reload();
    for (const id of [...pending]) await applyOwner(id, desired.get(id) ?? false, false);
    for (const id of registered.keys()) await ports.platform.refreshHostAdapter(id);
    ports.platform.refreshReadiness();
  }
  async function apply(input: PluginEnablementRequest) {
    if (!FEATURES.has(input.pluginId) || closed) return;
    return enqueue(async () => {
      await reload();
      if (input.capturePrevious) {
        const view = views.get(input.pluginId);
        if (!view) throw new Error("Official feature owner is not ready: " + input.pluginId);
        input.capturePrevious(view.enabled);
      }
      desired.set(input.pluginId, input.enabled);
      try { await applyOwner(input.pluginId, input.enabled, true); }
      finally { for (const id of registered.keys()) await ports.platform.refreshHostAdapter(id); ports.platform.refreshReadiness(); }
    });
  }
  async function synchronize() {
    return enqueue(async () => {
      if (closed) return { pending: [] as string[] };
      for (const record of ports.platform.store.read(state => state.plugins)) {
        const id = record.manifest.id;
        if (!FEATURES.has(id) || record.installation.origin !== "official") continue;
        desired.set(id, record.installation.enabled); pending.add(id);
        if (!NATIVE.has(id) || registered.has(id)) continue;
        registered.set(id, ports.platform.registerHostAdapter(id, {
          state: () => {
            const enabled = desired.get(id) ?? false, view = views.get(id), error = errors.get(id);
            const active = Boolean(enabled && view?.enabled && view.availability.state !== "unsupported" && !error);
            return { enabled, ready: active, status: !enabled ? error ? "cleanup-failed" : "disabled" : active ? "ready" : "unavailable",
              ...(!active && enabled ? { error: error ?? (view?.turnOn.mode === "setup" ? "plugin-setup-required: " + id : "Official feature is not ready: " + id) } : error ? { error } : {}) };
          },
          setEnabled: enabled => apply({ pluginId: id, enabled }),
        }));
      }
      await refresh(); return { pending: [...pending] };
    });
  }
  await synchronize();
  const release = ports.catalog.onChanged(() => { if (!closed) void enqueue(refresh).catch(cause => ports.reportError?.(cause)); });
  return { apply, ready, synchronize,
    async close() { closed = true; release(); await chain.catch(() => undefined); for (const stop of registered.values()) stop(); registered.clear(); } };
}
