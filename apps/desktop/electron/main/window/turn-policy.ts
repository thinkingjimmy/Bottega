/**
 * [INPUT]: Depends on backend runtime capability snapshots, builtin tool issuance, AppsService acquisition, and canonical turn Project context
 * [OUTPUT]: Provides frozen builtin policy, turn projection identity, and App acquisition computed from the same capability facts
 * [POS]: Main-window turn-policy projector; Agent context assembly and session handoff remain in main-window.ts
 */

import type { AgentBackendId, AgentSendPayload } from "../../../shared/agent-ipc";
import { baseToolsAvailability } from "../../../shared/builtin-tools";
import type { TurnProjectContext } from "../../../shared/product-resource-scope";
import type {
  BuiltinTurnToolPolicy,
  TurnOrigin,
  TurnProjectionInput,
} from "../agent/bridge-types";
import type { AppsService } from "../apps/apps-service";
import { backendRuntimeRegistry } from "../backends";
import { admittedAmbientTools, builtinToolAccess } from "../tools/issuance";

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
