/**
 * [INPUT]: Depends on ChatStore/ChatsService/Coordinator/BasesService/BaseStore/ProjectsService/AppsService/ArchiveService, Browser runtime and seven areas toolset factory
 * [OUTPUT]: Provides createBuiltinToolsets, centralizes all builtin handlers, archives read tags and is injected by the registry
 * [POS]: The main built-in tool is composition root; Exposure of effectiveArchived to narrow queries tied to the App to read-only tools, index only responsible for injecting initialized services
 */

import { createSubagentToolset } from "./agent/subagent-toolset";
import { SubagentSpawnService } from "./agent/subagent-spawn";
import type { AppsService } from "./apps/apps-service";
import { createAppToolset } from "./apps/toolset";
import type { BaseStore } from "./bases/base-store";
import type { BasesService } from "./bases/bases-service";
import { createBaseToolset } from "./bases/toolset";
import type { ChatStore } from "./chats/chat-store";
import type { ChatsService } from "./chats/chats-service";
import type { ProjectsService } from "./projects/projects-service";
import { createProjectToolset } from "./projects/toolset";
import type { ConversationCoordinator } from "./sections/coordinator/conversation-coordinator";
import type { ArchiveService } from "./archive/archive-service";
import { createSectionToolset } from "./sections/toolset";
import { createSearchToolset } from "./search/toolset";
import type { BrowserPanelService } from "./browser/browser-service";
import type { CdpHarness } from "./browser/cdp-harness";
import { createBrowserToolset } from "./browser/toolset";

export type BuiltinToolsetDependencies = {
  chatStore: ChatStore;
  chatsService: ChatsService;
  coordinator: ConversationCoordinator;
  basesService: BasesService;
  baseStore: BaseStore;
  projectsService: ProjectsService;
  appsService: AppsService;
  archiveService?: Pick<ArchiveService, "isConversationAvailable">;
  browserService: BrowserPanelService;
  browserHarness: CdpHarness;
};

export function createBuiltinToolsets(deps: BuiltinToolsetDependencies) {
  for (const key of [
    "chatStore",
    "chatsService",
    "coordinator",
    "basesService",
    "baseStore",
    "projectsService",
    "appsService",
    "browserService",
    "browserHarness",
  ] as const) {
    if (!deps[key]) throw new Error(`builtin toolset 缺少依赖：${key}`);
  }
  const subagentSpawn = new SubagentSpawnService();
  return [
    createSectionToolset(deps.chatStore, deps.coordinator, {
      baseSummaryForSection: (chatId) =>
        deps.basesService.summaryForSection(chatId),
      isEffectiveArchived: (chatId) =>
        !(deps.archiveService?.isConversationAvailable(chatId) ?? true),
      exportAttachment: (sectionId, attachmentId) =>
        deps.chatsService.exportAttachment(sectionId, attachmentId),
      promotableResults: subagentSpawn.promotableResultSource(),
    }),
    createBaseToolset(
      deps.basesService,
      (chatId) => !(deps.archiveService?.isConversationAvailable(chatId) ?? true)
    ),
    createProjectToolset(deps.projectsService),
    createSubagentToolset(subagentSpawn),
    createSearchToolset(
      deps.chatStore,
      deps.baseStore,
      (chatId) =>
        !(deps.archiveService?.isConversationAvailable(chatId) ?? true),
      (projectId) =>
        Boolean(deps.projectsService.store.get(projectId)?.archivedAt)
    ),
    createBrowserToolset(deps.browserService, deps.browserHarness),
    createAppToolset({
      appRoleOf: (chatId) => deps.chatStore.getAppRole(chatId),
      projectIdOf: (chatId) => deps.chatStore.getProjectId(chatId),
      appIdOfProject: (projectId) => {
        const binding = deps.projectsService.store.get(projectId)
          ?.workspaceBinding;
        return binding?.kind === "app" ? binding.appId : undefined;
      },
      appDirOf: (appId) => deps.appsService.resolveAppForBinding(appId)?.dir,
    }),
  ] as const;
}
