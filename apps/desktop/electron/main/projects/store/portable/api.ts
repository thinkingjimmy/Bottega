/**
 * [INPUT]: Depends on the ProjectStore queue/commit port and portable allowlist.
 * [OUTPUT]: Provides scoped capture, original deletion/keep recovery, unbound projections and creation/promotion/deletion proof enrollment of local App Projects.
 * [POS]: ProjectStore collaborator; local workspace rebinding remains in the existing rebind lifecycle.
 */
import { createHash, randomUUID } from "node:crypto";
import { confirmedBasePromotionSchema, type ConfirmedBasePromotion } from "../../../bases/store/promotion/cloud";
import { canonicalJson, sameScope, storageModeSchema, syncScopeSchema, type StorageMode, type SyncScope } from "../../../../../shared/local-storage/contracts";
import { storedProjectSchema, type ProjectFile, type StoredProject } from "../project-store-schema";
import { portableProjectSchema, projectSyncAssociationSchema, type PortableProject } from "./contract";
import { enrollmentOpen, transitionStorageMode } from "../../../../../shared/local-storage/scope-mode";
import type { RuntimeStorageMode } from "../../../../../shared/local-storage/contracts";
import { projectReceiptSchema, type ProjectMetadataPatch, type ProjectReceipt } from "@ai-chat/cloud-protocol";
import { applyMetadata, captureProjectMutations, enrollProject, exportProject, freezeOperation, metadataChanges, withProjection } from "./queue";
import { appDeletionSchema, appOperationSchema, appReceiptSchema, type CloudAppDeletion, type AppOperation, type AppReceipt } from "@ai-chat/cloud-protocol/apps/model";
import { planBaseCustody } from "../../rebind/project-workspace-policy";
import { recoveredBaseProject, retainDeletedProject } from "./recovery";
import { resolveProjectDeletion } from "./deletion";
import type { ProjectDeletionDecision } from "../../../../../shared/cloud/projects/deletion";
import { frozenProjectOperationSchema, verifyProjectOperation, type FrozenProjectOperation } from "@ai-chat/cloud-protocol/projects/encrypted";

