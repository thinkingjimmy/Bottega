/**
 * [INPUT]: Depends on the preload Project Tools bridge, shared exact-Project DTOs, and lib/snapshot-controller
 * [OUTPUT]: Provides createProjectToolsController — a lifecycle-fenced, revision-monotonic, CAS-serialized controller for one Project Tool Policy
 * [POS]: Sole renderer authority for one Project Tool Policy; it supplies the Project guard, the CAS fence and override commands on top of the shared snapshot-controller core, and views can never enumerate other policies
 */

import type {
  ProjectToolPolicySnapshot,
  ProjectToolsBridgeApi,
  ToolOverride,
} from "../../shared/project-tools-ipc";
import { PROJECT_TOOLS_BRIDGE_UNAVAILABLE } from "../../shared/project-tools-ipc";
import { createSnapshotController } from "./snapshot-controller";

declare global {
  interface Window {
    projectTools?: ProjectToolsBridgeApi;
  }
}

function bridge() {
  if (!window.projectTools) {
    throw new Error(PROJECT_TOOLS_BRIDGE_UNAVAILABLE);
  }
  return window.projectTools;
}

const isAuthoritative = (
  value: ProjectToolPolicySnapshot,
  current: ProjectToolPolicySnapshot | null
) => {
  if (!current) return true;
  const nextLifecycle = value.version.projectLifecycleRevision;
  const currentLifecycle = current.version.projectLifecycleRevision;
  if (nextLifecycle !== currentLifecycle) {
    return nextLifecycle > currentLifecycle &&
      value.storeRevision >= current.storeRevision;
  }
  return value.version.scopeRevision >= current.version.scopeRevision &&
    value.storeRevision >= current.storeRevision;
};

export function createProjectToolsController(projectId: string) {
  const core = createSnapshotController<ProjectToolPolicySnapshot>({
    bridgeAvailable: Boolean(window.projectTools),
    bridgeUnavailableError: PROJECT_TOOLS_BRIDGE_UNAVAILABLE,
    fetch: () => bridge().get({ projectId }),
    accepts: (value, current) =>
      value.version.scope.projectId === projectId &&
      isAuthoritative(value, current),
    watch: (reload, current) =>
      window.projectTools?.onChanged((event) => {
        if (
          event.projectId === projectId &&
          event.projectPolicyRevision !== current()?.version.scopeRevision
        ) {
          reload();
        }
      }) ?? (() => {}),
  });
  const fence = (current: ProjectToolPolicySnapshot) => {
    if (current.version.scope.projectId !== projectId) {
      throw new Error("PROJECT_TOOLS_SCOPE_MISMATCH");
    }
    return {
      projectId,
      expectedProjectLifecycleRevision: current.version.projectLifecycleRevision,
      expectedProjectPolicyRevision: current.version.scopeRevision,
    };
  };

  return {
    projectId,
    subscribe: core.subscribe,
    getSnapshot: core.getSnapshot,
    load: core.load,
    setBuiltinOverride: (toolId: string, override: ToolOverride) =>
      core.mutate(`builtin:${toolId}`, (current) =>
        bridge().setBuiltinOverride({ ...fence(current), toolId, override })
      ),
    resetBuiltinOverride: (toolId: string) =>
      core.mutate(`builtin:${toolId}`, (current) =>
        bridge().resetBuiltinOverride({ ...fence(current), toolId })
      ),
    setGlobalMcpOverride: (
      serverId: `manual:${string}`,
      override: ToolOverride
    ) =>
      core.mutate(`mcp:${serverId}`, (current) =>
        bridge().setGlobalMcpOverride({ ...fence(current), serverId, override })
      ),
    resetGlobalMcpOverride: (serverId: `manual:${string}`) =>
      core.mutate(`mcp:${serverId}`, (current) =>
        bridge().resetGlobalMcpOverride({ ...fence(current), serverId })
      ),
    resetAll: () =>
      core.mutate("reset-all", (current) => bridge().resetAll(fence(current))),
    dispose: core.dispose,
  };
}
