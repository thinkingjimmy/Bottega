/**
 * [INPUT]: Depends on trusted renderer context, main-owned App Studio residence, project snapshots/events, and RendererEventBus
 * [OUTPUT]: Provides exact App-window Project projection and role/App-scoped event publication
 * [POS]: Projects/service renderer policy; ProjectsService keeps lifecycle work while this adapter prevents cross-App disclosure
 */

import type {
  ProjectsEvent,
  ProjectsSnapshot,
} from "../../../../shared/projects-ipc";
import type { BrowserWindow } from "electron";
import { rendererEventBus } from "../../window/surfaces/renderer-event-bus";
import { surfaceWindowController } from "../../window/surfaces/surface-window-controller";
import type { TrustedRendererContext } from "../../window/surfaces/trusted-renderer-context";

type StudioAssertion = (context: TrustedRendererContext, appId: string) => void;

export function projectSnapshotForRenderer(
  context: TrustedRendererContext,
  snapshot: ProjectsSnapshot,
  assertStudio: StudioAssertion = (current, appId) =>
    surfaceWindowController.assertAppStudioMutation(current, appId)
): ProjectsSnapshot {
  if (context.role === "main") return snapshot;
  const appId = context.appId;
  if (!appId) throw new Error("App window identity is missing");
  assertStudio(context, appId);
  return {
    projects: snapshot.projects.filter(
      (project) =>
        project.workspaceBinding.kind === "app" &&
        project.workspaceBinding.appId === appId
    ),
    sortMode: snapshot.sortMode,
  };
}

export function publishProjectsEvent(
  channel: string,
  event: ProjectsEvent,
  fallback?: BrowserWindow | null
) {
  let delivered = rendererEventBus.toRole("main", channel, event);
  if (
    event.type === "upserted" &&
    event.project.workspaceBinding.kind === "app"
  ) {
    delivered += rendererEventBus.toApp(
      event.project.workspaceBinding.appId,
      channel,
      event
    );
  }
  if (!delivered && fallback && !fallback.isDestroyed()) {
    fallback.webContents.send(channel, event);
    delivered += 1;
  }
  return delivered;
}
