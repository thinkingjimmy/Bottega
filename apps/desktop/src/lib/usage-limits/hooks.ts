/**
 * [INPUT]: Depends on React effect lifetimes, browser idle scheduling and the shared quota store.
 * [OUTPUT]: Provides passive subscriptions, Settings/menu demand and cancellable idle/intent first-read prefetch.
 * [POS]: Surface lifecycle adapter; closed composers prefetch once without retaining polling demand.
 */
import { useCallback, useEffect, useId, useRef, useSyncExternalStore } from "react";
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
export function useUsageLimitsPrefetch(active: boolean, backends: readonly AgentBackendId[] = AGENT_BACKEND_ORDER) {
  const start = useRef<(() => void) | undefined>(undefined);
  const key = backends.join(",");
  useEffect(() => {
    if (!active) return;
    let release: (() => void) | undefined;
    const run = () => {
      if (release) return;
      cancel();
      release = usageLimitsStore.prefetch(key.split(",") as AgentBackendId[]);
    };
    const idle = typeof window.requestIdleCallback === "function";
    const handle = idle ? window.requestIdleCallback(run) : window.setTimeout(run, 1500);
    const cancel = () => idle ? window.cancelIdleCallback(handle) : window.clearTimeout(handle);
    start.current = run;
    return () => { start.current = undefined; cancel(); release?.(); };
  }, [active, key]);
  return useCallback(() => start.current?.(), []);
}
