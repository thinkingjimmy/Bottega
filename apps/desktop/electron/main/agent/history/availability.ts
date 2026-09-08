/**
 * [INPUT]: Depends on runtime builtin capability and the saved tool disable policy
 * [OUTPUT]: Resolves the history lookup descriptor for fresh relay and retry preparation
 * [POS]: Capability projection only; final tool issuance still applies the current lease policy
 */
import type { AgentBackendId } from "../../../../shared/agent-ipc";
import type { HandoffCoverage } from "../../../../shared/chat-agent/contracts";
import { backendRuntimeRegistry } from "../../backends";
export function historyLookupAvailability(backend: AgentBackendId, disabled: readonly string[]): HandoffCoverage["lookup"] {
  if (disabled.includes("read_chat_history")) return "disabled";
  const snapshot = backendRuntimeRegistry.current(backend);
  if (snapshot?.runtimeStatus !== "installed") return "unavailable";
  return snapshot.capabilities.builtinTools === "none" ? "unsupported" : "available";
}
