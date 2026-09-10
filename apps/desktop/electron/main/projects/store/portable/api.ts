/**
 * [INPUT]: Depends on the ProjectStore queue/commit port and portable allowlist.
 * [OUTPUT]: Provides idempotent remote identity admission, unbound projection and scope detachment.
 * [POS]: ProjectStore collaborator; local workspace rebinding remains in the existing rebind lifecycle.
 */
import { createHash } from "node:crypto";
import { canonicalJson, sameScope, storageModeSchema, syncScopeSchema, type StorageMode, type SyncScope } from "../../../../../shared/local-storage/contracts";
import { storedProjectSchema, type ProjectFile, type StoredProject } from "../project-store-schema";
import { portableProjectSchema, type PortableProject } from "./contract";

type Ports = { enqueue<T>(operation: () => Promise<T>): Promise<T>; state(): ProjectFile; commit(file: ProjectFile): Promise<void> };
export class ProjectPortableApi {
  private mode: StorageMode;
  constructor(private ports: Ports, mode: StorageMode = { kind: "local-only" }) {
    this.mode = storageModeSchema.parse(mode);
    if (mode.kind === "fixture" && process.versions.electron) throw new Error("FIXTURE_MODE_UNAVAILABLE");
  }
  private assertScope(scope: SyncScope) {
    if (this.mode.kind === "local-only" || !sameScope(this.mode.scope, scope)) throw new Error("PROJECT_SYNC_SCOPE_UNAVAILABLE");
  }
  export(project: StoredProject): PortableProject {
    return portableProjectSchema.parse({ id: project.id, name: project.name, sortIndex: project.sortIndex,
      appearance: project.appearance, createdAt: project.createdAt, updatedAt: project.updatedAt, role: project.role,
      appId: project.workspaceBinding.kind === "app" ? project.workspaceBinding.appId : null, cloudRevision: project.sync?.cloudRevision ?? 0 });
  }
  accept(scopeInput: SyncScope, operationId: string, input: PortableProject) {
    return this.ports.enqueue(async () => {
      this.assertScope(scopeInput);
      const scope = syncScopeSchema.parse(scopeInput), portable = portableProjectSchema.parse(input);
      const hash = createHash("sha256").update(canonicalJson({ scope, operationId, portable })).digest("hex");
      const state = this.ports.state();
      if (state.deletionReceipts.some(receipt => receipt.projectId === portable.id)) throw new Error("PROJECT_DELETED");
      const current = state.projects.find(project => project.id === portable.id);
      if (current) {
        if (!current.sync || !sameScope(current.sync.scope, scope)) throw new Error("PROJECT_IDENTITY_CONFLICT");
        if (current.sync.cloudRevision >= portable.cloudRevision) {
          if (current.sync.payloadHash !== hash) throw new Error("PROJECT_REVISION_CONFLICT");
          return structuredClone(current);
        }
        if (current.deletionCheckpoint || (current.workspaceBinding.kind === "app" ? current.workspaceBinding.appId : null) !== portable.appId || current.role !== portable.role) throw new Error("PROJECT_LIFECYCLE_CONFLICT");
      }
      const project = storedProjectSchema.parse({
        ...(current ?? { dir: "", workspaceBinding: portable.appId ? { kind: "app", appId: portable.appId } : { kind: "none" },
          nameSource: portable.appId ? "app" : "user", appPlacements: [], grants: [], grantRevision: 0, membershipRevision: 0,
          projectLifecycleRevision: state.lifecycleSequence + 1, resourceAdmissions: [] }),
        id: portable.id, name: portable.name, sortIndex: portable.sortIndex, ...(portable.appearance ? { appearance: portable.appearance } : {}),
        createdAt: portable.createdAt, updatedAt: portable.updatedAt, role: portable.role,
        sync: { scope, operationId, payloadHash: hash, cloudRevision: portable.cloudRevision },
      });
      await this.ports.commit({ ...state, lifecycleSequence: Math.max(state.lifecycleSequence, project.projectLifecycleRevision),
        projects: current ? state.projects.map(item => item.id === project.id ? project : item) : [...state.projects, project] });
      return structuredClone(project);
    });
  }
  detachScope(scope: SyncScope) {
    return this.ports.enqueue(async () => {
      const state = this.ports.state();
      const projects = state.projects.map(project => {
        if (!project.sync || !sameScope(project.sync.scope, scope)) return project;
        const { sync: _sync, ...local } = project;
        return storedProjectSchema.parse(local);
      });
      await this.ports.commit({ ...state, projects });
    });
  }
}
