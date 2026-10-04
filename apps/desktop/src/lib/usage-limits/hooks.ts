/**
 * [INPUT]: Depends on React effect lifetimes and the shared quota store.
 * [OUTPUT]: Provides passive subscriptions, Settings/menu demand (by default for every Provider with quota, as main decides) and an intent-only first-read prefetch of the Providers a surface lists (never on idle at launch).
 * [POS]: Surface lifecycle adapter; closed composers prefetch once without retaining polling demand.
 */
import { useCallback, useEffect, useId, useRef, useSyncExternalStore } from "react";
import type { AgentBackendId } from "../../../shared/ipc/agent/agent-ipc";
import type { LimitsDemand } from "../../../shared/usage-limits/types";
import { usageLimitsStore } from "./store";
export function useUsageLimits() {
  return useSyncExternalStore(usageLimitsStore.subscribe, usageLimitsStore.getSnapshot, usageLimitsStore.getSnapshot);
}
export function useUsageLimitsDemand(active: boolean, mode: LimitsDemand["mode"], backends?: readonly AgentBackendId[]) {
  const id = useId().replace(/[^A-Za-z0-9:_-]/g, "_");
  const key = backends?.join(",") ?? null;
  useEffect(() => active ? usageLimitsStore.demand(`quota:${id}`, mode, key === null ? undefined : key.split(",") as AgentBackendId[]) : undefined,
    [active, mode, key, id]);
}
export function useUsageLimitsPrefetch(active: boolean, backends: readonly AgentBackendId[]) {
  const start = useRef<(() => void) | undefined>(undefined);
  const key = backends.join(",");
  useEffect(() => {
    if (!active) return;
    let release: (() => void) | undefined;
    const run = () => {
      if (release) return;
      release = usageLimitsStore.prefetch(key.split(",") as AgentBackendId[]);
    };
    /* No read on idle at launch any more (OPT-20, ruled 2026-09-25): the launch warm-up started `kimi web` (~430 MB)
       for a menu nobody had opened. The read starts on intent — pointer or focus on the Agent trigger — or when the
       menu opens and asks for it. */
    start.current = run;
    return () => { start.current = undefined; release?.(); };
  }, [active, key]);
  return useCallback(() => start.current?.(), []);
}
