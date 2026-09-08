/**
 * [INPUT]: Depends on the backend runtime registry
 * [OUTPUT]: Applies shared runtime/availability admission to Section execution while preserving Project, model and capability checks.
 * [POS]: Shared backend-readiness guard for sections/coordinator admission; callers check this once instead of duplicating runtime-status logic
 */

import type { AgentBackendId } from "../../../shared/agent-ipc";
import { assertAgentAvailable } from "../agent/runtime-gate";
import { backendById, backendRuntimeRegistry } from "../backends";

export async function assertSectionBackendReady(agent: AgentBackendId) {
  const descriptor = backendById(agent);
  const snapshot = await backendRuntimeRegistry.resolve(agent);
  assertAgentAvailable(snapshot, descriptor.displayName);
  if (
    snapshot.runtimeStatus !== "installed" ||
    snapshot.capabilities.builtinTools === "none"
  ) {
    throw new Error(`${descriptor.displayName} 当前不可用于 Section 工具`);
  }
}
