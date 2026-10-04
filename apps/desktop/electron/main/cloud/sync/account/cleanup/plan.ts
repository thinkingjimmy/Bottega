/**
 * [INPUT]: Depends on canonical Chat/Base/Project/App owners and committed local Home identity.
 * [OUTPUT]: Captures a bounded cleanup plan that retains local owners and their shared Project/Base dependencies.
 * [POS]: Account cleanup planning; frozen plans are persisted by the existing lifecycle journal before mutation.
 */
import { sameScope, type SyncScope } from "../../../../../../shared/local-storage/contracts";
import type { ChatStore } from "../../../../chats/chat-store";
import type { BaseStore } from "../../../../bases/base-store";
import type { ProjectStore } from "../../../../projects/store/project-store";
import type { AppStore } from "../../../../apps/store/app-store";
import type { ChatHomeService } from "../../../../chat-home/chat-home-service";
import { CLEANUP_PARTICIPANTS, SCOPE_CLEANUP_PLAN_VERSION, scopeCleanupPlanSchema, type ScopeCleanupPlan } from "../../../../lifecycle/scope-cleanup/model";
import { mirrorChatCatalog } from "../inventory";
import type { UnifiedSkillsService } from "../../../../skills-management/service";
export type CleanupOwners = { chats: ChatStore; bases: BaseStore; projects: ProjectStore; apps: AppStore; homes: ChatHomeService; skills?: UnifiedSkillsService };
export async function captureScopeCleanup(owners: CleanupOwners, scope: SyncScope, operationId: string): Promise<ScopeCleanupPlan> {
  const local = owners.chats.list().map(summary => owners.chats.getMetadata(summary.id)).filter(value => value !== null);
  const chats: ScopeCleanupPlan["chats"] = local.map(chat => {
    const home = owners.homes.ledger.get(chat.id);
    return { chatId: chat.id, incarnationId: chat.incarnationId, retain: true,
      homeIntentId: home?.ownership === "valid" && home.phase === "committed" ? home.intentId : null };
  });
  chats.push(...(await mirrorChatCatalog(owners.chats, scope)).map(chat => ({ chatId: chat.id, incarnationId: chat.incarnationId, retain: false, homeIntentId: null })));
  const installed = new Set(owners.apps.list().map(app => app.id));
  const appEntries = owners.apps.portable.list().filter(entry => sameScope(entry.scope, scope));
  const pendingApps = owners.apps.portable.pending().filter(intent => sameScope(intent.scope, scope));
  const retainedProjects = new Set(local.flatMap(chat => chat.projectId ? [chat.projectId] : []));
  for (const project of owners.projects.list()) {
    if (!project.sync || project.sync.retention === "local" || project.sync.pending.length || project.sync.conflicts.length ||
      project.workspaceBinding.kind === "external" || project.workspaceBinding.kind === "app" && installed.has(project.workspaceBinding.appId)) retainedProjects.add(project.id);
  }
  for (const entry of appEntries) if (installed.has(entry.descriptor.appId)) retainedProjects.add(entry.descriptor.projectId);
  const localChats = new Set(local.map(chat => chat.id));
  const bases = owners.bases.listAll().flatMap(({ ownerKey, snapshot }) => {
    const envelope = owners.bases.sync.read(ownerKey, snapshot.meta.ownerInstanceId);
    if (!sameScope(envelope.scope, scope)) return [];
    const owner = snapshot.meta.owner;
    const retain = envelope.cloudState === "synced" || envelope.pendingOperations.length > 0 || envelope.conflictCandidates.some(item => item.state === "unresolved") ||
      (owner.kind === "chat" ? localChats.has(owner.chatId) : retainedProjects.has(owner.projectId));
    if (retain && owner.kind === "project") retainedProjects.add(owner.projectId);
    return [{ ownerKey, ownerInstanceId: snapshot.meta.ownerInstanceId, retain }];
  });
  const projects = owners.projects.list().filter(project => project.sync && sameScope(project.sync.scope, scope));
  return scopeCleanupPlanSchema.parse({ version: SCOPE_CLEANUP_PLAN_VERSION, operationId, scope, chats, bases,
    projectIds: projects.filter(project => retainedProjects.has(project.id)).map(project => project.id),
    discardedProjectIds: projects.filter(project => !retainedProjects.has(project.id)).map(project => project.id),
    appIds: appEntries.filter(entry => installed.has(entry.descriptor.appId)).map(entry => entry.descriptor.appId),
    discardedAppIds: [...new Set([...appEntries, ...pendingApps].filter(entry => !installed.has(entry.descriptor.appId)).map(entry => entry.descriptor.appId))],
    retainedBlobs: [], participants: [...CLEANUP_PARTICIPANTS] });
}
