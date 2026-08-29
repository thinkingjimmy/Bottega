/**
 * [INPUT]: Depends on the preload Project Tools bridge, shared exact-Project DTOs, and renderer error projection
 * [OUTPUT]: Provides narrow bridge wrappers plus a lifecycle-fenced, revision-monotonic, CAS-serialized ProjectToolsController
 * [POS]: Sole renderer authority for one Project Tool Policy; views receive one exact Project and can never enumerate other policies
 */

import type {
  ProjectToolPolicySnapshot,
  ProjectToolsBridgeApi,
  ProjectToolsChangedEvent,
  ResetProjectBuiltinToolOverrideInput,
  ResetProjectGlobalMcpOverrideInput,
  ResetProjectToolPolicyInput,
  SetProjectBuiltinToolOverrideInput,
  SetProjectGlobalMcpOverrideInput,
  ToolOverride,
} from "../../shared/project-tools-ipc";
import { PROJECT_TOOLS_BRIDGE_UNAVAILABLE } from "../../shared/project-tools-ipc";
import { errorMessage } from "./errors";

declare global {
  interface Window {
    projectTools?: ProjectToolsBridgeApi;
  }
}

export const hasProjectToolsBridge = () => Boolean(window.projectTools);

function bridge() {
  if (!window.projectTools) {
    throw new Error(PROJECT_TOOLS_BRIDGE_UNAVAILABLE);
  }
  return window.projectTools;
}

export const getProjectTools = (projectId: string) =>
  bridge().get({ projectId });
export const setProjectBuiltinToolOverride = (
  input: SetProjectBuiltinToolOverrideInput
) => bridge().setBuiltinOverride(input);
export const resetProjectBuiltinToolOverride = (
  input: ResetProjectBuiltinToolOverrideInput
) => bridge().resetBuiltinOverride(input);
export const setProjectGlobalMcpOverride = (
  input: SetProjectGlobalMcpOverrideInput
) => bridge().setGlobalMcpOverride(input);
export const resetProjectGlobalMcpOverride = (
  input: ResetProjectGlobalMcpOverrideInput
) => bridge().resetGlobalMcpOverride(input);
export const resetProjectToolPolicy = (input: ResetProjectToolPolicyInput) =>
  bridge().resetAll(input);
export const onProjectToolsChanged = (
  listener: (event: ProjectToolsChangedEvent) => void
) => window.projectTools?.onChanged(listener) ?? (() => {});

export type ProjectToolsControllerSnapshot = Readonly<{
  value: ProjectToolPolicySnapshot | null;
  loading: boolean;
  error: string;
  pending: ReadonlySet<string>;
  bridgeAvailable: boolean;
}>;

type Mutation = (
  fence: Readonly<{
    projectId: string;
    expectedProjectLifecycleRevision: number;
    expectedProjectPolicyRevision: number;
  }>
) => Promise<ProjectToolPolicySnapshot>;

export type ProjectToolsController = ReturnType<
  typeof createProjectToolsController
>;

export function createProjectToolsController(projectId: string) {
  const listeners = new Set<() => void>();
  let requestSequence = 0;
  let disposed = false;
  let mutationTail = Promise.resolve();
  let snapshot: ProjectToolsControllerSnapshot = {
    value: null,
    loading: false,
    error: "",
    pending: new Set(),
    bridgeAvailable: hasProjectToolsBridge(),
  };

  const publish = (next: ProjectToolsControllerSnapshot) => {
    if (disposed || next === snapshot) return;
    snapshot = next;
    for (const listener of listeners) listener();
  };
  const isAuthoritative = (value: ProjectToolPolicySnapshot) => {
    const current = snapshot.value;
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
  const adopt = (value: ProjectToolPolicySnapshot) => {
    if (
      value.version.scope.projectId !== projectId ||
      !isAuthoritative(value)
    ) return;
    publish({ ...snapshot, value, loading: false, error: "" });
  };
  const load = async () => {
    const request = ++requestSequence;
    if (!snapshot.bridgeAvailable) {
      publish({
        ...snapshot,
        loading: false,
        error: PROJECT_TOOLS_BRIDGE_UNAVAILABLE,
      });
      return null;
    }
    publish({ ...snapshot, loading: true, error: "" });
    try {
      const value = await getProjectTools(projectId);
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
  const fence = (value: ProjectToolPolicySnapshot) => ({
    projectId,
    expectedProjectLifecycleRevision: value.version.projectLifecycleRevision,
    expectedProjectPolicyRevision: value.version.scopeRevision,
  });
  const mutate = async (pendingKey: string, mutation: Mutation) => {
    requestSequence += 1;
    const task = mutationTail.then(async () => {
      const current = snapshot.value ?? (await getProjectTools(projectId));
      if (current.version.scope.projectId !== projectId) {
        throw new Error("PROJECT_TOOLS_SCOPE_MISMATCH");
      }
      return mutation(fence(current));
    });
    mutationTail = task.then(
      () => undefined,
      () => undefined
    );
    publish({
      ...snapshot,
      error: "",
      pending: new Set(snapshot.pending).add(pendingKey),
    });
    try {
      adopt(await task);
      return true;
    } catch (cause) {
      /* A conflict refreshes the authoritative baseline. Draft state belongs to
         the calling component, so this refresh cannot overwrite an MCP form. */
      const message = errorMessage(cause);
      const refreshed = await getProjectTools(projectId).catch(() => null);
      if (refreshed) adopt(refreshed);
      publish({ ...snapshot, error: message });
      return false;
    } finally {
      const pending = new Set(snapshot.pending);
      pending.delete(pendingKey);
      publish({ ...snapshot, pending });
    }
  };

  const stop = onProjectToolsChanged((event) => {
    if (
      event.projectId === projectId &&
      event.projectPolicyRevision !== snapshot.value?.version.scopeRevision
    ) {
      void load();
    }
  });

  return {
    projectId,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => snapshot,
    load,
    setBuiltinOverride: (toolId: string, override: ToolOverride) =>
      mutate(`builtin:${toolId}`, (current) =>
        setProjectBuiltinToolOverride({ ...current, toolId, override })
      ),
    resetBuiltinOverride: (toolId: string) =>
      mutate(`builtin:${toolId}`, (current) =>
        resetProjectBuiltinToolOverride({ ...current, toolId })
      ),
    setGlobalMcpOverride: (
      serverId: `manual:${string}`,
      override: ToolOverride
    ) =>
      mutate(`mcp:${serverId}`, (current) =>
        setProjectGlobalMcpOverride({ ...current, serverId, override })
      ),
    resetGlobalMcpOverride: (serverId: `manual:${string}`) =>
      mutate(`mcp:${serverId}`, (current) =>
        resetProjectGlobalMcpOverride({ ...current, serverId })
      ),
    resetAll: () =>
      mutate("reset-all", (current) => resetProjectToolPolicy(current)),
    dispose() {
      disposed = true;
      requestSequence += 1;
      stop();
      listeners.clear();
    },
  };
}
