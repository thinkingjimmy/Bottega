/**
 * [INPUT]: Depends on portable Project metadata, local scoped associations and immutable wire hashes.
 * [OUTPUT]: Derives same-commit causal metadata intents and fences removed, pending-delete and deleted Project identities.
 * [POS]: Pure ProjectStore commit collaborator; never writes files or performs network calls.
 */
import { createHash, randomUUID } from "node:crypto";
import { canonicalJson, portableProjectSchema, projectMetadataSchema, projectOperationContent, projectOperationSchema,
  type PortableProject, type ProjectMetadataPatch, type ProjectOperation } from "@ai-chat/cloud-protocol";
import { sameScope, type StorageMode, type SyncScope } from "../../../../../shared/local-storage/contracts";
import { enrollmentOpen } from "../../../../../shared/local-storage/scope-mode";
import type { ProjectFile, StoredProject } from "../project-store-schema";
import { projectSyncAssociationSchema, type ProjectSyncAssociation } from "./contract";
const fields = ["name", "sortIndex", "appearance", "archivedAt", "gitRemote"] as const;
export function exportProject(project: StoredProject): PortableProject {
  return portableProjectSchema.parse({ id: project.id, name: project.name, sortIndex: project.sortIndex,
    ...(project.gitRemote ? { gitRemote: project.gitRemote } : {}),
    ...(project.appearance ? { appearance: project.appearance } : {}),
    ...(project.archivedAt === undefined ? {} : { archivedAt: project.archivedAt }),
    createdAt: project.createdAt, updatedAt: project.updatedAt, role: project.role,
    appId: project.workspaceBinding.kind === "app" ? project.workspaceBinding.appId : null, cloudRevision: project.sync?.cloudRevision ?? 0 });
}
export function metadataChanges(before: PortableProject, after: PortableProject): ProjectMetadataPatch | null {
  const changes = Object.fromEntries(fields.filter(key => canonicalJson(before[key] ?? null) !== canonicalJson(after[key] ?? null))
    .map(key => [key, after[key] ?? null])) as ProjectMetadataPatch;
  return Object.keys(changes).length ? changes : null;
}
export function applyMetadata(project: PortableProject, changes: ProjectMetadataPatch): PortableProject {
  const next = { ...project, ...changes };
  if (next.appearance === null) delete next.appearance;
  if (next.archivedAt === null) delete next.archivedAt;
  if (next.gitRemote === null) delete next.gitRemote;
  return portableProjectSchema.parse(next);
}
export function freezeOperation(input: Omit<ProjectOperation, "payloadHash">): ProjectOperation {
  const operation = projectOperationSchema.parse({ ...input, payloadHash: "0".repeat(64) });
  operation.payloadHash = createHash("sha256").update(projectOperationContent(operation)).digest("hex");
  return operation;
}
export function enrollProject(project: StoredProject, scope: SyncScope, operationId: string): StoredProject {
  if (project.sync || project.role !== "workspace" || project.workspaceBinding.kind === "app" || project.deletionCheckpoint) throw new Error("PROJECT_INITIAL_IDENTITY_CONFLICT");
  const portable = exportProject(project), operation = freezeOperation({ operationId, projectId: project.id,
    command: { kind: "create", metadata: projectMetadataSchema.parse(Object.fromEntries(fields.filter(key => portable[key] !== undefined).map(key => [key, portable[key]]))),
      createdAt: project.createdAt } });
  return { ...project, sync: projectSyncAssociationSchema.parse({ scope, cloudRevision: 0, operationId,
    payloadHash: operation.payloadHash, retention: "local", pending: [{ operation, predecessorId: null, attempts: 0, state: "queued" }] }) };
}
export function withProjection(project: StoredProject, sync: ProjectSyncAssociation): StoredProject {
  if (!sync.confirmed) return { ...project, sync };
  let visible = sync.confirmed;
  for (const pending of sync.pending) if (pending.state === "queued" && pending.operation.command.kind === "patch") visible = applyMetadata(visible, pending.operation.command.changes);
  const { appearance: _appearance, archivedAt: _archivedAt, gitRemote: _gitRemote, ...local } = project;
  return { ...local, name: visible.name, sortIndex: visible.sortIndex,
    ...(visible.gitRemote ? { gitRemote: visible.gitRemote } : {}),
    ...(visible.appearance ? { appearance: visible.appearance } : {}), ...(visible.archivedAt === undefined ? {} : { archivedAt: visible.archivedAt }),
    updatedAt: sync.pending.some(item => item.state === "queued") ? Math.max(visible.updatedAt, project.updatedAt) : visible.updatedAt, sync };
}
export function captureProjectMutations(previous: ProjectFile, next: ProjectFile, mode: StorageMode): ProjectFile {
  for (const project of previous.projects) if (project.sync && !project.sync.deleted && !next.projects.some(item => item.id === project.id)) throw new Error("PROJECT_REMOVAL_REQUIRES_CLOUD_HANDOFF");
  return { ...next, projects: next.projects.map(project => {
    if (project.localRecoveryId) return project;
    const before = previous.projects.find(item => item.id === project.id);
    if (!before?.sync) {
      if (!before && mode.kind !== "local-only" && enrollmentOpen(mode) && project.role === "workspace" && project.workspaceBinding.kind !== "app") return enrollProject(project, mode.scope, randomUUID());
      return project;
    }
    if (mode.kind === "local-only" || !sameScope(before.sync.scope, mode.scope)) throw new Error("PROJECT_SYNC_SCOPE_UNAVAILABLE");
    const initial = exportProject(before), current = exportProject(project);
    if (initial.role !== current.role || initial.appId !== current.appId) throw new Error("PROJECT_LIFECYCLE_REQUIRES_CLOUD_RECEIPT");
    const changes = metadataChanges(initial, current);
    if (!changes) return project.dir || project.grants.length || project.resourceAdmissions.length
      ? { ...project, sync: { ...before.sync, retention: "local" } } : project;
    if (before.sync.deleted) throw new Error("PROJECT_DELETED");
    if (before.sync.pending.some(item => item.operation.command.kind === "delete")) throw new Error("PROJECT_DELETION_PENDING");
    if (initial.appId || initial.role !== "workspace") throw new Error("PROJECT_APP_METADATA_REQUIRES_LIFECYCLE");
    if (before.sync.conflicts.length || before.sync.pending.some(item => item.state === "blocked")) throw new Error("PROJECT_CONFLICT_REQUIRES_RESOLUTION");
    const sync = structuredClone(before.sync), operation = freezeOperation({ operationId: randomUUID(), projectId: project.id,
      command: { kind: "patch", expectedRevision: sync.cloudRevision, changes } });
    sync.pending.push({ operation, predecessorId: sync.pending.at(-1)?.operation.operationId ?? null, attempts: 0, state: "queued" });
    sync.retention = "local";
    return { ...project, sync };
  }) };
}
