/**
 * [INPUT]: Depends on explicit Provider subagent-content ownership, TurnRegistry projection lane, runtime registry, MCP-plan-bound session persistence, immutable artifact and image projection, MCP/server-fact observation and subagent reducer
 * [OUTPUT]: Atomically replaces an authorized native fork source, with rollback on failed handoff; persists artifact-projected native child items before publication; projects typed turn outcomes, provider identity and Chat-local availability evidence; only complete success grants operation evidence, without rewriting global probe auth.
 * [POS]: apps/desktop/electron/main/agent/turns/turn; Factory wiring backend turn events into agent-bridge projections behind a single generation fence; agent-bridge itself only starts and routes turns
 */

import { providerTraits } from "../../../../../shared/providers/traits";
import { recordWorkflowCommandExit } from "../../../workflows/turn-policy";
import { artifactRuntime } from "../../../artifacts/core/runtime";
import type { SessionServiceTierEffective } from "../../../../../shared/ipc/agent/agent-ipc";
import { applySubagent } from "../../../../../shared/chats/model/chat-turn-reducer";
import { backendRuntimeRegistry } from "../../../backends";
import type { AgentTurnCallbacks, ProviderBackend } from "../../../backends/contracts/types";
import { projectAgentImage } from "../../../gallery/agent-image-projection";
import type { ThreadScopeRegistry } from "../thread/thread-scope";
import type { TurnRegistry } from "./turn-registry";
import type { SourceTerminal } from "./turn-registry-model";
import type { AgentTurn } from "../../../backends/contracts/types";
import {
  agentRuntimeFailure,
  diagnosticFailureDetails,
} from "../../../../../shared/product/product-failure";
import type {
  AgentBridgeOptions,
  AgentContext,
  AgentEventPayload,
  BridgeEntry,
} from "../../bridge/bridge-types";

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
  trustedAuthority?: import("../../../backends/contracts/types").TrustedTurnAuthority;
  entry: BridgeEntry;
  generation: number;
  backend: ProviderBackend;
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
  const storesSubagentContent = providerTraits(entry.backend).subagentContentOwner === "callbacks";
  entry.artifacts ??= artifactRuntime()?.begin(entry, context);
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
  const recordServiceTier = (value: string, unsupported = false) => {
    if (!boundSession) return;
    const effective: SessionServiceTierEffective = { value,
      reason: unsupported ? "modelUnsupported" : value === "default" ? "backendOff" : "backendOn", at: Date.now() };
    threadScopes.setServiceTierEffective(boundSession, entry.conversationId, effective);
    publish(entry, { type: "service-tier-effective", effective });
  };
  return {
    onServiceTierUpdate: value => ifCurrent(() => {
      if (value !== null && (typeof value !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(value))) return;
      recordServiceTier(value ?? "default");
    }),
    onThread: async (session, previous) => {
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
      input.trustedAuthority?.current();
      await options.assertTurnAdmission?.(entry.payload!, input.trustedAuthority);
      threadScopes.bind(bound, entry.conversationId);
      boundSession = bound;
      await entry.artifacts?.bindSession(bound.id);
      if (previous) {
        if (!options.replaceSession || entry.payload?.session?.backend !== previous.backend || entry.payload.session.id !== previous.id) throw new Error("Fork source session is stale");
        await options.replaceSession(entry.conversationId, previous, bound);
        try { await options.onSessionBound?.(entry.conversationId, bound, entry.context); }
        catch (cause) {
          await options.replaceSession(entry.conversationId, bound, previous);
          threadScopes.releaseSession(bound, entry.conversationId);
          throw cause;
        }
        threadScopes.releaseSession(previous, entry.conversationId);
      } else await options.onSessionBound?.(entry.conversationId, bound, entry.context);
      publish(entry, { type: "session", session: bound });
      publishServiceTierEffective(bound);
    },
    onItemDelta: (itemId, text) =>
      observe(
        turns.enqueueProjection(entry, generation, async () => {
          const events = entry.artifacts ? await entry.artifacts.projection.delta(itemId, text) : [{ type: "item-delta" as const, itemId, text }];
          for (const event of events) publish(entry, event);
        }),
        `item delta projection requestId=${entry.requestId}`
      ),
    onItem: (item, metadata) =>
      observe(
        turns.enqueueProjection(entry, generation, async () => {
          const sanitized = await projectAgentImage({
            entry,
            item: entry.artifacts ? await entry.artifacts.projection.item(item, metadata) : item,
            options,
            workspaceRoot: context.workspace,
          });
          observeTurnItem(sanitized);
          if (metadata?.exitCode !== undefined) recordWorkflowCommandExit(entry.requestId, item.itemId, metadata.exitCode);
          publish(entry, { type: "item", item: sanitized });
        }),
        `item projection requestId=${entry.requestId}`
      ),
    onItemRemoved: (itemId) =>
      observe(
        turns.enqueueProjection(entry, generation, async () => {
          await entry.artifacts?.projection.remove(itemId);
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
        recordServiceTier(productValue, !option);
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
    onSubagentItem: (agentThreadId, item) => observe(turns.enqueueProjection(entry, generation, async () => {
      const agent = entry.subagents.get(agentThreadId);
      if (agent) {
        const projected = await entry.artifacts?.child(agentThreadId).item(item) ?? item;
        if (storesSubagentContent) entry.subagents.applyItem(agentThreadId, projected);
        publish(entry, { type: "subagent-item", agentThreadId, agent, item: projected });
      }
    }), "project-subagent-artifact"),
    onSubagentItemDelta: (agentThreadId, itemId, text) => observe(turns.enqueueProjection(entry, generation, async () => {
      const agent = entry.subagents.get(agentThreadId); if (!agent) return;
      const events = await entry.artifacts?.child(agentThreadId).delta(itemId, text) ?? [{ type: "item-delta" as const, itemId, text }];
      for (const event of events) {
        if (event.type === "item") {
          if (storesSubagentContent) entry.subagents.applyItem(agentThreadId, event.item);
          publish(entry, { type: "subagent-item", agentThreadId, agent, item: event.item });
        } else {
          if (storesSubagentContent) entry.subagents.applyDelta(agentThreadId, event.itemId, event.text);
          publish(entry, { type: "subagent-item-delta", agentThreadId, agent, itemId: event.itemId, text: event.text });
        }
      }
    }), "project-subagent-artifact-delta"),
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
            runtimeGeneration,
            context.availabilityStart
          );
        } else if (terminal.failureKind === "auth-required") {
          backendRuntimeRegistry.markAuthFailure(
            backend.id,
            runtimeGeneration,
            context.availabilityStart
          );
        }
        if (context.availabilityStart && terminal.failure?.code === "connection-lost") backendRuntimeRegistry.recordTurn(context.availabilityStart, "connection");
        if (context.availabilityStart && terminal.failure?.code === "service-unavailable") backendRuntimeRegistry.recordTurn(context.availabilityStart, "service");
        if (terminal.type === "cancelled") backendRuntimeRegistry.evidence.discardRetry(entry.requestId);
        if (terminal.failureKind === "usage-limit" && context.availabilityStart) backendRuntimeRegistry.recordTurn(context.availabilityStart, "usage-limit", terminal.usageLimit);
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
            runtimeGeneration,
            context.availabilityStart ? { ...context.availabilityStart, target: { ...context.availabilityStart.target, ...(failure.target?.providerId ? { providerId: failure.target.providerId } : {}) } } : undefined
          );
        }
        const failureStart = context.availabilityStart ? { ...context.availabilityStart,
          target: { ...context.availabilityStart.target, ...(failure.target?.providerId ? { providerId: failure.target.providerId } : {}) } } : undefined;
        if (failureStart && failure.failure?.code === "connection-lost") backendRuntimeRegistry.recordTurn(failureStart, "connection");
        if (failureStart && failure.failure?.code === "service-unavailable") backendRuntimeRegistry.recordTurn(failureStart, "service");
        if (failure.kind === "usage-limit" && failureStart) backendRuntimeRegistry.recordTurn(failureStart, "usage-limit", failure.limit);
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
