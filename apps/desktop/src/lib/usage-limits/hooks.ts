/**
 * [INPUT]: Depends on React effect lifetimes and the shared quota store.
 * [OUTPUT]: Provides passive quota subscription and explicit Settings/menu demand hooks.
 * [POS]: Surface lifecycle adapter; closed composers and tooltips cannot initiate a query.
 */
import { useEffect, useId, useSyncExternalStore } from "react";
import { AGENT_BACKEND_ORDER, type AgentBackendId } from "../../../shared/agent-ipc";
import type { LimitsDemand } from "../../../shared/usage-limits/types";
import { usageLimitsStore } from "./store";
export function useUsageLimits() {
  return useSyncExternalStore(usageLimitsStore.subscribe, usageLimitsStore.getSnapshot, usageLimitsStore.getSnapshot);
}
export function useUsageLimitsDemand(active: boolean, mode: LimitsDemand["mode"], backends: readonly AgentBackendId[] = AGENT_BACKEND_ORDER) {
  const id = useId().replace(/[^A-Za-z0-9:_-]/g, "_");
  const key = backends.join(",");
  useEffect(() => active ? usageLimitsStore.demand(`quota:${id}`, mode, key.split(",") as AgentBackendId[]) : undefined, [active, mode, key, id]);
}
