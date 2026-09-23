/**
 * [INPUT]: Depends on frozen active-turn capabilities, backend policy and resolved Agent input.
 * [OUTPUT]: Provides the synchronous Steer verdict: consumable now, next turn only, or a thrown format failure.
 * [POS]: Pure control policy; dispatch performs no asynchronous discovery or validation after its final deadline fence.
 */
import type { AgentBackendId, BackendCapabilities } from "../../../../shared/agent-ipc";
import type { ResolvedAgentInput } from "../../backends/types";
import { backendById } from "../../backends";
import { assertResolvedInputCapabilities } from "../../backends/capability-validation";

// Staged snapshots need a new turn with grants for their original files.
export const steerCarriesStagedSnapshot = (input: ResolvedAgentInput["input"]) =>
  input.some(item => item.type === "mention" || item.type === "skill");

/**
 * `false`: the running turn cannot vouch for this input, so it travels as the next turn (whose own gate
 * re-checks the format). Known capabilities that reject the format throw: the next turn would refuse it too.
 */
export function steerTurnCanConsume(backendId: AgentBackendId, input: ResolvedAgentInput["input"], capabilities?: BackendCapabilities) {
  if (!capabilities) return !input.some(item => item.type === "image");
  assertResolvedInputCapabilities(backendById(backendId), input, capabilities);
  return true;
}
