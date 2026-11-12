/**
 * [INPUT]: Depends on window.mcpServers, the global masked MCP contract, and the snapshot controller
 * [OUTPUT]: Provides createMcpServersController with monotonic snapshots, change subscriptions, and serialized revision-fenced mutations
 * [POS]: Renderer client for global manual MCP settings
 */

import type {
  ManualMcpServerDraft,
  ManualMcpServerView,
  McpServersBridgeApi,
  McpServersSnapshot,
} from "../../../shared/ipc/settings/mcp-servers-ipc";
import { MCP_SERVERS_BRIDGE_UNAVAILABLE } from "../../../shared/ipc/settings/mcp-servers-ipc";
import { createSnapshotController } from "../snapshot-controller";

declare global {
  interface Window {
    mcpServers?: McpServersBridgeApi;
  }
}

const scope = { kind: "global" } as const;

function bridge() {
  if (!window.mcpServers) throw new Error(MCP_SERVERS_BRIDGE_UNAVAILABLE);
  return window.mcpServers;
}

const fence = (snapshot: McpServersSnapshot) => ({
  scope,
  expectedScopeRevision: snapshot.globalScopeRevision,
  expectedProjectLifecycleRevision: null,
});

export function createMcpServersController() {
  const core = createSnapshotController<McpServersSnapshot>({
    bridgeAvailable: Boolean(window.mcpServers),
    bridgeUnavailableError: MCP_SERVERS_BRIDGE_UNAVAILABLE,
    fetch: () => bridge().list({ scope }),
    accepts: (value, current) => !current || (
      value.storeRevision >= current.storeRevision &&
      value.globalScopeRevision >= current.globalScopeRevision
    ),
    watch: (reload) => window.mcpServers?.onChanged(reload) ?? (() => {}),
  });

  return {
    subscribe: core.subscribe,
    getSnapshot: core.getSnapshot,
    load: core.load,
    save: (draft: ManualMcpServerDraft, server?: ManualMcpServerView) =>
      core.mutate(`server:${server?.serverId ?? "new"}`, (current) =>
        bridge().save({
          ...fence(current),
          ...(server ? { serverId: server.serverId } : {}),
          draft,
        })
      ),
    remove: (server: ManualMcpServerView) =>
      core.mutate(`server:${server.serverId}`, (current) =>
        bridge().remove({ ...fence(current), serverId: server.serverId })
      ),
  };
}
