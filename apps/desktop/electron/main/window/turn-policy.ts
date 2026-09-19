/**
 * [INPUT]: Depends on backend runtime capability snapshots, builtin tool issuance, AppsService acquisition, and canonical turn Project context
 * [OUTPUT]: Provides frozen builtin policy, turn projection identity, App acquisition computed from the same capability facts, and the per-turn built-in MCP issuer
 * [POS]: Main-window turn-policy projector; Agent context assembly and session handoff remain in main-window.ts
 */

import type { AgentBackendId, AgentSendPayload } from "../../../shared/agent-ipc";
import { baseToolsAvailability } from "../../../shared/builtin-tools";
import type { TurnProjectContext } from "../../../shared/product-resource-scope";
import type {
  AgentBridgeOptions,
  BuiltinTurnToolPolicy,
  TurnOrigin,
  TurnProjectionInput,
} from "../agent/bridge-types";
import type { AppsService } from "../apps/apps-service";
import { backendRuntimeRegistry } from "../backends";
import { admittedAmbientTools, builtinToolAccess } from "../tools/issuance";
import {
  initiatorResultByteBudget,
  type BuiltinMcpLeaseStore,
} from "../tools/lease";

export function freezeBuiltinPolicy(
  backend: AgentBackendId,
  disabledTools: readonly string[]
): BuiltinTurnToolPolicy {
  return {
    disabledTools: [...disabledTools],
    builtinTools: runtimeBuiltinTools(backend),
    backendRuntimeIdentity: backendRuntimeIdentity(backend),
  };
}

export function turnProjectionInput(
  conversationId: string,
  payload: AgentSendPayload,
  origin: TurnOrigin | undefined
): TurnProjectionInput {
  return {
    conversationId,
    handoff: payload.handoff, freshSession: !payload.session,
    requestId: payload.requestId,
    backendId: payload.turnOptions.backend,
    origin,
    planMode: Boolean(payload.planMode),
  };
}

export function acquireTurnAppsForPolicy(
  apps: AppsService,
  acquisition: TurnProjectionInput,
  policy: BuiltinTurnToolPolicy,
  projectContext: TurnProjectContext
) {
  const issuance = {
    builtinTools: policy.builtinTools,
    backend: acquisition.backendId,
    planMode: acquisition.planMode,
    projectContext,
    origin: acquisition.origin,
    disabledTools: policy.disabledTools,
  };
  return apps.acquireTurnApps({
    conversationId: acquisition.conversationId,
    requestId: acquisition.requestId,
    backendId: acquisition.backendId,
    backendRuntimeIdentity: policy.backendRuntimeIdentity,
    turnClass: acquisition.origin?.kind ?? "headless",
    planMode: acquisition.planMode,
    projectContext,
    toolAccess: builtinToolAccess(issuance),
    baseToolsAvailability: baseToolsAvailability(admittedAmbientTools(issuance)),
  });
}

function runtimeBuiltinTools(backend: AgentBackendId) {
  const snapshot = backendRuntimeRegistry.current(backend);
  return snapshot?.runtimeStatus === "installed"
    ? snapshot.capabilities.builtinTools
    : ("none" as const);
}

function backendRuntimeIdentity(backend: AgentBackendId) {
  const snapshot = backendRuntimeRegistry.current(backend);
  return snapshot?.runtimeStatus === "installed"
    ? `${backend}@${snapshot.runtime.version}`
    : `${backend}@unknown`;
}

/**
 * 逐轮内置 MCP lease 的签发。allowedTools 为空即不签发——没有工具的 turn
 * 不该有一个能被认证的 token。
 *
 * 它与连接级签发（`tools/lease.ts` 的 `issueForConnection`）是同一份广告面
 * 的两个入口：冷路径逐轮签，借来的连接一生签一次、逐轮 rebind。
 */
export function chatBuiltinMcpIssuer(ports: {
  builtinLeases: BuiltinMcpLeaseStore;
  incarnationOf(conversationId: string): string | undefined;
}): NonNullable<AgentBridgeOptions["issueBuiltinMcp"]> {
  return (payload, generation, _origin, context) => {
    const allowedTools = context.finalTurnProjection?.allowedTools ?? [];
    if (!allowedTools.length) return undefined;
    const incarnationId = ports.incarnationOf(payload.scope.conversationId);
    if (!incarnationId) {
      throw new Error("聊天不存在，无法签发内置工具 lease");
    }
    return ports.builtinLeases.issue({
      chatId: payload.scope.conversationId,
      incarnationId,
      requestId: payload.requestId,
      generation,
      allowedTools: [...allowedTools],
      initiatorBackend: payload.turnOptions.backend,
      resultByteBudget: initiatorResultByteBudget(payload.turnOptions.backend),
      skillsCustodyId: context.skillsCustodyId,
      historyBinding: payload.handoff?.binding,
    });
  };
}
