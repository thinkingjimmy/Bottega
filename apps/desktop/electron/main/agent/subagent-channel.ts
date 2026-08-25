/**
 * [INPUT]: Depends on lease-bound Builtin MCP, BridgeEntry, TurnRegistry and Agent event release ports
 * [OUTPUT]: Provides SubagentChannel contract and createSubagentChannel plant
 * [POS]: The parent-turn adapter for the agent module; Only exposing current generation/lease can prove ownership of draft and child operations
 */

import { applySubagent } from "../../../shared/chat-turn-reducer";
import type {
  AgentBackendId,
  AgentEventBody,
  AgentSendPayload,
  AgentSubagentMeta,
  AgentTurnItem,
} from "../../../shared/agent-ipc";
import type { PersistedSubagent } from "../../../shared/chats-ipc";
import type { AgentTurn } from "../backends/types";
import type { BuiltinMcpLease } from "../tools/lease";
import type {
  SubagentOutcomeStatus,
  TurnChildTask,
  TurnRegistry,
} from "../turn-registry";
import type { BridgeEntry } from "./bridge-types";

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown
  ? Omit<T, K>
  : never;

type Publish = (
  entry: BridgeEntry,
  body: DistributiveOmit<AgentEventBody, "requestId">
) => unknown;

export type SubagentChannel = {
  readonly signal: AbortSignal;
  readonly snapshot: Readonly<{
    permissionMode: AgentSendPayload["turnOptions"]["permissionMode"];
    workspace: string;
    initiatorBackend: AgentBackendId;
  }>;
  beginAttempt(meta: AgentSubagentMeta): void;
  upsert(meta: AgentSubagentMeta): void;
  applyItem(agentThreadId: string, item: AgentTurnItem): void;
  applyDelta(agentThreadId: string, itemId: string, text: string): void;
  register(child: TurnChildTask): () => void;
  reserveDraftSlot(agentThreadId: string): boolean;
  getOutcome(agentThreadId: string): SubagentOutcomeStatus | undefined;
  setOutcome(agentThreadId: string, outcome: SubagentOutcomeStatus): void;
  /** 只在真实 lease-bound channel 上存在；测试窄 fake 可省略。 */
  peekPersistedResult?(agentThreadId: string): PersistedSubagent | undefined;
};

export function createSubagentChannel(
  lease: BuiltinMcpLease,
  turns: TurnRegistry<AgentTurn>,
  publish: Publish
): SubagentChannel | undefined {
  const entry = turns.byRequest(lease.requestId) as BridgeEntry | undefined;
  if (
    !entry ||
    entry.conversationId !== lease.chatId ||
    entry.generation !== lease.generation ||
    entry.backend !== lease.initiatorBackend ||
    entry.sourceTerminal ||
    entry.fenceClosed ||
    entry.builtinMcp?.lease.leaseId !== lease.leaseId ||
    entry.builtinMcp.lease.incarnationId !== lease.incarnationId ||
    !entry.payload ||
    !entry.context
  ) {
    return undefined;
  }
  const snapshot = Object.freeze({
    permissionMode: entry.payload.turnOptions.permissionMode,
    workspace: entry.context.workspace,
    initiatorBackend: lease.initiatorBackend,
  });
  const publishMeta = (meta: AgentSubagentMeta) => {
    entry.draft = applySubagent(entry.draft, meta);
    publish(entry, {
      type: "subagent-update",
      agent: meta,
      detailState: entry.subagents.detailState(meta.agentThreadId),
    });
  };
  const update = (meta: AgentSubagentMeta) => {
    publishMeta(entry.subagents.upsertMeta(meta).meta);
  };
  const beginAttempt = (meta: AgentSubagentMeta) => {
    const attempt = entry.subagents.resume(
      meta.agentThreadId,
      {
        name: meta.name,
        model: meta.model,
        origin: meta.origin,
        agent: meta.agent,
        status: "running",
      },
      meta.lastActivityAt
    );
    publishMeta(attempt.meta);
  };
  return {
    signal: AbortSignal.any([entry.childController.signal, lease.signal]),
    snapshot,
    beginAttempt,
    upsert: update,
    applyItem: (agentThreadId, item) => {
      entry.subagents.applyItem(agentThreadId, item);
      const agent = entry.subagents.get(agentThreadId);
      if (agent) {
        publish(entry, { type: "subagent-item", agentThreadId, agent, item });
      }
    },
    applyDelta: (agentThreadId, itemId, text) => {
      entry.subagents.applyDelta(agentThreadId, itemId, text);
      const agent = entry.subagents.get(agentThreadId);
      if (agent) {
        publish(entry, {
          type: "subagent-item-delta",
          agentThreadId,
          agent,
          itemId,
          text,
        });
      }
    },
    register: (child) => turns.registerChild(entry, child),
    reserveDraftSlot: (agentThreadId) => {
      const reservation = entry.subagents.reserveDraft(agentThreadId);
      if (!reservation.ok) return false;
      if (reservation.victim) {
        publish(entry, {
          type: "subagent-update",
          agent: reservation.victim,
          detailState: "unavailable",
        });
      }
      return true;
    },
    getOutcome: (agentThreadId) =>
      entry.subagentOutcomes.get(agentThreadId),
    setOutcome: (agentThreadId, outcome) => {
      entry.subagentOutcomes.set(agentThreadId, outcome);
    },
    peekPersistedResult: (agentThreadId) =>
      entry.subagents.persisted()[agentThreadId],
  };
}
