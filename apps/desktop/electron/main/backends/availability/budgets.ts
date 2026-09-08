/**
 * [INPUT]: Depends on the existing shell, CLI version and ACP handshake deadlines.
 * [OUTPUT]: Provides finite background-check phase budgets and a four-candidate ceiling.
 * [POS]: Registry and ACP readiness scheduling constants; no evidence-expiry timers.
 */
export const CHECK_QUEUE_MS = 10_000;
export const MAX_RUNTIME_CANDIDATES = 4;
// Queue 10s + shell 5s + four versions at 5s + filesystem/cleanup margin 5s.
export const RUNTIME_DISCOVERY_MS = 40_000;
// Runtime 40s + auth queue 10s + longest handshake 20s + cleanup margin 5s.
export const FULL_CHECK_MS = 75_000;
