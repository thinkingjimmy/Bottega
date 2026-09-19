/**
 * [INPUT]: Depends on actual Store read models and existing native Chat/Project/Base event publishers.
 * [OUTPUT]: Publishes only changed sync projections through the same renderer event channels as local editing.
 * [POS]: Main cloud UI adapter; it does not send full rows or create another renderer data source.
 */
import type { CleanupOwners } from "../sync/account/cleanup/plan";
import type { ChatsService } from "../../chats/chats-service";
import type { ProjectsService } from "../../projects/projects-service";
import type { BasesService } from "../../bases/bases-service";
export type SyncEventPorts = { chats: Pick<ChatsService, "publishUpserted">; projects: Pick<ProjectsService, "publishStored">; bases: Pick<BasesService, "publishEvent"> };
export function syncStoreEvents(owners: CleanupOwners, events: SyncEventPorts) {
  // Rebuilt per publish so removed rows leave the map instead of accumulating for the process lifetime.
  let previous = new Map<string, string>();
  return () => {
    const current = new Map<string, string>();
    const changed = (key: string, value: unknown) => { const encoded = JSON.stringify(value);
      current.set(key, encoded); return previous.get(key) !== encoded; };
    for (const chat of owners.chats.list()) if (changed(`chat:${chat.id}`, chat)) events.chats.publishUpserted(chat);
    for (const project of owners.projects.list()) if (changed(`project:${project.id}`, project)) events.projects.publishStored(project.id);
    for (const { ownerKey, snapshot } of owners.bases.listAll()) if (changed(`base:${ownerKey}`, [snapshot.meta.ownerInstanceId, snapshot.meta.revision])) {
      events.bases.publishEvent({ type: "base-changed", ownerKey, ownerInstanceId: snapshot.meta.ownerInstanceId, revision: snapshot.meta.revision });
    }
    previous = current;
  };
}
