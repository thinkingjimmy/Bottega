/**
 * [INPUT]: Depends on TurnRegistry, restore Bridge entry, session, remove the back and restart the back
 * [OUTPUT]: Provides retryAgentWithoutSession, performs retry token claim/rollback/begin and linear transactions that are known to generate a split
 * [POS]: The resume-failed recovery unit of the agent sub-module; Transport Reboot Details Inserted by Caller
 */

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
  context?: unknown;
};

type RetryInput = {
  turns: TurnRegistry<AgentTurn>;
  requestId: string;
  retryToken: string;
  replaceSession(
    entry: RetryEntry,
    oldSession: NonNullable<AgentSendPayload["session"]>
  ): Promise<void>;
  publishState(entry: RetryEntry): void;
  onGenerationStart?(entry: RetryEntry, generation: number): void;
  restart(entry: RetryEntry, input: ResolvedAgentInput): void;
};

export async function retryAgentWithoutSession(input: RetryInput) {
  const entry = input.turns.byRequest(input.requestId) as
    | RetryEntry
    | undefined;
  if (!entry?.payload?.session || !entry.context || !entry.resolvedInput) {
    throw new Error("resume retry 请求已结束");
  }
  const oldSession = entry.payload.session;
  const retryClaim = input.turns.claimRetry(entry, input.retryToken);
  try {
    await input.replaceSession(entry, oldSession);
  } catch (cause) {
    input.turns.restoreRetry(retryClaim);
    throw cause;
  }
  const resolved = entry.resolvedInput as ResolvedAgentInput;
  const generation = input.turns.beginRetry(retryClaim);
  input.onGenerationStart?.(entry, generation);
  entry.payload = { ...entry.payload, session: undefined };
  input.publishState(entry);
  input.restart(entry, resolved);
}
