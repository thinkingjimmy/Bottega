/**
 * [INPUT]: Depends on frozen active-turn capabilities, backend policy and resolved Agent input.
 * [OUTPUT]: Provides synchronous Steer validation and the original asynchronous assertion API.
 * [POS]: Pure control policy; dispatch performs no asynchronous discovery or validation after its final deadline fence.
 */
import type { AgentBackendId, BackendCapabilities } from "../../../../shared/agent-ipc";
import type { ResolvedAgentInput } from "../../backends/types";
import { backendById } from "../../backends";
import { assertResolvedInputCapabilities } from "../../backends/capability-validation";

// Staged snapshots need a new turn with grants for their original files.
export const steerCarriesStagedSnapshot = (input: ResolvedAgentInput["input"]) =>
  input.some(item => item.type === "mention" || item.type === "skill");

export function validateSteerTurnCapabilities(backendId: AgentBackendId, input: ResolvedAgentInput["input"], capabilities?: BackendCapabilities) {
  const backend = backendById(backendId);
  if (!capabilities) {
    if (input.some(item => item.type === "image")) throw new Error("Active turn capabilities are unknown");
    return;
  }
  assertResolvedInputCapabilities(backend, input, capabilities);
}

export async function assertSteerTurnCapabilities(...args: Parameters<typeof validateSteerTurnCapabilities>) {
  validateSteerTurnCapabilities(...args);
}
