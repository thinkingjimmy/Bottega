/**
 * [INPUT]: Depends on React useMemo, the Agent backend id and preload window.agent.warmProvider
 * [OUTPUT]: Provides hintProviderWarmup and useProviderWarmup: composer input and explicit option changes share a bounded bridge warm-up hint
 * [POS]: apps/desktop/src/lib/agent; lib's IPC boundary for Provider bridge warm-up; components attach its handlers and never touch the channel
 */

import { useMemo } from "react";
import type { AgentBackendId } from "../../../shared/ipc/agent/agent-ipc";

/* Provider bridge warm-up (TASK-11 flip ruling): only the person's own composer input or explicit settings change, never programmatic
   focus or catalog reconciliation; startup quota reads own their separate demand. A hint per Provider at most every 2 s: far
   below the idle period, so a bridge that stopped is never hidden behind a hint already sent, and a hint for a running bridge only
   re-arms its idle timer. */
const PROVIDER_WARM_DEDUPE_MS = 2_000;
const providerWarmedAt = new Map<AgentBackendId, number>();

export function hintProviderWarmup(backend: AgentBackendId | null) {
  if (!backend) return;
  const now = Date.now();
  if (now - (providerWarmedAt.get(backend) ?? 0) < PROVIDER_WARM_DEDUPE_MS) return;
  providerWarmedAt.set(backend, now);
  window.agent?.warmProvider?.(backend);
}

export function useProviderWarmup(backend: AgentBackendId | null) {
  return useMemo(() => {
    const warm = () => hintProviderWarmup(backend);
    return { onKeyDownCapture: warm, onPointerDownCapture: warm };
  }, [backend]);
}
