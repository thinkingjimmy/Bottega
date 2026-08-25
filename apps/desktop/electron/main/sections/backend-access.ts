/**
 * [INPUT]: Depends on the backend runtime registry
 * [OUTPUT]: Provides Section tool mutation Backend readiness in previous runtime
 * [POS]: Sections with single backends to avoid repeated static/dynamic capability within the coordinator
 */

import type { AgentBackendId } from "../../../shared/agent-ipc";
import { backendById, backendRuntimeRegistry } from "../backends";

export async function assertSectionBackendReady(agent: AgentBackendId) {
  const descriptor = backendById(agent);
  const snapshot = await backendRuntimeRegistry.resolve(agent);
  if (
    snapshot.runtimeStatus !== "installed" ||
    snapshot.capabilities.builtinTools === "none"
  ) {
    throw new Error(`${descriptor.displayName} 当前不可用于 Section 工具`);
  }
}
