/**
 * [INPUT]: Depends on TurnRegistry projection lane, runtime registry, MCP-plan-bound session persistence, image projection, MCP/server-fact observation and subagent reducer
 * [OUTPUT]: Provides createTurnCallbacks connecting backend events to ProductFailure-aware projections, atomic session+tool-plan binding, release/health owners and terminal finalization
 * [POS]: The turn event of the agent sub-module is re-routed to the factory; Generating fence In this unified gate, the agent-bridge is solely responsible for starting the sorting process
 */

import type { SessionServiceTierEffective } from "../../../shared/agent-ipc";
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
import {
  agentRuntimeFailure,
  diagnosticFailureDetails,
} from "../../../shared/product-failure";
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
  let boundSession = entry.payload?.session;
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
  const publishServiceTierEffective = (session: typeof boundSession) => {
    if (!session) return;
    const effective = threadScopes.serviceTierEffective(
      session,
      entry.conversationId
    );
    if (effective) {
      publish(entry, { type: "service-tier-effective", effective });
    }
  };
  return {
    onThread: async (session) => {
      if (entry.generation !== generation) return;
      if (!backend.validateSessionId(session.id)) {
        throw new Error(`${backend.displayName} 返回了无效的 sessionId`);
      }
      const plan = entry.thirdPartyMcpPlan;
      const bound = plan
        ? {
            ...session,
            toolPlan: {
              planDigest: plan.planDigest,
              projectId: plan.projectContext.projectId,
            },
          }
        : session;
      threadScopes.bind(bound, entry.conversationId);
      boundSession = bound;
      await options.onSessionBound?.(
        entry.conversationId,
        bound,
        entry.context
      );
      publish(entry, { type: "session", session: bound });
      publishServiceTierEffective(bound);
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
    onItemRemoved: (itemId) =>
      observe(
        turns.enqueueProjection(entry, generation, () => {
          publish(entry, { type: "item-removed", itemId });
        }),
        `item removal projection requestId=${entry.requestId}`
      ),
    onConfigOptionUpdate: (configOptions) =>
      ifCurrent(() => {
        const policy = backend.serviceTier;
        const session = boundSession;
        if (!policy || !session) return;
        const option = configOptions.find(
          (candidate) =>
            candidate.type === "select" &&
            candidate.id === policy.configOptionId
        );
        const productValue = option
          ? Object.entries(policy.values).find(
              ([, wireValue]) => wireValue === option.currentValue
            )?.[0]
          : "default";
        if (!productValue) return;
        /* 只发机器判据：产品文案在 renderer 的五语言目录里，main 拼一句英文
           就等于把这条状态钉死在英文上（同 BackendInfo.reason 的接缝）。 */
        const effective: SessionServiceTierEffective = {
          value: productValue,
          reason: !option
            ? "modelUnsupported"
            : productValue === "default"
              ? "backendOff"
              : "backendOn",
          at: Date.now(),
        };
        threadScopes.setServiceTierEffective(
          session,
          entry.conversationId,
          effective
        );
        publish(entry, { type: "service-tier-effective", effective });
      }),
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
              failure: agentRuntimeFailure(
                "request-rejected",
                diagnosticFailureDetails(
                  `ACP policy ${violation.budget}: ${violation.detail}`
                )
              ),
              ...(violation.facts ? { facts: violation.facts } : {}),
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
              failure: failure.failure,
              ...(failure.kind === "usage-limit"
                ? { usageLimit: failure.limit }
                : {}),
              /* 轮级事实随失败终态一起走：这一轮死了，不等于它没发生过。 */
              ...(failure.facts ? { facts: failure.facts } : {}),
            },
            options,
            generation
          ),
          `process error requestId=${entry.requestId}`
        );
      }),
  };
}
