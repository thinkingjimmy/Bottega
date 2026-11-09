/**
 * [INPUT]: Uses `node:crypto`, `../../../../shared/ipc/agent/agent-ipc`, `../../../../shared/ipc/settings/mcp-servers-ipc`, `../../../../shared/product/resource-scope`, `../../sections/coordinator/state/readonly-ledger`, `../../agent/turns/turn/turn-registry-model`, `../../sections/coordinator/admission/prepared-project-tools` for its declared types and implementation.
 * [OUTPUT]: Provides buildManualMcpPlan; manual turns or writable development roles get exactly eligible selected servers, while read-only/Plan/relay turns get none.
 * [POS]: Final MCP admission boundary before backend transport; no live store read or secret exposure to the renderer.
 */

import { randomUUID } from "node:crypto";
import type { AgentBackendId } from "../../../../shared/ipc/agent/agent-ipc";
import type {
  ThirdPartyMcpPlan,
  ThirdPartyMcpPlanEntry,
} from "../../../../shared/ipc/settings/mcp-servers-ipc";
import {
  assertUniqueMcpBackendAliases,
  mcpBackendAlias,
} from "../../../../shared/ipc/settings/mcp-servers-ipc";
import type { TurnProjectContext } from "../../../../shared/product/resource-scope";
import { deepFreeze } from "../../sections/coordinator/state/readonly-ledger";
import type { TurnOrigin } from "../../agent/turns/turn/turn-registry-model";

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
  const permitted = !input.planMode && input.origin?.kind === "manual";
  const candidates = input.candidates;
  const included = permitted
    ? supportedManualMcpCandidates({
        candidates,
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
    planMode: !permitted,
    candidates: permitted ? candidates : [],
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
