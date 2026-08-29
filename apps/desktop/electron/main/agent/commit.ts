/**
 * [INPUT]: Depends on turn draft, Plan request state, effective terminal, subagent registry, backend identity, Memory outcome, and reserved assistant identity
 * [OUTPUT]: Provides prepareTurnCommit with ProductFailure structure, Plan synthesis, Memory outcome, the single subagent-convergence derivation shared by part and meta, and canonical message/subagent deltas without persistence-time fallback copy
 * [POS]: Pure final projection for the agent module; persistence receives structure and never display fallback text
 */

import {
  settle,
  type SubagentSettleOutcome,
  type TurnFailure,
} from "../../../shared/chat-turn-reducer";
import { planMessageKind } from "../../../shared/chat-plan-kind";
import type {
  ChatMessage,
  TurnCommitInput,
} from "../../../shared/chats-ipc";
import type { AgentBackendId } from "../../../shared/agent-ipc";
import { backendById } from "../backends";
import { PLAN_DECISION_SYNTHESIS } from "../backends/types";
import type {
  SourceTerminal,
  TurnEntry,
} from "../turn-registry";
import {
  deriveMemoryTurnOutcome,
  type MemoryTurnFacts,
} from "../memory/core/domain";

function turnFailure(
  backend: AgentBackendId,
  terminal: SourceTerminal
): TurnFailure | undefined {
  if (terminal.type !== "error") return undefined;
  return terminal.failure
    ? { failure: terminal.failure }
    : { agent: backendById(backend).displayName, message: terminal.message };
}

/* 子 agent 收敛的唯一判据是 turn 终态，不是「有没有报终态」——两家来源
   （codex.subagent 全量源 / claudeCode 归属源）都只在真被打断时才下发
   interrupted。判据取终态而非猜测，真中断因此不会被误标成功。 */
const subagentOutcomeOf = (
  terminal: SourceTerminal
): SubagentSettleOutcome =>
  terminal.type === "done" ? "completed" : "interrupted";

export function synthesizedPlanMessageKind(input: {
  backend: AgentBackendId;
  planRequested: boolean;
  terminalType: SourceTerminal["type"];
  content: string;
}): "plan" | undefined {
  return PLAN_DECISION_SYNTHESIS[input.backend] &&
    input.planRequested &&
    input.terminalType === "done" &&
    Boolean(input.content.trim())
    ? "plan"
    : undefined;
}

export function prepareTurnCommit(
  entry: TurnEntry,
  memoryFacts?: Omit<MemoryTurnFacts, "assistantMessagePresent">
): TurnCommitInput {
  const terminal = entry.effectiveTerminal;
  if (!terminal) {
    const subagentsDelta = entry.subagents.settle();
    return subagentsDelta && Object.keys(subagentsDelta).length ? { subagentsDelta } : {};
  }
  const subagentOutcome = subagentOutcomeOf(terminal);
  const result = settle(
    entry.draft,
    Date.now(),
    turnFailure(entry.backend, terminal),
    entry.planRequested,
    subagentOutcome
  );
  const subagentsDelta = entry.subagents.settle(subagentOutcome);
  const assistantMessagePresent = Boolean(
    result && terminal.type !== "cancelled"
  );
  if (!result || !assistantMessagePresent) {
    return subagentsDelta && Object.keys(subagentsDelta).length
      ? { subagentsDelta }
      : {};
  }
  const memoryOutcome = memoryFacts
    ? deriveMemoryTurnOutcome({ ...memoryFacts, assistantMessagePresent })
    : null;
  const messageKind =
    planMessageKind(terminal.type, result, entry.planRequested) ??
    synthesizedPlanMessageKind({
      backend: entry.backend,
      planRequested: entry.planRequested,
      terminalType: terminal.type,
      content: result.content,
    });
  return {
    message: {
      id: entry.messageId,
      seq: entry.assistantSeq,
      role: "assistant",
      content: result.content,
      ...(result.parts ? { parts: result.parts } : {}),
      durationMs: result.durationMs,
      ...(result.isError ? { isError: true } : {}),
      ...(terminal.failureKind ? { failureKind: terminal.failureKind } : {}),
      ...(terminal.failure ? { failure: terminal.failure } : {}),
      ...(terminal.usageLimit ? { usageLimit: terminal.usageLimit } : {}),
      ...(messageKind ? { kind: messageKind } : {}),
      ...(memoryOutcome
        ? {
            contextReceipt: {
              version: 1 as const,
              requestId: entry.requestId,
              memory: memoryOutcome,
            },
          }
        : {}),
      createdAt: Date.now(),
    } satisfies ChatMessage,
    ...(subagentsDelta && Object.keys(subagentsDelta).length
      ? { subagentsDelta }
      : {}),
  };
}
