/**
 * [INPUT]: Depends on backend runtime snapshots, shared builtin tool specifications, Agent payloads, and turn-origin evidence
 * [OUTPUT]: Provides frozen builtin policy construction, canonical turn projection input, and shared-resolver-backed Project builtin/manual-MCP support views
 * [POS]: Main-window Project Tools runtime adapter; keeps capability projection deterministic and separate from window/service composition
 */

import {
  AGENT_BACKEND_ORDER,
  type AgentBackendId,
  type AgentSendPayload,
} from "../../../shared/agent-ipc";
import type { ManualMcpServerView } from "../../../shared/mcp-servers-ipc";
import {
  projectManualMcpServerSupport,
  resolveBuiltinBackendSupportMatrix,
  type ToolBackendRuntimeFacts,
} from "../../../shared/tool-support";
import { backendRuntimeRegistry } from "../backends";
import type {
  BuiltinTurnToolPolicy,
  TurnOrigin,
  TurnProjectionInput,
} from "../agent/bridge-types";

export function freezeProjectBuiltinPolicy(
  backend: AgentBackendId,
  disabledTools: readonly string[]
): BuiltinTurnToolPolicy {
  return {
    disabledTools: [...disabledTools],
    builtinTools: runtimeBuiltinTools(backend),
    backendRuntimeIdentity: backendRuntimeIdentity(backend),
  };
}

export function projectToolsTurnProjectionInput(
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

export function projectBuiltinBackendSupport(toolId: string) {
  return resolveBuiltinBackendSupportMatrix(toolId, backendSupportFacts());
}

export function projectManualMcpBackendSupport(server: ManualMcpServerView) {
  return projectManualMcpServerSupport(server, backendSupportFacts());
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

function backendSupportFacts(): ToolBackendRuntimeFacts[] {
  return AGENT_BACKEND_ORDER.map((backendId) => {
    const snapshot = backendRuntimeRegistry.current(backendId);
    return {
      backendId,
      runtimeStatus: snapshot?.runtimeStatus ?? "missing",
      runtimeVersion: snapshot && "runtime" in snapshot
        ? snapshot.runtime?.version
        : undefined,
      builtinTools: snapshot?.runtimeStatus === "installed"
        ? snapshot.capabilities.builtinTools
        : "none",
      ...(snapshot?.reason ? { detail: snapshot.reason } : {}),
    };
  });
}
