/**
 * [INPUT]: Depends on BrowserWindow, rendererIpc, canonical ProjectStore lifecycle authority, ProjectToolPolicyStore, and renderer-safe builtin inventory facts
 * [OUTPUT]: Provides exact-Project project-tools IPC registration with main-role residence, lifecycle+policy dual CAS, narrow snapshots, and owner-scoped changed events
 * [POS]: Authoritative renderer boundary for Project Tool Policy; renderer identifiers are requests, never owner evidence
 */

import type { BrowserWindow } from "electron";
import {
  PROJECT_TOOLS_CHANNEL,
  type ProjectBuiltinToolView,
  type ProjectToolPolicyPayload,
  type ProjectToolPolicySnapshot,
  type ProjectToolsChangedEvent,
  type ResetProjectBuiltinToolOverrideInput,
  type ResetProjectGlobalMcpOverrideInput,
  type ResetProjectToolPolicyInput,
  type SetProjectBuiltinToolOverrideInput,
  type SetProjectGlobalMcpOverrideInput,
} from "../../../../shared/project-tools-ipc";
import type { ProjectStore } from "../../projects/project-store";
import { rendererIpc } from "../../ipc-registrar";
import type { ProjectToolPolicyStore } from "./store";

export type ProjectBuiltinInventory = (
  policy: ProjectToolPolicyPayload
) => readonly ProjectBuiltinToolView[];

export function registerProjectTools(
  window: BrowserWindow,
  rendererUrl: string,
  projects: ProjectStore,
  policies: ProjectToolPolicyStore,
  builtinInventory: ProjectBuiltinInventory = () => []
) {
  const snapshot = (projectId: string): ProjectToolPolicySnapshot => {
    const context = projects.turnContext(projectId);
    const current = policies.project(projectId);
    return {
      version: {
        scope: { kind: "project", projectId },
        projectLifecycleRevision: context.projectLifecycleRevision!,
        scopeRevision: current.projectRevision,
      },
      storeRevision: current.storeRevision,
      policy: current.policy,
      builtinTools: builtinInventory(current.policy),
    };
  };
  const publish = (event: ProjectToolsChangedEvent) => {
    if (!window.isDestroyed()) {
      window.webContents.send(PROJECT_TOOLS_CHANNEL.changed, event);
    }
  };
  const stop = policies.onChanged((event) => {
    const current = projects.get(event.projectId);
    if (!current || projects.isDeleting(event.projectId)) return;
    publish({
      ...event,
      projectLifecycleRevision: current.projectLifecycleRevision,
    });
  });
  window.once("closed", stop);

  const mutate = async <T extends PolicyFence>(
    input: T,
    operation: (input: T) => Promise<unknown>
  ) => {
    await projects.runWithLifecycle(
      input.projectId,
      input.expectedProjectLifecycleRevision,
      () => operation(input)
    );
    return snapshot(input.projectId);
  };

  rendererIpc(window, rendererUrl, "拒绝非主窗口的 Project Tools 请求")
    .roles("main")
    .handle(PROJECT_TOOLS_CHANNEL.get, (raw) => {
      const input = raw as { projectId: string };
      return snapshot(input.projectId);
    })
    .handle(PROJECT_TOOLS_CHANNEL.setBuiltinOverride, (raw) => {
      const input = raw as SetProjectBuiltinToolOverrideInput;
      return mutate(input, (value) => policies.setBuiltinOverride(
        value.projectId,
        value.expectedProjectPolicyRevision,
        value.toolId,
        value.override
      ));
    })
    .handle(PROJECT_TOOLS_CHANNEL.resetBuiltinOverride, (raw) => {
      const input = raw as ResetProjectBuiltinToolOverrideInput;
      return mutate(input, (value) => policies.resetBuiltinOverride(
        value.projectId,
        value.expectedProjectPolicyRevision,
        value.toolId
      ));
    })
    .handle(PROJECT_TOOLS_CHANNEL.setGlobalMcpOverride, (raw) => {
      const input = raw as SetProjectGlobalMcpOverrideInput;
      return mutate(input, (value) => policies.setGlobalMcpOverride(
        value.projectId,
        value.expectedProjectPolicyRevision,
        value.serverId,
        value.override
      ));
    })
    .handle(PROJECT_TOOLS_CHANNEL.resetGlobalMcpOverride, (raw) => {
      const input = raw as ResetProjectGlobalMcpOverrideInput;
      return mutate(input, (value) => policies.resetGlobalMcpOverride(
        value.projectId,
        value.expectedProjectPolicyRevision,
        value.serverId
      ));
    })
    .handle(PROJECT_TOOLS_CHANNEL.resetAll, (raw) => {
      const input = raw as ResetProjectToolPolicyInput;
      return mutate(input, (value) => policies.resetAll(
        value.projectId,
        value.expectedProjectPolicyRevision
      ));
    });
}

type PolicyFence = Readonly<{
  projectId: string;
  expectedProjectLifecycleRevision: number;
  expectedProjectPolicyRevision: number;
}>;
