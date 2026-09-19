/**
 * [INPUT]: Depends on preload-exposed window.mcpServers, the shared exact-scope masked MCP DTO, and lib/snapshot-controller
 * [OUTPUT]: Provides createMcpServersController — a subscription-scoped, revision-monotonic, CAS-serialized controller for one global or exact-Project manual MCP projection
 * [POS]: Sole renderer authority for manual MCP; it supplies scope matching, the CAS fence and save/remove commands on top of the shared snapshot-controller core, never invents a writable browser store and never exposes secret text
 */

import type {
  ManualMcpServerDraft,
  ManualMcpServerView,
  McpServersChangedEvent,
  McpServersBridgeApi,
  McpServersSnapshot,
} from "../../shared/mcp-servers-ipc";
import { MCP_SERVERS_BRIDGE_UNAVAILABLE } from "../../shared/mcp-servers-ipc";
import type { ProductResourceScope } from "../../shared/resource-scope";
import { createSnapshotController } from "./snapshot-controller";

declare global {
  interface Window {
    mcpServers?: McpServersBridgeApi;
  }
}

function bridge() {
  if (!window.mcpServers) throw new Error(MCP_SERVERS_BRIDGE_UNAVAILABLE);
  return window.mcpServers;
}

const sameScope = (left: ProductResourceScope, right: ProductResourceScope) =>
  left.kind === right.kind &&
  (left.kind === "global" ||
    (right.kind === "project" && left.projectId === right.projectId));

const isAuthoritative = (
  scope: ProductResourceScope,
  value: McpServersSnapshot,
  current: McpServersSnapshot | null
) => {
  if (!current) return true;
  if (
    value.storeRevision < current.storeRevision ||
    value.globalScopeRevision < current.globalScopeRevision
  ) return false;
  if (scope.kind === "global") return true;
  const nextLifecycle = value.projectLifecycleRevision;
  const currentLifecycle = current.projectLifecycleRevision;
  if (nextLifecycle === null || currentLifecycle === null) return false;
  if (nextLifecycle !== currentLifecycle) return nextLifecycle > currentLifecycle;
  return value.projectScopeRevision !== null &&
    current.projectScopeRevision !== null &&
    value.projectScopeRevision >= current.projectScopeRevision;
};

const fence = (scope: ProductResourceScope, value: McpServersSnapshot) => {
  if (scope.kind === "global") {
    return {
      scope,
      expectedScopeRevision: value.globalScopeRevision,
      expectedProjectLifecycleRevision: null,
    } as const;
  }
  if (
    value.projectScopeRevision === null ||
    value.projectLifecycleRevision === null
  ) {
    throw new Error("PROJECT_MCP_SNAPSHOT_FENCE_MISSING");
  }
  return {
    scope,
    expectedScopeRevision: value.projectScopeRevision,
    expectedProjectLifecycleRevision: value.projectLifecycleRevision,
  } as const;
};

export function createMcpServersController(scope: ProductResourceScope) {
  const affectsQuery = (event: McpServersChangedEvent) =>
    event.version.scope.kind === "global" ||
    (scope.kind === "project" &&
      event.version.scope.kind === "project" &&
      event.version.scope.projectId === scope.projectId);
  const core = createSnapshotController<McpServersSnapshot>({
    bridgeAvailable: Boolean(window.mcpServers),
    bridgeUnavailableError: MCP_SERVERS_BRIDGE_UNAVAILABLE,
    fetch: () => bridge().list({ scope }),
    accepts: (value, current) =>
      sameScope(value.queryScope, scope) && isAuthoritative(scope, value, current),
    watch: (reload) =>
      window.mcpServers?.onChanged((event) => {
        if (affectsQuery(event)) reload();
      }) ?? (() => {}),
  });

  return {
    scope,
    subscribe: core.subscribe,
    getSnapshot: core.getSnapshot,
    load: core.load,
    save: (draft: ManualMcpServerDraft, server?: ManualMcpServerView) =>
      core.mutate(`server:${server?.serverId ?? "new"}`, (current) =>
        bridge().save({
          ...fence(scope, current),
          ...(server ? { serverId: server.serverId } : {}),
          draft,
        })
      ),
    remove: (server: ManualMcpServerView) =>
      core.mutate(`server:${server.serverId}`, (current) =>
        bridge().remove({ ...fence(scope, current), serverId: server.serverId })
      ),
  };
}
