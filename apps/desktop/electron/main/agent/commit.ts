/**
 * [INPUT]: Depends on turn draft, planRequested, effective terminal, subagent registry, backend descriptor, display name, Memory This outline summarizes the facts and admission Reserved certainty assistant messageId/seq
 * [OUTPUT]: Provides prepareTurnCommit and OpenCode Plan decision making to combine pure judgments, bringing the activity projection with the only deriveMemoryTurnOutcome to the optional receipt, with the canonical TurnCommitInput of subagentsDelta when dirty
 * [POS]: The projected end-to-end projection of the agent sub-module; Delete the default default assistant, Plan and the wrong metadata (real back-end names with failed attribution) in this slot
 */

import { settle, type TurnFailure } from "../../../shared/chat-turn-reducer";
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
  return {
    agent: backendById(backend).displayName,
    message: terminal.message ?? "Agent 执行失败",
  };
}

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
  const terminal = entry.effectiveTerminal ?? {
    type: "error" as const,
    message: "Agent 未返回完成事件",
  };
  const result = settle(
    entry.draft,
    Date.now(),
    turnFailure(entry.backend, terminal),
    entry.planRequested
  );
  const subagentsDelta = entry.subagents.settle();
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
      content: result.content || "（本轮无文本回复）",
      ...(result.parts ? { parts: result.parts } : {}),
      durationMs: result.durationMs,
      ...(result.isError ? { isError: true } : {}),
      ...(terminal.failureKind ? { failureKind: terminal.failureKind } : {}),
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
