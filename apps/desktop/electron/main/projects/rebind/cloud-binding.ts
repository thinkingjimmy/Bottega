/**
 * [INPUT]: Depends on the existing Project service queue, native folder picker and scoped portable owner.
 * [OUTPUT]: Binds an unbound Project — restored locally or synchronized — to an explicitly selected local directory with capture/recheck fences, and records the directory as this machine's hint.
 * [POS]: Initial local binding adapter; existing workspace replacements keep using the Memory-aware rebind saga.
 */
import { randomUUID } from "node:crypto";
import { realpath } from "node:fs/promises";
import { canonicalJson, sameScope, type SyncScope } from "../../../../shared/local-storage/contracts";
import { assertWorkspaceDisjoint, isUsableDirectory } from "../fs-utils";
import type { ProjectsService } from "../projects-service";
type BindingGate = Pick<ProjectsService, "store" | "runExclusive" | "prepareExternalProject" | "assertProjectOpen" | "assertNoMemoryRebind" | "managedDirs" | "emit" | "withMissing"> &
  { options: Pick<ProjectsService["options"], "hasActiveTurnsByProject" | "hasPendingProjectCreation"> };
/** Both folderless states are bindable: `unbound` asks for a folder, `none` accepts one when the cloud offers it. */
const BINDABLE = new Set(["unbound", "none"]);
function inspect(service: BindingGate, projectId: string, scope?: SyncScope) {
  service.assertProjectOpen(projectId); service.assertNoMemoryRebind(projectId);
  const project = service.store.get(projectId);
  if (!project || project.deletionCheckpoint || !BINDABLE.has(project.workspaceBinding.kind) || project.role === "base-custody" ||
    scope && (!project.sync || !sameScope(project.sync.scope, scope)) ||
    service.options.hasActiveTurnsByProject(projectId) || service.options.hasPendingProjectCreation?.(projectId)) throw new Error("PROJECT_BINDING_CHANGED");
  return { id: project.id, lifecycle: project.projectLifecycleRevision, membership: project.membershipRevision, binding: project.workspaceBinding };
}
/* The picker runs outside the queue, so the binding it was asked about may be gone by the time the user
   answers. Capturing the identity before and re-reading it after is the whole fence. */
async function bindPickedFolder(service: BindingGate, projectId: string, read: () => ReturnType<typeof inspect>, current: () => Promise<void>) {
  const captured = await service.runExclusive(async () => { await current(); return read(); });
  const selected = await service.prepareExternalProject(); if (!selected) return null;
  const directory = await realpath(selected.canonicalRoot);
  return service.runExclusive(async () => {
    await current(); if (canonicalJson(read()) !== canonicalJson(captured)) throw new Error("PROJECT_BINDING_CHANGED");
    if (!isUsableDirectory(directory) || service.store.findByDir(directory)) throw new Error("PROJECT_FOLDER_UNAVAILABLE");
    assertWorkspaceDisjoint(directory, service.managedDirs());
    const project = await service.store.setWorkspaceBinding(projectId, { kind: "external", capabilityId: randomUUID() }, directory);
    // Remembered for this machine, not this profile: the next profile restores the same directory without asking again.
    await service.store.rememberLocalHint(projectId, directory);
    const wire = service.withMissing(project);
    service.emit({ type: "upserted", project: wire }); return wire;
  });
}
export async function bindCloudProject(service: BindingGate, projectId: string, scope: SyncScope, current: () => Promise<void>) {
  return Boolean(await bindPickedFolder(service, projectId, () => inspect(service, projectId, scope), current));
}
/** Sidebar "Choose folder…" for a Project restored without this computer's workspace row. */
export function bindRestoredProject(service: BindingGate, projectId: string) {
  return bindPickedFolder(service, projectId, () => inspect(service, projectId), async () => {});
}
