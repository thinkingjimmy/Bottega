/**
 * [INPUT]: Depends on TurnRegistry projection lane, ThreadScopeRegistry, runtime registry, authentication and rewriting, Gallery image projection, third-party MCP protocol observation and shared subagent reducer
 * [OUTPUT]: Provides createTurnCallbacks to connect backend transport events to security projections, sync void before release, external observation, release/endpoint/session binding/health authority full re-assembly
 * [POS]: The turn event of the agent sub-module is re-routed to the factory; Generating fence In this unified gate, the agent-bridge is solely responsible for starting the sorting process
 */

import { applySubagent } from "../../../shared/chat-turn-reducer";
import { backendRuntimeRegistry } from "../backends";
import type { AgentTurnCallbacks, BackendDescriptor } from "../backends/types";
import { projectAgentImage } from "../gallery/agent-image-projection";
import type { ThreadScopeRegistry } from "../thread-scope";
import type {
  SourceTerminal,
  TurnRegistry,
} from "../turn-registry";
import type { AgentTurn } from "../backends/types";
import type {
  AgentBridgeOptions,
  AgentContext,
  AgentEventPayload,
  BridgeEntry,
} from "./bridge-types";

type TurnCallbackPorts = {
  turns: TurnRegistry<AgentTurn>;
  threadScopes: ThreadScopeRegistry;
  publish(entry: BridgeEntry, body: AgentEventPayload): unknown;
  observe(promise: Promise<unknown>, context: string): void;
  finalizeEntry(
    entry: BridgeEntry,
    source: SourceTerminal,
    options: AgentBridgeOptions,
    expectedGeneration?: number
  ): Promise<void>;
};

type TurnCallbackInput = {
  entry: BridgeEntry;
  generation: number;
  backend: BackendDescriptor;
  runtimeGeneration: number;
  options: AgentBridgeOptions;
  context: AgentContext;
};

export function createTurnCallbacks(
  ports: TurnCallbackPorts,
  input: TurnCallbackInput
): AgentTurnCallbacks {
  const { turns, threadScopes, publish, observe, finalizeEntry } = ports;
  const { entry, generation, backend, runtimeGeneration, options, context } =
    input;
  const ifCurrent = (callback: () => void) => {
    if (entry.generation === generation) callback();
  };
  const observeTurnItem = (
    item: Parameters<NonNullable<AgentBridgeOptions["onTurnItem"]>>[1]
  ) => {
    if (!options.onTurnItem) return;
    try {
      options.onTurnItem(entry.conversationId, item);
    } catch (cause) {
      console.warn(
        `[agent] turn item observer failed requestId=${entry.requestId}`,
        cause
      );
    }
  };
  return {
    onThread: async (session) => {
      if (entry.generation !== generation) return;
      if (!backend.validateSessionId(session.id)) {
        throw new Error(`${backend.displayName} 返回了无效的 sessionId`);
      }
      threadScopes.bind(session, entry.conversationId);
      await options.onSessionBound?.(entry.conversationId, session);
      publish(entry, { type: "session", session });
    },
    onItemDelta: (itemId, text) =>
      observe(
        turns.enqueueProjection(entry, generation, () => {
          publish(entry, { type: "item-delta", itemId, text });
        }),
        `item delta projection requestId=${entry.requestId}`
      ),
    onItem: (item) =>
      observe(
        turns.enqueueProjection(entry, generation, async () => {
          const sanitized = await projectAgentImage({
            entry,
            item,
            options,
            workspaceRoot: context.workspace,
          });
          observeTurnItem(sanitized);
          publish(entry, { type: "item", item: sanitized });
        }),
        `item projection requestId=${entry.requestId}`
      ),
    onApproval: (approval) =>
      ifCurrent(() =>
        publish(entry, { type: "approval-requested", approval })
      ),
    onApprovalClosed: (approvalId) =>
      ifCurrent(() =>
        publish(entry, { type: "approval-closed", approvalId })
      ),
    onUserInput: (request) =>
      ifCurrent(() =>
        publish(entry, { type: "user-input-requested", request })
      ),
    onUserInputClosed: (userInputId) =>
      ifCurrent(() =>
        publish(entry, { type: "user-input-closed", userInputId })
      ),
    onSubagentUpdate: (agent) =>
      ifCurrent(() => {
        entry.draft = applySubagent(entry.draft, agent);
        publish(entry, {
          type: "subagent-update",
          agent,
          detailState: entry.subagents.detailState(agent.agentThreadId),
        });
      }),
    onSubagentItem: (agentThreadId, item) =>
      ifCurrent(() => {
        const agent = entry.subagents.get(agentThreadId);
        if (agent) {
          publish(entry, {
            type: "subagent-item",
            agentThreadId,
            agent,
            item,
          });
        }
      }),
    onSubagentItemDelta: (agentThreadId, itemId, text) =>
      ifCurrent(() => {
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
      }),
    onThirdPartyMcpProtocol: (observation) =>
      ifCurrent(() => options.observeThirdPartyMcpProtocol?.(observation)),
    onPolicyViolation: (violation) =>
      ifCurrent(() =>
        observe(
          finalizeEntry(
            entry,
            {
              type: "error",
              message: `ACP 资源预算违规（${violation.budget}）：${violation.detail}`,
            },
            options,
            generation
          ),
          `policy violation requestId=${entry.requestId}`
        )
      ),
    onTerminal: (terminal) =>
      ifCurrent(() => {
        if (terminal.type === "done") {
          backendRuntimeRegistry.markTurnSuccess(
            backend.id,
            runtimeGeneration
          );
        } else if (terminal.failureKind === "auth-required") {
          backendRuntimeRegistry.markAuthFailure(
            backend.id,
            runtimeGeneration
          );
        }
        observe(
          finalizeEntry(entry, terminal, options, generation),
          `terminal requestId=${entry.requestId}`
        );
      }),
    onProcessError: (failure) =>
      ifCurrent(() => {
        if (failure.kind === "auth-required") {
          backendRuntimeRegistry.markAuthFailure(
            backend.id,
            runtimeGeneration
          );
        }
        observe(
          finalizeEntry(
            entry,
            {
              type: "error",
              message: failure.message,
              failureKind: failure.kind,
              ...(failure.kind === "usage-limit"
                ? { usageLimit: failure.limit }
                : {}),
            },
            options,
            generation
          ),
          `process error requestId=${entry.requestId}`
        );
      }),
  };
}
