/**
 * [INPUT]: Depends on the Agent backend ids and an accounts port (each CLI's login fingerprint and a change signal)
 * [OUTPUT]: Provides AgentAccounts and watchAgentAccounts, which calls reset(backend) only when an Agent CLI signs in to a different account
 * [POS]: The Dock's per-CLI usage-history rule (TASK-28); DockService wires it to DockUsage.resetHistory
 */
import type { AgentBackendId } from "../../../../shared/ipc/agent/agent-ipc";

export type AgentAccounts = { fingerprint(backend: AgentBackendId): string | null; subscribe(listener: (backend: AgentBackendId) => void): () => void };

/* One Agent CLI signing in to a different account clears only that Agent's usage history; first sight after launch
   (null → value) and a sign-out (value → null) clear nothing, and a Bottega account switch never reaches here. */
export function watchAgentAccounts(accounts: AgentAccounts | undefined, reset: (backend: AgentBackendId) => void): () => void {
  if (!accounts) return () => {};
  const seen = new Map<AgentBackendId, string>();
  return accounts.subscribe((backend) => {
    const next = accounts.fingerprint(backend); if (next === null) return;
    const previous = seen.get(backend); seen.set(backend, next);
    if (previous !== undefined && previous !== next) reset(backend);
  });
}
