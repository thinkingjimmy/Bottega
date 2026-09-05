/**
 * [INPUT]: Depends on backend runtime snapshots and shared builtin/manual-MCP support contracts
 * [OUTPUT]: Provides shared-resolver-backed Project builtin/manual-MCP support views
 * [POS]: Main-window Project Tools runtime adapter; keeps capability projection deterministic and separate from window/service composition
 */

import { AGENT_BACKEND_ORDER } from "../../../shared/agent-ipc";
import type { ManualMcpServerView } from "../../../shared/mcp-servers-ipc";
import {
  projectManualMcpServerSupport,
  resolveBuiltinBackendSupportMatrix,
  type ToolBackendRuntimeFacts,
} from "../../../shared/tool-support";
import { backendRuntimeRegistry } from "../backends";
export function projectBuiltinBackendSupport(toolId: string) {
  return resolveBuiltinBackendSupportMatrix(toolId, backendSupportFacts());
}

export function projectManualMcpBackendSupport(server: ManualMcpServerView) {
  return projectManualMcpServerSupport(server, backendSupportFacts());
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
