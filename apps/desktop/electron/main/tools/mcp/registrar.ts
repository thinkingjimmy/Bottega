/**
 * [INPUT]: Depends on BrowserWindow, rendererIpc, scoped MCP contracts/store, canonical Project lifecycle authority, Project policy pruning, and runtime support/health projection
 * [OUTPUT]: Provides exact-scope mcp-servers IPC with main-role residence, lifecycle+scope dual CAS, owner checks, runtime-effective views, narrow events, and global-delete override pruning
 * [POS]: Authoritative renderer boundary for manual MCP; Project mutations hold the lifecycle gate while the secret store commits
 */

import type { BrowserWindow } from "electron";
import {
  MCP_SERVERS_CHANNEL,
  type ManualMcpServerView,
  type McpServersChangedEvent,
  type McpServersQuery,
  type McpServersSnapshot,
  type RemoveManualMcpServerInput,
  type SaveManualMcpServerInput,
} from "../../../../shared/mcp-servers-ipc";
import type { ProductResourceScope } from "../../../../shared/resource-scope";
import { rendererIpc } from "../../ipc-registrar";
import type { ProjectStore } from "../../projects/store/project-store";
import type { ProjectToolPolicyStore } from "../project/store";
import type { ManualMcpServersStore } from "./store";

type ManualViewProjection = (
  servers: readonly ManualMcpServerView[]
) => readonly ManualMcpServerView[];

export type ManualMcpRegistrarAuthority = Readonly<{
  projects: ProjectStore;
  policies: ProjectToolPolicyStore;
}>;

export function registerManualMcpServers(
  window: BrowserWindow,
  rendererUrl: string,
  store: ManualMcpServersStore,
  manualViewProjection: ManualViewProjection = (servers) => servers,
  authority?: ManualMcpRegistrarAuthority
) {
  const lifecycleFor = (scope: ProductResourceScope) => {
    if (scope.kind === "global") return null;
    if (!authority) throw storeError("project-not-found", "Project MCP authority 尚未初始化");
    return authority.projects.turnContext(scope.projectId).projectLifecycleRevision;
  };
  const project = (scope: ProductResourceScope): McpServersSnapshot => {
    const lifecycleRevision = lifecycleFor(scope);
    const snapshot = store.project(scope, lifecycleRevision);
    const policy = scope.kind === "project"
      ? authority!.policies.project(scope.projectId).policy
      : null;
    const servers = snapshot.servers.map((server) => {
      if (scope.kind !== "project" || server.owner.kind !== "global") return server;
      const override = policy?.globalMcpOverrides[server.serverId] ?? null;
      if (!override) return server;
      const enabled = override === "enabled";
      return {
        ...server,
        enabled,
        override,
        effectiveSource: "project-override" as const,
        effectiveState: server.eligibility !== "eligible"
          ? "unavailable" as const
          : enabled ? "enabled" as const : "disabled" as const,
      };
    });
    return { ...snapshot, servers: manualViewProjection(servers) };
  };

  const publish = (event?: McpServersChangedEvent) => {
    if (window.isDestroyed()) return;
    const next = event ?? {
      version: {
        scope: { kind: "global" as const },
        projectLifecycleRevision: null,
        scopeRevision: store.scopeRevision({ kind: "global" }),
      },
      storeRevision: store.project().storeRevision,
    };
    if (next.version.scope.kind === "project") {
      const current = authority?.projects.get(next.version.scope.projectId);
      if (!current || authority?.projects.isDeleting(next.version.scope.projectId)) return;
      window.webContents.send(MCP_SERVERS_CHANNEL.changed, {
        ...next,
        version: {
          ...next.version,
          projectLifecycleRevision: current.projectLifecycleRevision,
        },
      });
      return;
    }
    window.webContents.send(MCP_SERVERS_CHANNEL.changed, next);
  };
  const stop = store.onChanged(publish);
  window.once("closed", stop);

  const mutate = <T>(
    input: SaveManualMcpServerInput | RemoveManualMcpServerInput,
    operation: () => Promise<T>
  ) => {
    if (input.scope.kind === "global") {
      if (input.expectedProjectLifecycleRevision !== null) {
        throw storeError("project-lifecycle-conflict", "global MCP mutation 不接受 Project lifecycle");
      }
      return operation();
    }
    if (!authority) throw storeError("project-not-found", "Project MCP authority 尚未初始化");
    return authority.projects.runWithLifecycle(
      input.scope.projectId,
      input.expectedProjectLifecycleRevision!,
      operation
    );
  };

  rendererIpc(window, rendererUrl, "拒绝非主窗口的 MCP server 请求")
    .roles("main")
    .handle(MCP_SERVERS_CHANNEL.list, (raw) => {
      const input = raw as McpServersQuery | undefined;
      return project(input?.scope ?? { kind: "global" });
    })
    .handle(MCP_SERVERS_CHANNEL.save, async (raw) => {
      const input = raw as SaveManualMcpServerInput;
      await mutate(input, () => store.save(input));
      return project(input.scope);
    })
    .handle(MCP_SERVERS_CHANNEL.remove, async (raw) => {
      const input = raw as RemoveManualMcpServerInput;
      await mutate(input, async () => {
        await store.remove(input);
        if (input.scope.kind === "global") {
          await authority?.policies.pruneGlobalMcpServer(input.serverId);
        }
      });
      return project(input.scope);
    });
  return publish;
}

function storeError(code: string, message: string) {
  return Object.assign(new Error(message), { code, status: 409 });
}
