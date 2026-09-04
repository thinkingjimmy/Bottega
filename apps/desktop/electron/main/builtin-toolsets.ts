/**
 * [INPUT]: Depends on domain services, Browser runtime, Design screenshot runtime, frozen Skills custody, and the fail-closed Claude plugin overlay reader
 * [OUTPUT]: Provides createBuiltinToolsets with shared subagent orchestration, incarnation-bound registered-canvas render checks, and an exact-issued `use_skill` toolset bound to one turn custody
 * [POS]: Main built-in tool composition root; index injects initialized owners while toolsets expose only narrow ports
 */

import { createSubagentToolset } from "./agent/subagent-toolset";
import { SubagentSpawnService } from "./agent/subagent-spawn";
import type { AppsService } from "./apps/apps-service";
import { createAppToolset } from "./apps/turn/toolset";
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
import type { AgentPluginInventory } from "./extensions/agent-plugin-inventory";
import type { SkillsTurnCustodyStore } from "./skills-management/turn-custody";
import { createUseSkillToolset } from "./skills-management/use-skill-toolset";
import { createDesignToolset } from "./design/toolset";

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
  agentPlugins: Pick<AgentPluginInventory, "disabledClaudePluginIds">;
  skillsCustody: SkillsTurnCustodyStore;
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
    "agentPlugins",
    "skillsCustody",
  ] as const) {
    if (!deps[key]) throw new Error(`builtin toolset 缺少依赖：${key}`);
  }
  const subagentSpawn = new SubagentSpawnService({
    disabledClaudePluginIds: () => deps.agentPlugins.disabledClaudePluginIds(),
  });
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
    createProjectToolset(deps.projectsService, deps.chatsService),
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
    createDesignToolset({
      readDesignCanvasForTool: (chatId, incarnationId, file) =>
        deps.appsService.readDesignCanvasForTool(chatId, incarnationId, file),
    }),
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
    createUseSkillToolset(deps.skillsCustody),
  ] as const;
}
