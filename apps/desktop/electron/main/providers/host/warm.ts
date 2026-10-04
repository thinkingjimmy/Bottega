/**
 * [INPUT]: Depends on renderer-scoped IPC, the installed ProviderBridgeRuntime and the backend runtime registry's already-known runtimes
 * [OUTPUT]: Provides registerProviderWarmup: the main window's `agent:warm-provider` hint starts a bridge-switched Provider's stopped bridge and proves readiness, with no turn
 * [POS]: Predictive warm-up (TASK-11 flip ruling): the person started typing, so the send should not wait the 0.4–1.6 s a cold bridge costs; an unused warm-up is idle-stopped like any other, and nothing here runs at app launch
 */
import { randomUUID } from "node:crypto";
import { AGENT_BACKEND_ORDER, AGENT_CHANNEL, type AgentBackendId } from "../../../../shared/ipc/agent/agent-ipc";
import { backendRuntimeRegistry } from "../../backends";
import { rendererIpc } from "../../registration/ipc-registrar";
import { installedProviderBridge } from "./runtime";

/** A hint, never a request: a bridge runtime not yet composed, a runtime not yet known, or any failure is ignored (the send runs cold). */
export function warmProviderBridge(backend: AgentBackendId) {
  const providers = installedProviderBridge();
  if (!providers) return;
  /* Only a runtime the registry already knows: a warm-up never starts discovery or a probe. */
  const snapshot = backendRuntimeRegistry.current(backend);
  if (snapshot?.runtimeStatus !== "installed" || !snapshot.runtime) return;
  let live = true;
  const turnKey = randomUUID();
  const principal = providers.turnPrincipal({ chatId: "provider-warm-up", incarnationId: "warm-up" }, `warm-${turnKey}`, turnKey, () => live);
  void providers.ensure(backend, principal, snapshot.runtime)
    .catch(cause => console.warn(`[providers] ${backend} warm-up failed`, cause instanceof Error ? cause.message : String(cause)))
    .finally(() => { live = false; });
}

export function registerProviderWarmup(rendererUrl: string) {
  rendererIpc(rendererUrl, "Provider warm-up requires the main window").on(AGENT_CHANNEL.warmProvider, (...args: unknown[]) => {
    const backend = args[0];
    if (args.length !== 1 || !(AGENT_BACKEND_ORDER as readonly unknown[]).includes(backend)) return;
    warmProviderBridge(backend as AgentBackendId);
  });
}
