/**
 * [INPUT]: The bridge-owned AgentTurn registry, resolved input blocks and synchronous steering capability policy.
 * [OUTPUT]: createSteeringOperations preserves epoch-fenced registration and staged-input refusal.
 * [POS]: Agent bridge steering adapters; the bridge retains the single TurnRegistry.
 */
import { resolvedInputBlocks } from "../../backends/acp/input-blocks";
import type { AgentTurn, ResolvedAgentInput } from "../../backends/types";
import { steerCarriesStagedSnapshot, steerTurnCanConsume } from "../controls/steering";
import type { BridgeEntry } from "./bridge-types";
import type { TurnRegistry } from "../turns/turn/turn-registry";

export function createSteeringOperations(turns: TurnRegistry<AgentTurn>) {
  function registerAgentSteerOperation(requestId: string) {
    const entry = turns.byRequest(requestId) as BridgeEntry | undefined;
    if (!entry?.turn) throw new Error("Target turn is missing or has not started");
    const operation = turns.registerSteerOp(entry);
    return {
      ...operation,
      conversationId: entry.conversationId,
      payload: structuredClone(entry.payload!),
      assertCurrent: () =>
        turns.assertSteerEpoch(entry, operation.epoch, operation.signal),
    };
  }

  async function steerAgentTurn(
    requestId: string,
    input: ResolvedAgentInput["input"]
  ) {
    const entry = turns.byRequest(requestId);
    if (!entry?.turn?.steer) {
      return { outcome: "unconsumed", reason: "unsupported" } as const;
    }
    /* A transferred snapshot must wait for the next turn to acquire its staged resources. */
    if (steerCarriesStagedSnapshot(input)) {
      return { outcome: "unconsumed", reason: "staged-resource" } as const;
    }
    if (!steerTurnCanConsume(entry.backend, input, (entry as BridgeEntry).context?.activeCapabilities)) {
      return { outcome: "unconsumed", reason: "unsupported" } as const;
    }
    return entry.turn.steer(resolvedInputBlocks(input));
  }
  return { registerAgentSteerOperation, steerAgentTurn };
}
