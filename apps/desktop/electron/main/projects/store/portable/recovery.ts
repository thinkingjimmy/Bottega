/**
 * [INPUT]: Depends on the ProjectStore file, original recovery identity and ordinary Project creation outbox.
 * [OUTPUT]: Plans one unbound recovery Project or verifies its original creation receipt on retry.
 * [POS]: Pure Project creation leaf; it cannot acquire a workspace, App binding or an existing unrelated Project.
 */
import { sameScope, type SyncScope } from "../../../../../shared/local-storage/contracts";
import { storedProjectSchema, type ProjectFile } from "../project-store-schema";
import { enrollProject } from "./queue";
import { createHash } from "node:crypto";
import { canonicalJson } from "../../../../../shared/local-storage/contracts";
import { allocateForkTitle } from "../../../chats/chat-fork";
export function retainDeletedProject(state: ProjectFile, scope: SyncScope, projectId: string) {
  const source = state.projects.find(project => project.id === projectId);
  if (!source || source.role !== "workspace" || source.workspaceBinding.kind === "app" && source.sync || source.deletionCheckpoint) throw new Error("PROJECT_DELETION_IDENTITY_CHANGED");
  if (source.sync?.deleted) return state;
  if (source.sync && !sameScope(source.sync.scope, scope)) throw new Error("PROJECT_SYNC_SCOPE_UNAVAILABLE");
  const identity = createHash("sha256").update(canonicalJson([scope, projectId, "deleted-folder-project"])).digest("hex");
  const original = source.sync ? structuredClone(source) : { ...source,
    sync: enrollProject({ ...source, workspaceBinding: { kind: "none" } }, scope, identity).sync };
  original.sync!.deleted = true;
  for (const pending of original.sync!.pending) pending.state = "blocked";
  const projects = state.projects.map(project => project.id === projectId ? original : project);
  if (source.sync?.confirmed) return { ...state, projects };
  const id = `recovered_${identity.slice(0, 32)}`;
  if (projects.some(project => project.id === id)) return { ...state, projects };
  const { sync: _sync, deletionCheckpoint: _deletion, ...portable } = source;
  const child = storedProjectSchema.parse({ ...portable, id,
    name: allocateForkTitle(source.name.slice(0, 90), projects.map(project => project.name)), archivedAt: undefined,
    dir: "", workspaceBinding: { kind: "none" }, nameSource: "user", appPlacements: [], grants: [], resourceAdmissions: [],
    grantRevision: 0, membershipRevision: 0, projectLifecycleRevision: state.lifecycleSequence + 1 });
  return { ...state, lifecycleSequence: child.projectLifecycleRevision, projects: [...projects, child] };
}
export function recoveredBaseProject(state: ProjectFile, scope: SyncScope, input: { recoveryId: string; projectId: string; name: string; localOnly?: boolean }) {
  if (state.deletionReceipts.some(receipt => receipt.projectId === input.projectId)) throw new Error("BASE_CANDIDATE_COPY_PROJECT_WAS_DELETED");
  const existing = state.projects.find(project => project.id === input.projectId);
  if (existing) {
    if (input.localOnly && existing.localRecoveryId === input.recoveryId && !existing.sync && !existing.deletionCheckpoint && existing.workspaceBinding.kind === "none") return { state, project: existing };
    const sync = existing.sync;
    const creation = sync?.pending.find(item => item.operation.operationId === input.recoveryId);
    const receipt = sync?.receipts.find(item => item.operationId === input.recoveryId);
    if (!sync || !sameScope(sync.scope, scope) || sync.deleted || existing.deletionCheckpoint || existing.role !== "workspace" ||
      existing.workspaceBinding.kind === "app" || !creation && !receipt || creation && creation.operation.command.kind !== "create" ||
      receipt && !["applied", "converged"].includes(receipt.status)) throw new Error("BASE_CANDIDATE_COPY_PROJECT_CHANGED");
    return { state, project: existing };
  }
  const now = Date.now();
  const local = storedProjectSchema.parse({ id: input.projectId,
    ...(input.localOnly ? { localRecoveryId: input.recoveryId } : {}), name: input.name, dir: "", workspaceBinding: { kind: "none" },
    role: "workspace", nameSource: "user", appPlacements: [], sortIndex: state.projects.reduce((maximum, item) => Math.max(maximum, item.sortIndex), -1) + 1,
    createdAt: now, updatedAt: now, grants: [], grantRevision: 0, membershipRevision: 0, projectLifecycleRevision: state.lifecycleSequence + 1 });
  const project = input.localOnly ? local : enrollProject(local, scope, input.recoveryId);
  return { project, state: { ...state, lifecycleSequence: project.projectLifecycleRevision, projects: [...state.projects, project] } };
}
