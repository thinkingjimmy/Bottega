/**
 * [INPUT]: Depends on preload-exposed window.mcpServers and the shared exact-scope masked MCP DTO
 * [OUTPUT]: Provides scoped bridge wrappers plus a lifecycle-aware, revision-monotonic, CAS-serialized McpServersController
 * [POS]: Sole renderer authority for one global or exact-Project manual MCP projection; it never invents a writable browser store or exposes secret text
 */

import type {
  ManualMcpServerDraft,
  ManualMcpServerView,
  McpServersChangedEvent,
  McpServersQuery,
  McpServersBridgeApi,
  McpServersSnapshot,
  RemoveManualMcpServerInput,
  SaveManualMcpServerInput,
} from "../../shared/mcp-servers-ipc";
import { MCP_SERVERS_BRIDGE_UNAVAILABLE } from "../../shared/mcp-servers-ipc";
import type { ProductResourceScope } from "../../shared/resource-scope";
import { errorMessage } from "./errors";

declare global {
  interface Window {
    mcpServers?: McpServersBridgeApi;
  }
}

export const hasMcpServersBridge = () => Boolean(window.mcpServers);

function bridge() {
  if (!window.mcpServers) throw new Error(MCP_SERVERS_BRIDGE_UNAVAILABLE);
  return window.mcpServers;
}

export const listManualMcpServers = (input: McpServersQuery) =>
  bridge().list(input);
export const saveManualMcpServer = (input: SaveManualMcpServerInput) =>
  bridge().save(input);
export const removeManualMcpServer = (input: RemoveManualMcpServerInput) =>
  bridge().remove(input);
export const onManualMcpServersChanged = (
  listener: Parameters<McpServersBridgeApi["onChanged"]>[0]
) => window.mcpServers?.onChanged(listener) ?? (() => {});

export type McpServersControllerSnapshot = Readonly<{
  value: McpServersSnapshot | null;
  loading: boolean;
  error: string;
  pending: ReadonlySet<string>;
  bridgeAvailable: boolean;
}>;

export type McpServersController = ReturnType<
  typeof createMcpServersController
>;

export function createMcpServersController(scope: ProductResourceScope) {
  const listeners = new Set<() => void>();
  let disposed = false;
  let requestSequence = 0;
  let mutationTail = Promise.resolve();
  let snapshot: McpServersControllerSnapshot = {
    value: null,
    loading: false,
    error: "",
    pending: new Set(),
    bridgeAvailable: hasMcpServersBridge(),
  };

  const sameScope = (left: ProductResourceScope, right: ProductResourceScope) =>
    left.kind === right.kind &&
    (left.kind === "global" ||
      (right.kind === "project" && left.projectId === right.projectId));
  const publish = (next: McpServersControllerSnapshot) => {
    if (disposed || next === snapshot) return;
    snapshot = next;
    for (const listener of listeners) listener();
  };
  const isAuthoritative = (value: McpServersSnapshot) => {
    const current = snapshot.value;
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
  const adopt = (value: McpServersSnapshot) => {
    if (!sameScope(value.queryScope, scope) || !isAuthoritative(value)) return;
    publish({ ...snapshot, value, loading: false, error: "" });
  };
  const load = async () => {
    const request = ++requestSequence;
    if (!snapshot.bridgeAvailable) {
      publish({
        ...snapshot,
        loading: false,
        error: MCP_SERVERS_BRIDGE_UNAVAILABLE,
      });
      return null;
    }
    publish({ ...snapshot, loading: true, error: "" });
    try {
      const value = await listManualMcpServers({ scope });
      if (!disposed && request === requestSequence) adopt(value);
      return value;
    } catch (cause) {
      if (!disposed && request === requestSequence) {
        publish({
          ...snapshot,
          loading: false,
          error: errorMessage(cause),
        });
      }
      return null;
    }
  };
  const fence = (value: McpServersSnapshot) => {
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
  const mutate = async (
    pendingKey: string,
    task: (value: McpServersSnapshot) => Promise<McpServersSnapshot>
  ) => {
    requestSequence += 1;
    const operation = mutationTail.then(async () => {
      const current = snapshot.value ?? (await listManualMcpServers({ scope }));
      return task(current);
    });
    mutationTail = operation.then(
      () => undefined,
      () => undefined
    );
    publish({
      ...snapshot,
      error: "",
      pending: new Set(snapshot.pending).add(pendingKey),
    });
    try {
      adopt(await operation);
      return true;
    } catch (cause) {
      const message = errorMessage(cause);
      const refreshed = await listManualMcpServers({ scope }).catch(() => null);
      if (refreshed) adopt(refreshed);
      publish({ ...snapshot, error: message });
      return false;
    } finally {
      const pending = new Set(snapshot.pending);
      pending.delete(pendingKey);
      publish({ ...snapshot, pending });
    }
  };
  const affectsQuery = (event: McpServersChangedEvent) =>
    event.version.scope.kind === "global" ||
    (scope.kind === "project" &&
      event.version.scope.kind === "project" &&
      event.version.scope.projectId === scope.projectId);
  const stop = onManualMcpServersChanged((event) => {
    if (affectsQuery(event)) void load();
  });

  return {
    scope,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => snapshot,
    load,
    save: (
      draft: ManualMcpServerDraft,
      server?: ManualMcpServerView
    ) =>
      mutate(`server:${server?.serverId ?? "new"}`, (current) =>
        saveManualMcpServer({
          ...fence(current),
          ...(server ? { serverId: server.serverId } : {}),
          draft,
        })
      ),
    remove: (server: ManualMcpServerView) =>
      mutate(`server:${server.serverId}`, (current) =>
        removeManualMcpServer({
          ...fence(current),
          serverId: server.serverId,
        })
      ),
    dispose() {
      disposed = true;
      requestSequence += 1;
      stop();
      listeners.clear();
    },
  };
}
