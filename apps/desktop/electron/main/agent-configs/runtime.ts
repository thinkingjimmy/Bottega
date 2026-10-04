/**
 * [INPUT]: Depends on Configuration store/service/sync, Provider measurements, host enforcement and live Skill/MCP inventories.
 * [OUTPUT]: Provides composeAgentConfigs, agentConfigsRuntime, hostEnforcement, hostEnforcedFor and attachAgentConfigSync.
 * [POS]: Startup composition for account Agent configurations and workflow resource admission.
 */
import type { BrowserWindow } from "electron";
import type { AgentConfigInventory, ProviderDefaults } from "@ai-chat/cloud-protocol/agent-config/payload";
import { effectiveGuarantees, type HostEnforcement } from "@ai-chat/cloud-protocol/agent-config/guarantees";
import { registerAgentConfigs } from "./ipc";
import { builtinProviderDescriptor } from "../../../shared/providers/builtin";
import { AgentConfigService } from "./service";
import { AgentConfigStore } from "./store";
import { AgentConfigSync, type AgentConfigSyncPorts } from "./sync";
import type { ProviderMeasurements } from "../providers/measurements/service";

type Defaults = { model?: string; reasoningEffort?: string; permissionMode?: string };
export type AgentConfigsRuntime = Awaited<ReturnType<typeof composeAgentConfigs>>;
let installed: AgentConfigsRuntime | null = null;
export const agentConfigsRuntime = () => installed;

/* This computer's sandbox wraps these Providers with a read-only workspace (RSH-07: Seatbelt, and Claude's own sandbox settings).
   Measured evidence (network-off, and read-only where no host sandbox applies) comes from the host probes. The config dialog's
   guarantees and workflow role admission both read this one list. */
export function hostEnforcement(): HostEnforcement {
  return { readOnlySandbox: process.platform === "darwin" ? ["codex", "kimi", "opencode", "claude"] : [] };
}
/** The capabilities the host itself enforces around a Provider on this computer. */
export const hostEnforcedFor = (providerId: string) => hostEnforcement().readOnlySandbox.includes(providerId) ? ["read-only" as const] : [];

export async function composeAgentConfigs(input: { userData: string; liveProjectIds(): ReadonlySet<string>; chatDefaults(providerId: string): Defaults | null;
  inventory?(projectId?: string): AgentConfigInventory;
  /** This computer's host-probe records per Provider (providers/measurements); absent means nothing is measured. */
  measurements?: Pick<ProviderMeasurements, "current" | "onChanged">;
  /** Whether a Provider's plugin is on (Q29); a configuration of a turned-off Provider cannot be chosen or frozen. */
  providerEnabled?(providerId: string): boolean }) {
  const store = new AgentConfigStore(input.userData);
  await store.initialize();
  /* Inherit means this computer's Chat defaults for the Provider — the same values a new Chat would start with. */
  const defaultsFor = (providerId: string): ProviderDefaults => {
    // A Provider this computer does not know has no defaults to inherit.
    let value: Defaults | null; try { value = input.chatDefaults(providerId); } catch { value = null; }
    return value ? { model: value.model ?? null, reasoningEffort: value.reasoningEffort ?? null, permissionMode: value.permissionMode ?? null } : {};
  };
  const host = hostEnforcement();
  const service = new AgentConfigService(store, { now: () => Date.now(), liveProjectIds: input.liveProjectIds, descriptorFor: builtinProviderDescriptor, defaultsFor, inventory: input.inventory,
    ...(input.providerEnabled ? { providerEnabled: input.providerEnabled } : {}),
    guaranteesFor: payload => effectiveGuarantees({ payload, descriptor: builtinProviderDescriptor(payload.provider), host,
      ...(input.measurements?.current(payload.provider) ?? { measured: [], identity: null }) }) });
  const releaseMeasurements = input.measurements?.onChanged(() => service.refreshViews());
  const runtime = { store, service, close: () => { releaseMeasurements?.(); return store.closeAndFlush(); },
    /** Main-window registrar: the renderer bridge (AgentConfigBridge) for TASK-21. */
    registrar: { register: (window: BrowserWindow, rendererUrl: string) => registerAgentConfigs(service, window, rendererUrl) } };
  installed = runtime;
  return runtime;
}

/** Cloud composition calls this once the account runtime exists; without an installed store there is nothing to sync. */
export function attachAgentConfigSync(ports: Omit<AgentConfigSyncPorts, "store">) {
  const runtime = installed;
  if (!runtime) return null;
  const sync = new AgentConfigSync({ ...ports, store: runtime.store, onUploadTarget: present => runtime.service.setUploadTarget(present),
    report: error => console.warn("[agent-configs] sync failed", error instanceof Error ? error.message : String(error)) });
  runtime.service.setOwnerScope(() => sync.ownerScope());
  return { wake: () => sync.wake(), close: async () => { await sync.close(); runtime.service.setOwnerScope(null); runtime.service.setUploadTarget(false); } };
}
