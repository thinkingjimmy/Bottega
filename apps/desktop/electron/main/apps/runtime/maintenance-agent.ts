/**
 * [INPUT]: Depends on the ordered backend registry, purpose-scoped runtime eligibility, task cancellation and App execution records.
 * [OUTPUT]: Selects a qualified maintenance Agent, freezes its identity per task, checks subsequent purposes and records execution without creating authorization.
 * [POS]: Shared maintenance selection for install analysis, repair, extension delivery and server upkeep; App preferences are not selection inputs.
 */

import type { AgentBackendId } from "../../../../shared/ipc/agent/agent-ipc";
import { backendRuntimeRegistry, orderedBackends } from "../../backends";
import type { AppStore } from "../store/app-store";

export type MaintenancePurpose = "install-analysis" | "repair" | "serve";
type SelectionOptions = {
  cwd?: string;
  requested?: AgentBackendId | "auto";
  consent?: { backend: AgentBackendId } | null;
  requireConsent?: boolean;
  signal?: AbortSignal;
};

export class MaintenanceAgentUnavailableError extends Error {
  readonly code = "app-maintenance-unavailable";
  constructor(readonly purpose: MaintenancePurpose) {
    super(`App 维护已暂停：需要已就绪且具备对应能力的 Agent；当前 Agent 不可用于 ${purpose}。`);
    this.name = "MaintenanceAgentUnavailableError";
  }
}

export async function resolveMaintenanceAgent(purpose: MaintenancePurpose, options: SelectionOptions = {}) {
  for (const descriptor of orderedBackends()) {
    options.signal?.throwIfAborted();
    const maintenance = descriptor.maintenance;
    if (!maintenance || !descriptor.headless ||
        options.requested && options.requested !== "auto" && options.requested !== descriptor.id ||
        options.requireConsent && options.consent?.backend !== descriptor.id) continue;
    const snapshot = await backendRuntimeRegistry.resolve(descriptor.id);
    options.signal?.throwIfAborted();
    if (snapshot.runtimeStatus !== "installed" || !snapshot.capabilities.maintenance ||
        !snapshot.capabilities.headless.includes(purpose)) continue;
    const eligibility = await backendRuntimeRegistry.operationEligibility(descriptor.id, purpose,
      { cwd: options.cwd, ignoreUserConfig: true }, snapshot);
    if (eligibility.decision === "allow") return { descriptor, maintenance, snapshot, purpose };
  }
  throw new MaintenanceAgentUnavailableError(purpose);
}

type Selection = Awaited<ReturnType<typeof resolveMaintenanceAgent>>;
const taskSelections = new WeakMap<object, Promise<Selection>>();

export function maintenanceAgentForTask(task: { controller: AbortController }, purpose: MaintenancePurpose,
  options: Omit<SelectionOptions, "signal" | "requested"> & { onSelected?(selection: Selection): Promise<void> } = {}) {
  const existing = taskSelections.get(task);
  if (existing) return existing.then(selected => {
    task.controller.signal.throwIfAborted();
    if (options.requireConsent && options.consent?.backend !== selected.descriptor.id) {
      throw new MaintenanceAgentUnavailableError(purpose);
    }
    if (selected.purpose !== purpose) {
      return resolveMaintenanceAgent(purpose, { ...options, requested: selected.descriptor.id, signal: task.controller.signal });
    }
    return selected;
  });
  const selection = resolveMaintenanceAgent(purpose, { ...options, signal: task.controller.signal })
    .then(async selected => {
      task.controller.signal.throwIfAborted();
      await options.onSelected?.(selected);
      return selected;
    });
  taskSelections.set(task, selection);
  return selection;
}

export async function recordMaintenanceAgent(store: Pick<AppStore, "get" | "update">,
  appId: string, backend: AgentBackendId) {
  if (store.get(appId)?.maintenanceAgent === backend) return;
  await store.update(appId, record => ({ ...record, maintenanceAgent: backend }));
}