type Ports = { enqueue<T>(operation: () => Promise<T>): Promise<T>; state(): ProjectFile; commit(file: ProjectFile): Promise<void> };
export class ProjectPortableApi {
  private mode: StorageMode;
  constructor(private ports: Ports, mode: StorageMode = { kind: "local-only" }) {
    this.mode = storageModeSchema.parse(mode);
    if (mode.kind === "fixture" && process.versions.electron) throw new Error("FIXTURE_MODE_UNAVAILABLE");
  }
  configureMode(mode: RuntimeStorageMode) {
    return this.ports.enqueue(async () => {
      this.mode = transitionStorageMode(this.mode, mode, this.ports.state().projects.map(project => project.sync?.scope ?? null));
    });
  }
  private assertScope(scope: SyncScope, closing = false) {
    if (this.mode.kind === "local-only" || !sameScope(this.mode.scope, scope) || !closing && !enrollmentOpen(this.mode)) throw new Error("PROJECT_SYNC_SCOPE_UNAVAILABLE");
  }
  export(project: StoredProject) { return exportProject(project); }
  ensureRecoveredBaseProject(scope: SyncScope, input: { recoveryId: string; projectId: string; name: string; localOnly?: boolean }) {
    return this.ports.enqueue(async () => {
      this.assertScope(scope);
      const previous = this.ports.state(), result = recoveredBaseProject(previous, scope, input);
      if (result.state !== previous) await this.ports.commit(result.state);
      return structuredClone(result.project);
    });
  }
  captureMutations(previous: ProjectFile, next: ProjectFile) { return captureProjectMutations(previous, next, this.mode); }
  captureInitial(scope: SyncScope, projectId: string, manifestId: string) {
    return this.ports.enqueue(async () => {
      this.assertScope(scope);
      const state = this.ports.state(), current = state.projects.find(project => project.id === projectId);
      if (!current) throw new Error("PROJECT_NOT_FOUND");
      if (current.sync) {
        if (!sameScope(current.sync.scope, scope) || current.sync.retention !== "local") throw new Error("PROJECT_INITIAL_IDENTITY_CONFLICT");
        return structuredClone(current.sync);
      }
      const operationId = createHash("sha256").update(canonicalJson({ scope, manifestId, projectId })).digest("hex");
      const project = enrollProject(current, scope, operationId);
      await this.ports.commit({ ...state, projects: state.projects.map(item => item.id === projectId ? project : item) });
      return structuredClone(project.sync!);
    });
  }
  read(scope: SyncScope, projectId: string) {
    this.assertScope(scope, true);
    const project = this.ports.state().projects.find(item => item.id === projectId);
    if (!project?.sync || !sameScope(project.sync.scope, scope)) throw new Error("PROJECT_SYNC_SCOPE_UNAVAILABLE");
    return structuredClone(project.sync);
  }
  freezeCiphertext(scope: SyncScope, projectId: string, input: FrozenProjectOperation) {
    return this.ports.enqueue(async () => {
      this.assertScope(scope);
      const binding = frozenProjectOperationSchema.parse(input), state = this.ports.state(), sync = this.read(scope, projectId);
      verifyProjectOperation(binding.transport, binding.encryptedSpace.scope);
      const prior = sync.ciphertextBindings.find(item => item.transport.operationId === binding.transport.operationId);
      if (prior) {
        if (prior.plaintextHash !== binding.plaintextHash || canonicalJson(prior.encryptedSpace) !== canonicalJson(binding.encryptedSpace)) throw new Error("PROJECT_CIPHERTEXT_IDENTITY_CHANGED");
        return structuredClone(prior);
      }
      const pending = sync.pending.find(item => item.operation.operationId === binding.transport.operationId);
      if (!pending || pending.attempts || pending.predecessorId || pending.state !== "queued" || sync.deleted ||
        pending.operation.payloadHash !== binding.plaintextHash || binding.transport.projectId !== projectId) throw new Error("PROJECT_CIPHERTEXT_IDENTITY_CHANGED");
      sync.ciphertextBindings.push(binding);
      await this.ports.commit({ ...state, projects: state.projects.map(item => item.id === projectId ? { ...item, sync } : item) });
      return structuredClone(binding);
    });
  }
  seal(scope: SyncScope, projectId: string, operationId: string, ciphertextHash?: string) {
    return this.ports.enqueue(async () => {
      this.assertScope(scope);
      const state = this.ports.state(), sync = this.read(scope, projectId);
      const pending = sync.pending.find(item => item.operation.operationId === operationId);
      if (!pending || pending.predecessorId || pending.state !== "queued" || sync.deleted) throw new Error("PROJECT_CAUSAL_RECEIPT_REQUIRED");
      if (ciphertextHash !== undefined && !sync.ciphertextBindings.some(item => item.transport.operationId === operationId &&
        item.transport.ciphertextHash === ciphertextHash && item.plaintextHash === pending.operation.payloadHash)) throw new Error("PROJECT_CIPHERTEXT_REQUIRED");
      pending.attempts++;
      await this.ports.commit({ ...state, projects: state.projects.map(item => item.id === projectId ? { ...item, sync } : item) });
      return structuredClone(pending.operation);
    });
  }
  confirm(scope: SyncScope, input: ProjectReceipt, ciphertextHash?: string) {
    return this.ports.enqueue(async () => {
      const receipt = projectReceiptSchema.parse(input), state = this.ports.state(), sync = this.read(scope, receipt.projectId);
      if (ciphertextHash !== undefined && !sync.ciphertextBindings.some(item => item.transport.operationId === receipt.operationId &&
        item.transport.ciphertextHash === ciphertextHash && item.plaintextHash === receipt.payloadHash)) throw new Error("PROJECT_CIPHERTEXT_RECEIPT_CHANGED");
      const prior = sync.receipts.find(item => item.operationId === receipt.operationId);
      if (prior) {
        if (canonicalJson(prior) !== canonicalJson(receipt)) throw new Error("PROJECT_RECEIPT_CHANGED");
        return prior;
      }
      const pending = sync.pending.find(item => item.operation.operationId === receipt.operationId);
      if (!pending || !pending.attempts || pending.operation.payloadHash !== receipt.payloadHash || receipt.project && receipt.project.id !== receipt.projectId) throw new Error("PROJECT_RECEIPT_IDENTITY_MISMATCH");
      const deleted = receipt.status === "deleted", failed = receipt.status === "conflicted" || deleted && pending.operation.command.kind !== "delete";
      sync.pending = sync.pending.filter(item => item !== pending);
      sync.receipts.push(receipt); sync.operationId = receipt.operationId; sync.payloadHash = receipt.payloadHash;
      if (pending.operation.command.kind === "create" && receipt.status === "conflicted" && receipt.project) {
        // A copied folder has no cloud field baseline. Its old values cannot become patches against today's head.
        sync.confirmed = receipt.project; sync.cloudRevision = receipt.project.cloudRevision;
        sync.pending = []; sync.conflicts = [];
        await this.ports.commit({ ...state, projects: state.projects.map(item => item.id === receipt.projectId ? withProjection(item, sync) : item) });
        return receipt;
      }
      if (!(pending.operation.command.kind === "create" && failed) && receipt.project && receipt.project.cloudRevision >= sync.cloudRevision) {
        if (sync.confirmed && receipt.project.cloudRevision === sync.cloudRevision && canonicalJson(sync.confirmed) !== canonicalJson(receipt.project)) throw new Error("PROJECT_REVISION_CONFLICT");
        sync.confirmed = receipt.project; sync.cloudRevision = receipt.project.cloudRevision;
      }
      if (failed || deleted) {
        if (failed) sync.conflicts.push({ operation: pending.operation, receipt });
        for (const item of sync.pending) item.state = "blocked";
        if (deleted) sync.deleted = true;
      } else for (const item of sync.pending) if (item.predecessorId === receipt.operationId) {
        if (item.attempts || item.operation.command.kind !== "patch") throw new Error("PROJECT_SEALED_DEPENDENCY_CHANGED");
        item.predecessorId = null;
        item.operation = freezeOperation({ ...item.operation, command: { ...item.operation.command, expectedRevision: receipt.project!.cloudRevision } });
      }
      await this.ports.commit({ ...state, projects: state.projects.map(item => item.id === receipt.projectId ? withProjection(item, sync) : item) });
      return receipt;
    });
  }
  resolve(scope: SyncScope, projectId: string, action: "discard" | "retry") {
    return this.ports.enqueue(async () => {
      this.assertScope(scope);
      const state = this.ports.state(), sync = this.read(scope, projectId), current = state.projects.find(item => item.id === projectId)!;
      if (!sync.conflicts.length) return;
      if (sync.deleted) throw new Error("PROJECT_DELETED");
      if (!sync.confirmed || sync.conflicts.some(item => item.operation.command.kind === "create")) throw new Error("PROJECT_INITIAL_IDENTITY_CONFLICT");
      const changes: ProjectMetadataPatch = {};
      for (const operation of [...sync.conflicts.map(item => item.operation), ...sync.pending.map(item => item.operation)]) {
        if (operation.command.kind === "patch") Object.assign(changes, operation.command.changes);
      }
      sync.conflicts = []; sync.pending = [];
      sync.ciphertextBindings = sync.ciphertextBindings.filter(binding => sync.receipts.some(receipt => receipt.operationId === binding.transport.operationId));
      if (action === "retry") {
        const retry = metadataChanges(sync.confirmed, applyMetadata(sync.confirmed, changes));
        if (retry) sync.pending.push({ operation: freezeOperation({ operationId: randomUUID(), projectId,
          command: { kind: "patch", expectedRevision: sync.cloudRevision, changes: retry } }), predecessorId: null, attempts: 0, state: "queued" });
      }
      await this.ports.commit({ ...state, projects: state.projects.map(item => item.id === projectId ? withProjection(current, sync) : item) });
    });
  }
  accept(scopeInput: SyncScope, operationId: string, input: PortableProject) {
    return this.acceptProjection(scopeInput, operationId, input);
  }
  requestDeletion(scope: SyncScope, projectId: string) {
    return this.ports.enqueue(async () => {
      this.assertScope(scope);
      const state = this.ports.state(), project = state.projects.find(item => item.id === projectId), sync = this.read(scope, projectId);
      if (sync.deletionKept && !sync.deleted) throw new Error("PROJECT_DELETION_CANCELLED");
      if (!project || project.role !== "workspace" || project.workspaceBinding.kind === "app" || sync.confirmed?.appId) throw new Error("PROJECT_APP_DELETION_REQUIRED");
      const original = sync.pending.find(item => item.operation.command.kind === "delete");
      if (original || sync.deleted) return original?.operation ?? null;
      if (!sync.confirmed || sync.pending.length || sync.conflicts.length) throw new Error("PROJECT_DELETION_REVIEW_REQUIRED");
      const operation = freezeOperation({ operationId: randomUUID(), projectId, command: { kind: "delete", expectedRevision: sync.cloudRevision } });
      sync.pending.push({ operation, attempts: 0, state: "queued", predecessorId: null });
      await this.ports.commit({ ...state, projects: state.projects.map(item => item.id === projectId ? { ...item, sync } : item) });
      return operation;
    });
  }
  resolveDeletion(scope: SyncScope, decision: ProjectDeletionDecision, head: PortableProject) {
    return this.ports.enqueue(async () => {
      this.assertScope(scope); const state = this.ports.state(), project = state.projects.find(item => item.id === decision.review.projectId);
      if (!project) throw new Error("PROJECT_DELETION_REVIEW_CHANGED");
      const resolved = resolveProjectDeletion(project, scope, decision, head);
      await this.ports.commit({ ...state, projects: state.projects.map(item => item.id === project.id ? resolved : item) });
    });
  }
  acceptDeletion(scope: SyncScope, projectId: string) {
    return this.ports.enqueue(async () => {
      this.assertScope(scope);
      const state = this.ports.state(), next = retainDeletedProject(state, scope, projectId);
      if (next !== state) await this.ports.commit(next);
    });
  }
  acceptAppDeletion(scope: SyncScope, rawDeletion: CloudAppDeletion, input: PortableProject | null) {
    return this.ports.enqueue(async () => {
      this.assertScope(scope, true);
      const deletion = appDeletionSchema.parse(rawDeletion), state = this.ports.state();
      const current = state.projects.find(project => project.id === deletion.projectId);
      if (!current || current.sync && !sameScope(current.sync.scope, scope) || current.deletionCheckpoint ||
        !(current.workspaceBinding.kind === "app" && current.workspaceBinding.appId === deletion.appId || current.role === "base-custody")) throw new Error("PROJECT_APP_DELETION_CHANGED");
      if (current.grants.length || current.resourceAdmissions.length || current.appPlacements.length) throw new Error("PROJECT_APP_RETIREMENT_REQUIRED");
      const portable = input && portableProjectSchema.parse(input);
      if (deletion.retainBase && (!portable || portable.id !== current.id || portable.role !== "base-custody" || portable.appId ||
        portable.cloudRevision < (current.sync?.cloudRevision ?? 0) || current.sync?.deleted)) throw new Error("PROJECT_APP_RETENTION_CHANGED");
      if (!deletion.retainBase && portable) throw new Error("PROJECT_APP_DELETION_CHANGED");
      const sync = current.sync ? structuredClone(current.sync) : projectSyncAssociationSchema.parse({
        scope, cloudRevision: 0, operationId: `app-deleted-${deletion.tombstone.revision}`,
        payloadHash: createHash("sha256").update(canonicalJson(deletion)).digest("hex"), retention: "local",
      });
      if (portable) { sync.confirmed = portable; sync.cloudRevision = portable.cloudRevision; }
      else { sync.deleted = true; for (const pending of sync.pending) pending.state = "blocked"; }
      const next = withProjection({ ...planBaseCustody(current, portable?.updatedAt ?? deletion.tombstone.deletedAt), sync }, sync);
      if (canonicalJson(next) === canonicalJson(current)) return structuredClone(current);
      await this.ports.commit({ ...state, projects: state.projects.map(project => project.id === current.id ? next : project) });
      return structuredClone(next);
    });
  }
  acceptPromotion(proofInput: ConfirmedBasePromotion, input: PortableProject) {
    const proof = confirmedBasePromotionSchema.parse(proofInput);
    if (!proof.receipt.basePromotion?.appId || proof.receipt.basePromotion.projectId !== input.id ||
      proof.receipt.basePromotion.appId !== input.appId || input.cloudRevision < 1) throw new Error("PROJECT_PROMOTION_CHANGED");
    return this.acceptProjection(proof.scope, proof.operation.lifecycleOperationId, input, { appId: proof.receipt.basePromotion.appId });
  }
  acceptAppCreation(scope: SyncScope, rawOperation: AppOperation, rawReceipt: AppReceipt, input: PortableProject) {
    const operation = appOperationSchema.parse(rawOperation), receipt = appReceiptSchema.parse(rawReceipt);
    if (operation.kind !== "create" || receipt.kind !== "create" || !["applied", "converged"].includes(receipt.outcome) ||
      receipt.operationId !== operation.operationId || receipt.appId !== operation.appId || receipt.projectId !== operation.projectId ||
      receipt.baseId !== operation.baseId || receipt.payloadHash !== createHash("sha256").update(canonicalJson(operation)).digest("hex") ||
      input.id !== operation.projectId || input.appId !== operation.appId || input.role !== "workspace") throw new Error("PROJECT_APP_CREATION_CHANGED");
    return this.acceptProjection(scope, operation.operationId, input, { appId: operation.appId });
  }
  private acceptProjection(scopeInput: SyncScope, operationId: string, input: PortableProject, localApp?: { appId: string }) {
    return this.ports.enqueue(async () => {
      this.assertScope(scopeInput);
      const scope = syncScopeSchema.parse(scopeInput), portable = portableProjectSchema.parse(input);
      const hash = createHash("sha256").update(canonicalJson({ scope, operationId, portable })).digest("hex");
      const state = this.ports.state();
      if (state.deletionReceipts.some(receipt => receipt.projectId === portable.id)) throw new Error("PROJECT_DELETED");
      const current = state.projects.find(project => project.id === portable.id);
      const adopt = Boolean(current && !localApp && !current.sync?.confirmed && !current.sync?.ciphertextBindings.length &&
        !current.sync?.pending.some(item => item.attempts) && !current.sync?.conflicts.length);
      if (localApp && (!current || current.role !== "workspace" || current.workspaceBinding.kind !== "app" ||
        current.workspaceBinding.appId !== localApp.appId || current.deletionCheckpoint)) throw new Error("PROJECT_APP_ADMISSION_CHANGED");
      if (current) {
        if (!current.sync && !localApp && !adopt || current.sync && !sameScope(current.sync.scope, scope)) throw new Error("PROJECT_IDENTITY_CONFLICT");
        if (current.sync && current.sync.cloudRevision > portable.cloudRevision) return structuredClone(current);
        if (current.sync?.deleted) throw new Error("PROJECT_DELETED");
        if (!adopt && current.sync && !current.sync.confirmed && (current.sync.pending.some(item => item.operation.command.kind === "create") ||
          current.sync.conflicts.some(item => item.operation.command.kind === "create"))) throw new Error("PROJECT_INITIAL_RECEIPT_REQUIRED");
        if (!adopt && current.sync?.cloudRevision === portable.cloudRevision) {
          if (canonicalJson(current.sync.confirmed ?? this.export(current)) !== canonicalJson(portable)) throw new Error("PROJECT_REVISION_CONFLICT");
          return structuredClone(current);
        }
        if (current.deletionCheckpoint || (current.workspaceBinding.kind === "app" ? current.workspaceBinding.appId : null) !== portable.appId || current.role !== portable.role) throw new Error("PROJECT_LIFECYCLE_CONFLICT");
      }
      const project = storedProjectSchema.parse({
        ...(current ?? { dir: "", workspaceBinding: portable.appId ? { kind: "app", appId: portable.appId } : { kind: "none" },
          nameSource: portable.appId ? "app" : "user", appPlacements: [], grants: [], grantRevision: 0, membershipRevision: 0,
          projectLifecycleRevision: state.lifecycleSequence + 1, resourceAdmissions: [] }),
        id: portable.id, name: portable.name, sortIndex: portable.sortIndex, appearance: portable.appearance, archivedAt: portable.archivedAt,
        createdAt: portable.createdAt, updatedAt: portable.updatedAt, role: portable.role, gitRemote: portable.gitRemote,
        sync: { ...current?.sync, scope, operationId, payloadHash: hash, cloudRevision: portable.cloudRevision, confirmed: portable,
          ...(adopt ? { pending: [], conflicts: [], ciphertextBindings: [] } : {}),
          retention: current?.sync?.retention ?? (localApp || current ? "local" : "mirror") },
      });
      const projected = withProjection(project, project.sync!);
      await this.ports.commit({ ...state, lifecycleSequence: Math.max(state.lifecycleSequence, project.projectLifecycleRevision),
        projects: current ? state.projects.map(item => item.id === projected.id ? projected : item) : [...state.projects, projected] });
      return structuredClone(projected);
    });
  }
  detachScope(scope: SyncScope, discardedProjectIds: readonly string[] = [], retainedApps: readonly CloudAppDeletion[] = []) {
    return this.ports.enqueue(async () => {
      const state = this.ports.state();
      const projects = state.projects.flatMap(project => {
        if (!project.sync || !sameScope(project.sync.scope, scope)) return [project];
        if (discardedProjectIds.includes(project.id)) {
          if (project.sync.retention !== "mirror" || project.workspaceBinding.kind === "external" || project.dir ||
            project.sync.pending.length || project.sync.conflicts.length) throw new Error("CLEANUP_PROJECT_RETENTION_CHANGED");
          return [];
        }
        let retained = this.export(project);
        for (const operation of [...project.sync.conflicts.map(item => item.operation), ...project.sync.pending.map(item => item.operation)]) {
          if (operation.command.kind === "patch") retained = applyMetadata(retained, operation.command.changes);
        }
        const { sync: _sync, ...local } = withProjection(project, { ...project.sync, confirmed: retained, pending: [] });
        const proof = retainedApps.find(item => item.projectId === project.id);
        if (!proof) return [storedProjectSchema.parse(local)];
        appDeletionSchema.parse(proof);
        if (!proof.retainBase || !(project.role === "base-custody" || project.workspaceBinding.kind === "app" && project.workspaceBinding.appId === proof.appId) ||
          project.grants.length || project.resourceAdmissions.length) throw new Error("PROJECT_APP_RETENTION_CHANGED");
        return [planBaseCustody(storedProjectSchema.parse(local), proof.tombstone.deletedAt)];
      });
      await this.ports.commit({ ...state, projects });
    });
  }
}
