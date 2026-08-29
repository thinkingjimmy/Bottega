/**
 * [INPUT]: Depends on Apps/Chats stores, Sections pending CreateIntent, shared AppLocale/local detachment causes, Agent conversation lifecycle, Memory rebind fence, Design rebind observer, ProjectStore, ProjectResourceCleanupCoordinator, and ProjectsService
 * [OUTPUT]: Provides composeProjectsService, which wires Project-held lifecycle callbacks, unified record cleanup, stale-session release, and main-owned rebind evidence into Memory and Design convergence
 * [POS]: The main composition of the projects module; ProjectsService maintains a domain-specific index that is only responsible for lifecycle and instance order
 */

import type { AppsService } from "../apps/apps-service";
import {
  cancelConversations,
  hasConversationActivity,
  releaseThreadScopeForConversation,
} from "../agent-bridge";
import type { ChatStore } from "../chats/chat-store";
import type { ChatsService } from "../chats/chats-service";
import type { BasesService } from "../bases/bases-service";
import type { MemoryService } from "../memory/service/memory-service";
import type { ConversationDeletionCoordinator } from "../deletion/conversation-deletion-coordinator";
import type { ProjectStore } from "./project-store";
import { ProjectsService } from "./projects-service";
import { ProjectRebindJournal } from "./rebind-journal";
import type { AppLocale } from "../../../shared/i18n/locale";
import type { ProjectLocalDetachReason } from "../../../shared/projects-ipc";
import type { ProjectResourceCleanupCoordinator } from "./resource-cleanup/coordinator";

export function composeProjectsService(input: {
  store: ProjectStore;
  userData: string;
  apps: () => AppsService | null;
  chats: () => ChatsService | null;
  chatStore: () => ChatStore | null;
  bases: () => BasesService | null;
  memory?: () => MemoryService | null;
  deletions?: () => ConversationDeletionCoordinator | null;
  hasPendingProjectCreation?: (projectId: string) => boolean;
  isProjectOpen?: (projectId: string) => boolean;
  localDetachReasons?: (projectId: string) => ProjectLocalDetachReason[];
  locale?: () => AppLocale;
  resourceCleanup: ProjectResourceCleanupCoordinator;
}) {
  return new ProjectsService(input.store, {
    resourceCleanup: input.resourceCleanup,
    rebindJournal: new ProjectRebindJournal(input.userData),
    locale: input.locale,
    resolveApp: (appId) => input.apps()?.resolveApp(appId),
    resolveAppForBinding: (appId) =>
      input.apps()?.resolveAppForBinding(appId),
    isAppProjectAvailable: (appId) =>
      input.apps()?.isProjectAvailable(appId) ?? false,
    listProjectRefs: () => input.chatStore()?.listProjectRefs() ?? new Map(),
    removeChatsByProject: (projectId, projectLifecycle) =>
      input.chats()?.removeByProject(projectId, projectLifecycle) ??
      Promise.resolve(),
    removeBaseForProject: async (projectId) => {
      await input.bases()?.removeForProject(projectId);
    },
    cancelTurnsByProject: (projectId) =>
      cancelConversations(input.chatStore()?.listByProject(projectId) ?? []),
    hasActiveTurnsByProject: (projectId) =>
      hasConversationActivity(
        input.chatStore()?.listByProject(projectId) ?? []
      ),
    getChatBinding: (chatId) => {
      const store = input.chatStore();
      const incarnationId = store?.getIncarnationId(chatId);
      if (!store || !incarnationId) return undefined;
      return {
        incarnationId,
        projectId: store.getProjectId(chatId) ?? null,
      };
    },
    assignProjectToChat: (chatId, projectId) =>
      input.chats()!.assignProject(chatId, projectId),
    moveChatProject: (chatId, expectedSource, target, appRole) =>
      input.chats()!.moveProject(chatId, expectedSource, target, appRole),
    publishChatUpserted: (summary) =>
      input.chats()!.publishUpserted(summary),
    listChatsByProject: (projectId) =>
      input.chatStore()?.listByProject(projectId) ?? [],
    hasPendingProjectCreation: input.hasPendingProjectCreation,
    localDetachReasons: input.localDetachReasons,
    releaseChatProject: async (chatId) => {
      const chats = input.chats();
      const record = await input.chatStore()?.get(chatId);
      if (!chats) throw new Error("ChatsService 尚未初始化");
      if (record?.session) {
        await chats.replaceSession(
          { conversationId: chatId },
          record.session,
          null
        );
        releaseThreadScopeForConversation(chatId);
      }
      return chats.releaseProject(chatId);
    },
    listManagedRoots: () => [
      input.userData,
      ...(input.apps()?.listAppDirs() ?? []),
    ],
    isProjectOpen: input.isProjectOpen,
    snapshotMemoryRebind: (projectId) =>
      input.memory?.()?.snapshotProjectRebind(projectId) ?? Promise.resolve(null),
    prepareMemoryRebind: (projectId, operationId, expectation) =>
      input.memory?.()?.prepareProjectRebind(projectId, operationId, expectation) ??
      Promise.resolve({ applied: false }),
    hasDeletionFenceForProject: (projectId) =>
      (input.chatStore()?.listByProject(projectId) ?? []).some((chatId) =>
        input.deletions?.()?.hasActive(chatId) ?? false
      ),
    onWorkspaceRebound: async (capsule) => {
      await input.apps()?.migrateDesignProjectWorkspace({
        operationId: capsule.operationId,
        projectId: capsule.projectId,
        sourceBinding: capsule.sourceBinding,
        targetBinding: capsule.targetBinding,
      });
    },
    /* fence 缺席时 fail closed：宁可拒绝一次转换，也不能在没有 D17 复核的情况下
       把一个可能仍持有授权的 Project 变成 App workspace。 */
    admitAppConversion: (projectId, work) => {
      const fence = input.apps()?.attachments;
      if (!fence) throw new Error("App attachment fence 尚未初始化");
      return fence.runConversion({ kind: "project", projectId }, async () => {
        await fence.assertConvertible({ kind: "project", projectId });
        return work();
      });
    },
  });
}
