/**
 * [INPUT]: Depends on ManualMcpServersStore, turn origin/planMode, backend/runtime identity and package resolved entries
 * [OUTPUT]: Provides build ManualMcpPlan: manual Non-Plan enabled stdio-only deep freeze snapshots, reversible alias and health subject
 * [POS]: The inclusion policy of tools/mcp; relay/headless/remote is deleted before the backend sees the configuration
 */

import { createHash, randomUUID } from "node:crypto";
import type { AgentBackendId } from "../../../../shared/agent-ipc";
import type {
  ThirdPartyMcpPlan,
  ThirdPartyMcpPlanEntry,
} from "../../../../shared/mcp-servers-ipc";
import {
  assertUniqueMcpBackendAliases,
  mcpBackendAlias,
} from "../../../../shared/mcp-servers-ipc";
import type { TurnOrigin } from "../../turn-registry";
import type { ManualMcpServersStore } from "./store";

export function buildManualMcpPlan(input: {
  store: ManualMcpServersStore;
  backendId: AgentBackendId;
  backendRuntimeIdentity: string;
  planMode: boolean;
  origin?: TurnOrigin;
  packageEntries?: readonly ThirdPartyMcpPlanEntry[];
}): ThirdPartyMcpPlan {
  const included =
    input.origin?.kind === "manual" && !input.planMode
      ? input.store
          .resolved()
          .filter(
            (server) =>
              server.enabled &&
              server.eligibility === "eligible" &&
              server.config.transport === "stdio"
          )
      : [];
  const manualEntries = included.map((server): ThirdPartyMcpPlanEntry => {
    if (server.config.transport !== "stdio") {
      throw new Error("MCP planner 内部 transport 收窄失效");
    }
    return deepFreeze({
      identity: server.serverId,
      backendAlias: mcpBackendAlias(server.serverId),
      displayName: server.displayName,
      source: { kind: "manual" },
      transport: "stdio",
      command: server.config.command,
      args: [...server.config.args],
      env: { ...server.config.env },
      configDigest: server.configDigest,
      healthSubject: {
        kind: "manual",
        serverId: server.serverId,
        configDigest: server.configDigest,
        backend: input.backendId,
        runtimeVersion: input.backendRuntimeIdentity,
        transport: "stdio",
      },
    });
  });
  const entries = input.origin?.kind === "manual" && !input.planMode
    ? [...manualEntries, ...(input.packageEntries ?? []).map((entry) => deepFreeze(structuredClone(entry)))]
    : [];
  assertUniqueMcpBackendAliases(entries);
  const planBase = {
    planInstanceId: randomUUID(),
    backendId: input.backendId,
    entries: deepFreeze(entries),
  };
  return deepFreeze({
    ...planBase,
    /* digest 只含 identity/config digest，不复制 resolved secret。 */
    planDigest: createHash("sha256")
      .update(
        JSON.stringify({
          backendId: input.backendId,
          entries: entries.map((entry) => ({
            identity: entry.identity,
            configDigest: entry.configDigest,
          })),
        })
      )
      .digest("hex"),
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
