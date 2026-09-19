/**
 * [INPUT]: Depends on retry claims, Agent context projections, frozen handoff, and session replacement/restart callbacks
 * [OUTPUT]: Retries same or fresh sessions while preserving user input, re-arming the retry token on failure and keeping projection inputs and final receiver context consistent
 * [POS]: agent/ resume-failure recovery unit; the actual transport restart is injected by the caller, not owned here
 */

import { randomUUID } from "node:crypto";

import { handoffInput } from "./history/builder";
import { createFinalTurnProjection } from "./product-context";
import type { AgentContext } from "./bridge-types";
import type { AgentSendPayload } from "../../../shared/agent-ipc";
import type {
  AgentTurn,
  ResolvedAgentInput,
} from "../backends/types";
import type {
  TurnEntry,
  TurnRegistry,
} from "../turn-registry";

type RetryEntry = TurnEntry<AgentTurn> & {
  payload?: AgentSendPayload;
  context?: AgentContext;
};

type RetryInput = {
  turns: TurnRegistry<AgentTurn>;
  requestId: string;
  retryToken: string;
  replaceSession(
    entry: RetryEntry,
    oldSession: NonNullable<AgentSendPayload["session"]>
  ): Promise<void>;
  prepareFreshInput?(entry: RetryEntry): Promise<AgentSendPayload["handoff"]>;
  publishState(entry: RetryEntry): void;
  onGenerationStart?(entry: RetryEntry, generation: number): void;
  restart(entry: RetryEntry, input: ResolvedAgentInput): void;
};

export async function retryAgentWithoutSession(input: RetryInput) {
  return retryAgent(input, "fresh-session");
}

export async function retryAgentSameSession(input: RetryInput) {
  return retryAgent(input, "same-session");
}

async function retryAgent(
  input: RetryInput,
  mode: "same-session" | "fresh-session"
) {
  const entry = input.turns.byRequest(input.requestId) as
    | RetryEntry
    | undefined;
  if (!entry?.payload?.session || !entry.context || !entry.resolvedInput) {
    throw new Error("resume retry 请求已结束");
  }
  const oldSession = entry.payload.session;
  const retryClaim = input.turns.claimRetry(entry, input.retryToken);
  if (mode === "fresh-session") {
    try {
      const handoff = await input.prepareFreshInput?.(entry);
      if (handoff) entry.payload = { ...entry.payload, handoff };
      await input.replaceSession(entry, oldSession);
    } catch (cause) {
      /* The control receipt for this attempt is already settled `unknown`; restoring the
         same token would poison every later `recovery:<token>` control, Stop included. */
      input.turns.restoreRetry(retryClaim, randomUUID());
      input.publishState(entry);
      throw cause;
    }
  }
  let resolved = entry.resolvedInput as ResolvedAgentInput;
  if (mode === "fresh-session" && entry.payload.handoff?.text) {
    const text = entry.payload.handoff.text;
    // Resumed-session inputs have no injected handoff; clearing session below prevents a second prepend.
    resolved = { ...resolved, input: [{ type: "text", text }, ...resolved.input] };
    entry.payload = { ...entry.payload, input: handoffInput(entry.payload.input, entry.payload.handoff) };
  }
  const generation = input.turns.beginRetry(retryClaim);
  input.onGenerationStart?.(entry, generation);
  if (mode === "fresh-session") {
    entry.payload = { ...entry.payload, session: undefined };
    const fresh = { handoff: entry.payload.handoff, freshSession: true };
    if (entry.context.turnProjectionInput) {
      entry.context.turnProjectionInput = { ...entry.context.turnProjectionInput, ...fresh };
    }
    if (entry.context.turnAppAcquisition) {
      entry.context.turnAppAcquisition = { ...entry.context.turnAppAcquisition, ...fresh };
    }
    if (entry.context.finalTurnProjection) {
      entry.context.finalTurnProjection = createFinalTurnProjection({ ...entry.context.finalTurnProjection, ...fresh });
    }
  }
  input.publishState(entry);
  input.restart(entry, resolved);
}
