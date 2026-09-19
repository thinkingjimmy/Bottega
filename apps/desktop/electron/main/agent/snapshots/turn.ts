/**
 * [INPUT]: Depends on TurnEntry state, terminal stamp, draft projection, and block-new-turn facts.
 * [OUTPUT]: Provides attach snapshots carrying exact request/generation/incarnation and terminal sequence identity.
 * [POS]: Pure Agent snapshot encoder used by TurnRegistry.
 */
import { serializeDraft } from "../../../../shared/chat-turn-reducer";
import type { TurnSnapshot } from "../../../../shared/agent-ipc";
import type { TurnEntry } from "../../turn-registry";

export function createTurnSnapshot(entry: TurnEntry | undefined, blocked: boolean): TurnSnapshot | null {
    if (!entry) return null;
    return {
      requestId: entry.requestId,
      generation: entry.generation,
      terminalSeq: entry.terminalSeq,
      incarnationId: entry.incarnationId,
      assistantSeq: entry.assistantSeq,
      steeringSupported: entry.turn?.steeringSupported === true,
      phase: entry.phase,
      cleanup: entry.cleanup,
      persist: entry.persist,
      blocksNewTurn: blocked,
      ...(entry.session ? { session: entry.session } : {}),
      ...(entry.serviceTierEffective ? { serviceTierEffective: entry.serviceTierEffective } : {}),
      ...(entry.resumeRetryToken
        ? { retryToken: entry.resumeRetryToken }
        : {}),
      allowedActions: {
        sameSession: false,
        freshSession: false,
        abandon: false,
      },
      draft: serializeDraft(entry.draft),
      interactionResults: structuredClone(entry.interactionResults ?? []),
      approvals: [...entry.approvals.values()].map((value) => structuredClone(value)),
      userInputs: [...entry.userInputs.values()]
        .sort((left, right) => (right.expiresAt ?? Infinity) - (left.expiresAt ?? Infinity))
        .map((value) => structuredClone(value)),
      liveSubagents: entry.subagents.live(),
      ...(entry.effectiveTerminal
        ? {
            terminal: entry.effectiveTerminal.type,
            ...(entry.effectiveTerminal.failureKind
              ? { failureKind: entry.effectiveTerminal.failureKind }
              : {}),
            ...(entry.effectiveTerminal.failure ? { failure: entry.effectiveTerminal.failure } : {}),
            ...(entry.effectiveTerminal.usageLimit
              ? { usageLimit: entry.effectiveTerminal.usageLimit }
              : {}),
          }
        : {}),
    };
  }
