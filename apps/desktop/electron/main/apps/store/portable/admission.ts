/**
 * [INPUT]: Depends on canonical AppStore, ProjectStore and BaseStore facades.
 * [OUTPUT]: Provides restartable fixed-ID BaseApp admission without package seed or permission transfer, preserving existing confirmed Project metadata.
 * [POS]: Cross-store driver; each leaf commit checkpoints back into the AppStore-owned intent.
 */
import { canonicalJson, sameScope, type SyncScope } from "../../../../../shared/local-storage/contracts";
import type { AppStore } from "../app-store";
import type { ProjectStore } from "../../../projects/store/project-store";
import type { BaseStore } from "../../../bases/base-store";
import type { AppDescriptor } from "./model";

export class PortableAppAdmission {
  constructor(private apps: AppStore, private projects: ProjectStore, private bases: BaseStore) {}
  async accept(scope: SyncScope, operationId: string, descriptor: AppDescriptor) {
    let intent = this.apps.portable.admission(operationId);
    if (!intent) intent = await this.apps.portable.begin(scope, operationId, descriptor, {
      baseExists: true, projectExists: Boolean(this.projects.get(descriptor.projectId)),
    });
    else if (canonicalJson(intent.descriptor) !== canonicalJson(descriptor) || !sameScope(intent.scope, scope)) throw new Error("App admission identity changed");
    if (intent.state === "complete") return this.apps.portable.get(descriptor.appId);
    if (!intent.completed.includes("project")) {
      const project = this.projects.get(descriptor.projectId);
      if (project && !project.sync && project.workspaceBinding.kind === "app" && project.workspaceBinding.appId === descriptor.appId) {
        await this.projects.portable.accept(scope, operationId, { id: descriptor.projectId, name: descriptor.name, sortIndex: project.sortIndex,
          createdAt: descriptor.createdAt, updatedAt: descriptor.updatedAt, role: "workspace", appId: descriptor.appId, cloudRevision: descriptor.cloudRevision });
      } else if (project) {
        if (!project.sync || !sameScope(project.sync.scope, scope) || project.workspaceBinding.kind !== "app" ||
            project.workspaceBinding.appId !== descriptor.appId) throw new Error("APP_PROJECT_IDENTITY_CONFLICT");
      } else await this.projects.portable.accept(scope, operationId, { id: descriptor.projectId, name: descriptor.name, sortIndex: 0,
        createdAt: descriptor.createdAt, updatedAt: descriptor.updatedAt, role: "workspace", appId: descriptor.appId, cloudRevision: descriptor.cloudRevision });
      intent = await this.apps.portable.checkpoint(operationId, "project");
    }
    if (!intent.completed.includes("base")) {
      const base = this.bases.get(`project:${descriptor.projectId}`);
      if (base && base.meta.ownerInstanceId !== descriptor.baseId) throw new Error("APP_BASE_IDENTITY_CONFLICT");
      if (base && this.bases.sync.read(`project:${descriptor.projectId}`, descriptor.baseId).tombstones.includes("base")) throw new Error("APP_BASE_DELETED");
      // A known remote identity is never initialized from seed, including while its snapshot is absent.
      intent = await this.apps.portable.checkpoint(operationId, "base");
    }
    if (!intent.completed.includes("descriptor")) await this.apps.portable.checkpoint(operationId, "descriptor");
    return this.apps.portable.get(descriptor.appId);
  }
  async recover() {
    for (const intent of this.apps.portable.pending()) await this.accept(intent.scope, intent.operationId, intent.descriptor);
  }
}
