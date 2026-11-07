/**
 * [INPUT]: Depends on domain services, Browser/Design and bundled-Node palette runtimes, effective workspace authority, frozen Skills custody and disabled Agent plugin identities.
 * [OUTPUT]: Provides createOfficialToolsets with current-Chat historical attachments, incarnation-bound canvas checks, Skills, independent bundled-Node palette validation and plugin authoring.
 * [POS]: apps/desktop/electron/main/plugins/official; Host feature executor adapter; index injects initialized owners while toolsets expose only narrow ports
 */

import { createSubagentToolset } from "../../agent/subagents/subagent-toolset";
import { SubagentSpawnService } from "../../agent/subagents/subagent-spawn";
import type { AppsService } from "../../apps/apps-service";
import { createAppToolset } from "../../apps/turn/toolset";
import type { BaseStore } from "../../bases/base-store";
import type { BasesService } from "../../bases/bases-service";
import { createBaseToolset } from "../../bases/toolset";
import type { ChatStore } from "../../chats/chat-store";
import type { ChatsService } from "../../chats/service/chats-service";
import type { ProjectsService } from "../../projects/projects-service";
import { createProjectToolset } from "../../projects/toolset";
import type { ConversationCoordinator } from "../../sections/coordinator/conversation-coordinator";
import type { ArchiveService } from "../../archive/archive-service";
import { createSectionToolset } from "../../sections/toolset";
import { createSearchToolset } from "../../search/toolset";
import type { BrowserPanelService } from "../../browser/browser-service";
import type { CdpHarness } from "../../browser/cdp-harness";
import { createBrowserToolset } from "../../browser/toolset";
import type { AgentPluginInventory } from "../../extensions/agent-plugins/inventory";
import type { SkillsTurnCustodyStore } from "../../skills-management/custody/turn-custody";
import { createDesignToolset } from "../../design/tooling/toolset";
import { createDatavizToolset } from "../../skills/dataviz/toolset";
import { createChatHistoryToolset } from "../../agent/history/lease";
import { toolSpec } from "../../../../shared/plugin-tools";
import type { PluginToolset } from "../../tools/registry";
import { createWorkflowToolset } from "../../workflows/step-results";
import { createPluginToolset } from "../../plugins/authoring/toolset";
import { createPreviewToolset } from "../../preview/tools";
import type { EffectiveWorkspaceResolver } from "../../workspace/files/workspace-resolver";
import { designDocuments } from "../../design/documents/runtime";

export type PluginToolsetDependencies = {
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
  agentPlugins: Pick<AgentPluginInventory, "disabledPluginIds">;
  skillsCustody: SkillsTurnCustodyStore;
  resolveEffectiveWorkspace: EffectiveWorkspaceResolver;
};

export function createOfficialToolsets(deps: PluginToolsetDependencies) {
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
    if (!deps[key]) throw new Error(`Official tool dependency is missing: ${key}`);
  }
  const subagentSpawn = new SubagentSpawnService({
    disabledPluginIds: (agent) => deps.agentPlugins.disabledPluginIds(agent),
  });
  const sections = createSectionToolset(deps.chatStore, deps.coordinator, {
      baseSummaryForSection: (chatId) =>
        deps.basesService.summaryForSection(chatId),
      isEffectiveArchived: (chatId) =>
        !(deps.archiveService?.isConversationAvailable(chatId) ?? true),
      exportAttachment: (sectionId, attachmentId) =>
        deps.chatsService.exportAttachment(sectionId, attachmentId),
      promotableResults: subagentSpawn.promotableResultSource(),
    });
  return [
    createPreviewToolset(),
    createDatavizToolset(),
    createChatHistoryToolset(deps.chatStore, {
      readAttachment: (chatId, attachmentId) => deps.chatsService.readSectionAttachment(chatId, attachmentId),
      workspace: (chatId, incarnationId) => {
        if (deps.chatStore.getIncarnationId(chatId) !== incarnationId) throw new Error("CHAT_HISTORY_UNAVAILABLE");
        const result = deps.resolveEffectiveWorkspace({ kind: "conversation", conversationId: chatId });
        if (result.kind !== "ready") throw new Error("CHAT_WORKSPACE_UNAVAILABLE");
        return result.workspace;
      },
    }),
    sections,
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
        designDocuments().singleHtml(chatId, incarnationId, file),
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
    createPluginToolset({
      resolveWorkspace: async (chatId, incarnationId) => {
        if (deps.chatStore.getIncarnationId(chatId) !== incarnationId) throw new Error("plugin-chat-expired");
        const workspace = deps.resolveEffectiveWorkspace({ kind: "conversation", conversationId: chatId });
        if (workspace.kind !== "ready") throw new Error("plugin-workspace-unavailable");
        return workspace.workspace;
      },
    }),
    createWorkflowToolset(sections.read_section!),
    {
      use_skill: (args, context) =>
        deps.skillsCustody.use(context.lease.skillsCustodyId, args.name as string),
    } satisfies PluginToolset,
  ] as const;
}

export function createOfficialToolExecutors(deps: PluginToolsetDependencies) {
  const plugins = new Map<string, PluginToolset>();
  for (const toolset of createOfficialToolsets(deps)) for (const [name, handler] of Object.entries(toolset)) {
    const declaration = toolSpec(name);
    if (!declaration) throw new Error(`Official executor has no declaration: ${name}`);
    const handlers = plugins.get(declaration.pluginId) ?? {};
    if (handlers[name]) throw new Error(`Official executor is duplicated: ${name}`);
    handlers[name] = handler;
    plugins.set(declaration.pluginId, handlers);
  }
  return plugins;
}
