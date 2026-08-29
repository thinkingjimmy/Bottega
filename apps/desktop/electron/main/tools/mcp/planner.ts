/**
 * [INPUT]: Depends on hydrated frozen manual MCP candidates, canonical TurnProjectContext, turn origin/Plan mode, backend/runtime identity, and the terminal package-MCP deny policy
 * [OUTPUT]: Provides a pure, deeply frozen manual MCP plan plus stable backend/Project/scope/config digest; no live store read is possible
 * [POS]: The final tools/mcp admission seam; relay/headless/Plan/remote/package entries disappear before any backend adapter sees configuration
 */

import { randomUUID } from "node:crypto";
import type { AgentBackendId } from "../../../../shared/agent-ipc";
import type {
  ThirdPartyMcpPlan,
  ThirdPartyMcpPlanEntry,
} from "../../../../shared/mcp-servers-ipc";
import {
  assertUniqueMcpBackendAliases,
  mcpBackendAlias,
} from "../../../../shared/mcp-servers-ipc";
import type { TurnProjectContext } from "../../../../shared/resource-scope";
import type { TurnOrigin } from "../../turn-registry";
import {
  manualSessionPlanDigest,
  supportedManualMcpCandidates,
  type FrozenManualMcpCandidate,
} from "../../sections/coordinator/admission/prepared-project-tools";

export function buildManualMcpPlan(input: Readonly<{
  candidates: readonly FrozenManualMcpCandidate[];
  projectContext: TurnProjectContext;
  backendId: AgentBackendId;
  backendRuntimeIdentity: string;
  planMode: boolean;
  origin?: TurnOrigin;
  packageEntries?: readonly ThirdPartyMcpPlanEntry[];
}>): ThirdPartyMcpPlan {
  if ((input.packageEntries?.length ?? 0) > 0) {
    throw new Error(
      "PACKAGE_EXTENSION_MCP_DISABLED: package MCP entries cannot enter a turn plan"
    );
  }
  const included = input.origin?.kind === "manual" && !input.planMode
    ? supportedManualMcpCandidates({
        candidates: input.candidates,
        backendId: input.backendId,
        backendRuntimeIdentity: input.backendRuntimeIdentity,
      })
    : [];
  const entries = included.map((server): ThirdPartyMcpPlanEntry => {
    if (server.config.transport !== "stdio") {
      throw new Error("MCP planner transport projection failed closed");
    }
    return deepFreeze({
      identity: server.serverId,
      backendAlias: mcpBackendAlias(server.serverId),
      displayName: server.displayName,
      source: { kind: "manual", scope: server.scope },
      transport: "stdio",
      command: server.config.command,
      args: [...server.config.args],
      env: { ...server.config.env },
      configDigest: server.configDigest,
      healthSubject: {
        kind: "manual",
        serverId: server.serverId,
        scope: structuredClone(server.scope),
        configDigest: server.configDigest,
        backend: input.backendId,
        runtimeVersion: input.backendRuntimeIdentity,
        transport: "stdio",
      },
    });
  });
  assertUniqueMcpBackendAliases(entries);
  const planDigest = manualSessionPlanDigest({
    backendId: input.backendId,
    projectContext: input.projectContext,
    planMode: input.planMode || input.origin?.kind !== "manual",
    candidates: input.origin?.kind === "manual" ? input.candidates : [],
    backendRuntimeIdentity: input.backendRuntimeIdentity,
  });
  return deepFreeze({
    planInstanceId: randomUUID(),
    backendId: input.backendId,
    projectContext: structuredClone(input.projectContext),
    entries: deepFreeze(entries),
    planDigest,
  });
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const entry of Object.values(value as Record<string, unknown>)) {
    deepFreeze(entry);
  }
  return value;
}
