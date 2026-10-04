/**
 * [INPUT]: Depends on backend runtime capability snapshots, builtin tool issuance, AppsService acquisition, and canonical turn Project context
 * [OUTPUT]: Provides frozen builtin policy (any Chat Agent; a package Provider's tools are none and it is never issued a built-in lease), turn projection identity, App acquisition computed from the same capability facts, and the per-turn built-in MCP issuer
 * [POS]: apps/desktop/electron/main/window/agent; Main-window turn-policy projector; Agent context assembly and session handoff remain in main-window.ts
 */

import type { AgentSendPayload } from "../../../../shared/ipc/agent/agent-ipc";
import { freezePreviewFence } from "../../preview/process/fence";
import { previewFeature } from "../../preview/session/runtime";
import type { ProviderId } from "@ai-chat/cloud-protocol/contracts/provider";
import { builtinAgent } from "../../../../shared/chat-agent/options";
import { baseToolsAvailability } from "../../../../shared/builtin-tools";
import type { TurnProjectContext } from "../../../../shared/product/product-resource-scope";
import type {
  AgentBridgeOptions,
  BuiltinTurnToolPolicy,
  TurnOrigin,
  TurnProjectionInput,
} from "../../agent/bridge/bridge-types";
import type { AppsService } from "../../apps/apps-service";
import { backendRuntimeRegistry } from "../../backends";
import { admittedAmbientTools, builtinToolAccess } from "../../tools/issuance";
import { workflowCappedBuiltinTools, workflowTurnPolicyFor } from "../../workflows/turn-policy";
import {
  initiatorResultByteBudget,
  type BuiltinMcpLeaseStore,
} from "../../tools/lease";

export function freezeBuiltinPolicy(
  backend: ProviderId,
  disabledTools: readonly string[],
  requestId?: string
): BuiltinTurnToolPolicy {
  return {
    disabledTools: [...disabledTools],
    /* A workflow planning or review turn is capped at read built-ins; every workflow turn is owed its report tool. */
    builtinTools: workflowCappedBuiltinTools(runtimeBuiltinTools(backend), requestId),
    backendRuntimeIdentity: backendRuntimeIdentity(backend),
    ...(workflowTurnPolicyFor(requestId) ? { workflowStep: true as const } : {}),
  };
}

export function turnProjectionInput(
  conversationId: string,
  payload: AgentSendPayload,
  origin: TurnOrigin | undefined,
  /** The turn's built-in: a package Provider's turn has no projection (no Skills, App tools or built-in tools). */
  backendId: import("../../../../shared/ipc/agent/agent-ipc").AgentBackendId
): TurnProjectionInput {
  return {
    conversationId,
    handoff: payload.handoff, freshSession: !payload.session,
    requestId: payload.requestId,
    backendId,
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

function runtimeBuiltinTools(backend: ProviderId) {
  const snapshot = backendRuntimeRegistry.current(backend);
  return snapshot?.runtimeStatus === "installed"
    ? snapshot.capabilities.builtinTools
    : ("none" as const);
}

function backendRuntimeIdentity(backend: ProviderId) {
  const snapshot = backendRuntimeRegistry.current(backend);
  return snapshot?.runtimeStatus === "installed"
    ? `${backend}@${snapshot.runtime.version}`
    : `${backend}@unknown`;
}

/**
 * 逐轮内置 MCP lease 的签发。allowedTools 为空即不签发——没有工具的 turn
 * 不该有一个能被认证的 token。
 */
export function chatBuiltinMcpIssuer(ports: {
  builtinLeases: BuiltinMcpLeaseStore;
  incarnationOf(conversationId: string): string | undefined;
}): NonNullable<AgentBridgeOptions["issueBuiltinMcp"]> {
  return (payload, generation, _origin, context) => {
    const allowedTools = context.finalTurnProjection?.allowedTools ?? [];
    /* A package Provider's turn declares no built-in tools (d4b follow-up slice 2): it is never issued a lease. */
    const initiator = builtinAgent(payload.turnOptions.backend);
    if (!allowedTools.length || !initiator) return undefined;
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
      initiatorBackend: initiator,
      resultByteBudget: initiatorResultByteBudget(initiator),
      skillsCustodyId: context.skillsCustodyId,
      historyBinding: payload.handoff?.binding,
      previewFence: previewFeature()?.services.bindAuthority(payload.scope.conversationId, incarnationId,
        freezePreviewFence(context.filesystemAccess, payload.turnOptions.permissionMode, !!payload.planMode)),
    });
  };
}
