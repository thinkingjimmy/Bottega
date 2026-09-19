/**
 * [INPUT]: Depends on canonical Chat/Base/Project/App stores, verified Home ownership and byte-owner proofs
 * [OUTPUT]: Builds every mandatory cleanup participant from real owner operations and frozen retained identities
 * [POS]: Leaf adapter composition beneath ScopeCleanupCoordinator; retained local data is never compensated away
 */
import { sameScope } from "../../../../shared/local-storage/contracts";
import type { ChatStore } from "../../chats/chat-store";
import type { BaseStore } from "../../bases/base-store";
import type { ProjectStore } from "../../projects/store/project-store";
import type { AppStore } from "../../apps/store/app-store";
import type { ChatHomeService } from "../../chat-home/chat-home-service";
import { cloudRequestHash } from "../../chats/store/sync/api";
import type { CleanupParticipants } from "./coordinator";
import type { ScopeCleanupPlan } from "./model";
export function storageCleanupParticipants(owners: {
  chats: ChatStore; bases: BaseStore; projects: ProjectStore; apps: AppStore; homes: ChatHomeService;
  verifyBlob(blob: ScopeCleanupPlan["retainedBlobs"][number]): Promise<unknown>;
}): CleanupParticipants {
  return {
    homes: async plan => {
      const proofs = [];
      for (const chat of plan.chats) if (chat.retain && chat.homeIntentId) {
        const proof = await owners.homes.committedCreationEvidence(chat.chatId, chat.homeIntentId);
        if (proof.receipt.incarnationId !== chat.incarnationId) throw new Error("CLEANUP_HOME_IDENTITY_CHANGED");
        proofs.push(proof);
      }
      return proofs;
    },
    blobs: async plan => {
      const proofs = [];
      for (const blob of plan.retainedBlobs) proofs.push(await owners.verifyBlob(blob));
      return proofs;
    },
    bases: async plan => {
      const changed = owners.bases.listAll().filter(({ ownerKey, snapshot }) => sameScope(owners.bases.sync.read(ownerKey, snapshot.meta.ownerInstanceId).scope, plan.scope));
      if (changed.some(({ ownerKey, snapshot }) => !plan.bases.some(base => base.ownerKey === ownerKey && base.ownerInstanceId === snapshot.meta.ownerInstanceId))) throw new Error("CLEANUP_BASE_PLAN_INCOMPLETE");
      const proofs = [];
      for (const base of plan.bases) {
        const current = owners.bases.get(base.ownerKey, base.ownerInstanceId);
        if (!current) {
          if (base.retain) throw new Error("CLEANUP_BASE_UNAVAILABLE");
          proofs.push({ ...base, removed: true }); continue;
        }
        if (base.retain) {
          const retainedApp = owners.apps.portable.list().find(entry => sameScope(entry.scope, plan.scope) &&
            entry.deletion?.retainBase && entry.deletion.baseId === base.ownerInstanceId)?.deletion;
          const deleted = owners.bases.sync.read(base.ownerKey, base.ownerInstanceId).tombstones.includes("base");
          await owners.bases.sync.cleanup(base.ownerKey, base.ownerInstanceId, plan.scope, true, deleted ? undefined : retainedApp);
        }
        else {
          const envelope = owners.bases.sync.read(base.ownerKey, base.ownerInstanceId);
          if (envelope.cloudState !== "mirror" || !sameScope(envelope.scope, plan.scope)) throw new Error("CLEANUP_BASE_RETENTION_CHANGED");
          await owners.bases.remove(base.ownerKey, base.ownerInstanceId);
        }
        proofs.push({ ...base, local: base.retain });
      }
      return proofs;
    },
    projects: async plan => {
      const changed = owners.projects.list().filter(project => project.sync && sameScope(project.sync.scope, plan.scope));
      if (changed.some(project => ![...plan.projectIds, ...(plan.discardedProjectIds ?? [])].includes(project.id))) throw new Error("CLEANUP_PROJECT_PLAN_INCOMPLETE");
      const retainedApps = owners.apps.portable.list().flatMap(entry => sameScope(entry.scope, plan.scope) && entry.deletion?.retainBase ? [entry.deletion] : []);
      await owners.projects.portable.detachScope(plan.scope, plan.discardedProjectIds, retainedApps);
      return { retained: plan.projectIds };
    },
    apps: async plan => {
      const changed = [...owners.apps.portable.list(), ...owners.apps.portable.pending()].filter(entry => sameScope(entry.scope, plan.scope));
      if (changed.some(entry => ![...plan.appIds, ...(plan.discardedAppIds ?? [])].includes(entry.descriptor.appId))) throw new Error("CLEANUP_APP_PLAN_INCOMPLETE");
      await owners.apps.portable.detachScope(plan.scope, plan.discardedAppIds);
      return { retained: plan.appIds };
    },
    chats: async plan => {
      for (const chat of plan.chats) {
        const current = owners.chats.getMetadata(chat.chatId);
        if (current && (!chat.retain || current.incarnationId !== chat.incarnationId)) throw new Error("CLEANUP_CHAT_IDENTITY_CHANGED");
      }
      const receipt = await owners.chats.sync.mutate(plan.scope, cloudRequestHash({ cleanup: plan.operationId }), {
        type: "cleanup-scope", retainedChatIds: plan.chats.filter(chat => chat.retain).map(chat => chat.chatId),
      });
      return { operationId: receipt.operationId, requestHash: receipt.requestHash };
    },
  };
}
