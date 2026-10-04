/**
 * [INPUT]: Depends on main BrowserWindow identity, Apps/Chats/Projects/Settings services, durable App chat slots, file/surface custody, App-window factory, WindowRegistry, and SurfaceWindowController
 * [OUTPUT]: Provides configureWindowSurfaces to bind the main renderer and install canonical/draft App-chat identity resolution, compound migration, and renderer-loss capability cleanup once Installs the App availability guard for window opens.
 * [POS]: Window surfaces composition adapter; keeps multi-window assembly out of the domain-heavy main-window root
 */

import type { BrowserWindow } from "electron";
import type { AppsService } from "../../apps/apps-service";
import type { ChatsService } from "../../chats/service/chats-service";
import type { SettingsStore } from "../../settings/settings-store";
import type { ProjectsService } from "../../projects/projects-service";
import type { FileAuthorizationStore } from "../../workspace/files/file-authorizations";
import type { WorkspaceResolver } from "../../skills/catalog/skills-catalog";
import { bindRendererIdentity } from "../security/renderer-identity";
import { createAppWindow } from "./app-window";
import { surfaceWindowController } from "./surface-window-controller";
import { windowRegistry } from "./window-registry";

export function configureWindowSurfaces(input: Readonly<{
  window: BrowserWindow;
  rendererUrl: string;
  mainDirectory: string;
  apps: AppsService;
  chats: ChatsService;
  projects: ProjectsService;
  settings: SettingsStore;
  files: FileAuthorizationStore;
  resolveWorkspace: WorkspaceResolver;
}>) {
  bindRendererIdentity(input.window.webContents);
  windowRegistry.register({
    windowId: "main",
    role: "main",
    appId: null,
    rendererUrl: input.rendererUrl,
    window: input.window,
  });
  surfaceWindowController.configureAppAvailability(appId => input.apps.assertEnabled(appId));
  surfaceWindowController.configure(
    input.rendererUrl,
    (appId, windowId, route) => createAppWindow({ ...input, appId, windowId, route }),
    (chatId) => {
      const chat = input.chats.store.getChatRef(chatId);
      const project = chat?.projectId ? input.projects.store.get(chat.projectId) : undefined;
      if (chat) return {
        incarnationId: chat.incarnationId,
        appId: project?.workspaceBinding.kind === "app"
          ? project.workspaceBinding.appId
          : null,
        appRole: chat.appRole,
      };
      const record = input.apps.store.list().find((candidate) =>
        (candidate.activeUseChatSlot?.state === "draft" &&
          candidate.activeUseChatSlot.id === chatId) ||
        (candidate.editChatSlot?.state === "draft" &&
          candidate.editChatSlot.id === chatId)
      );
      if (!record) return undefined;
      return {
        incarnationId: null,
        appId: record.id,
        appRole: record.activeUseChatSlot?.id === chatId ? "use" : "edit",
      };
    },
    (appId) => input.apps.store.get(appId)?.activeUseChatSlot?.id,
    (refs, sourceWindowId, targetWindowId, chatId) => {
      const { workspace } = input.resolveWorkspace({
        kind: "conversation",
        conversationId: chatId,
      });
      input.files.rebindWindow(refs, sourceWindowId, targetWindowId, workspace);
    },
    (windowId) => {
      input.files.releaseWindow(windowId);
      input.apps.releaseWindowSurfaces(windowId);
    }
  );
}
