/**
 * [INPUT]: Depends on frozen active-turn capabilities, backend policy and resolved Agent input.
 * [OUTPUT]: Provides the synchronous Steer verdict: consumable now, next turn only, or a thrown format failure.
 * [POS]: Pure control policy; dispatch performs no asynchronous discovery or validation after its final deadline fence.
 */
import type { BackendCapabilities } from "../../../../shared/ipc/agent/agent-ipc";
import type { ProviderId } from "@ai-chat/cloud-protocol/contracts/provider";
import type { ResolvedAgentInput } from "../../backends/types";
import { resolveProvider } from "../../backends";
import { assertResolvedInputCapabilities } from "../../backends/runtime/capability-validation";

// Staged snapshots need a new turn with grants for their original files.
export const steerCarriesStagedSnapshot = (input: ResolvedAgentInput["input"]) =>
  input.some(item => item.type === "mention" || item.type === "skill");

/**
 * `false`: the running turn cannot vouch for this input, so it travels as the next turn (whose own gate
 * re-checks the format). Known capabilities that reject the format throw: the next turn would refuse it too.
 */
export function steerTurnCanConsume(backendId: ProviderId, input: ResolvedAgentInput["input"], capabilities?: BackendCapabilities) {
  if (!capabilities) return !input.some(item => item.type === "image");
  /* A package Provider that stopped being available mid-turn consumes nothing more (its bridge is closing). */
  const backend = resolveProvider(backendId);
  if (!backend) return false;
  assertResolvedInputCapabilities(backend, input, capabilities);
  return true;
}
