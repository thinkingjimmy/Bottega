/**
 * [INPUT]: Depends on AppStore's queue/persistence port, published source verification and strict portable App contracts.
 * [OUTPUT]: Provides scoped identity, original installed source baselines, captured publications/deletions, installation completion and package CAS.
 * [POS]: AppStore identity collaborator; it never fabricates install paths, generations, configuration or grants.
 */
import { createHash } from "node:crypto";
import { canonicalJson, sameScope, storageModeSchema, type StorageMode, type SyncScope } from "../../../../../shared/local-storage/contracts";
import { appDescriptorSchema, appPackageCandidateSchema, appPortableCatalogSchema, type AppAdmissionIntent, type AppDescriptor, type AppPortableCatalog } from "./model";
import type { AppRecord } from "../../../../../shared/apps-ipc";
import { enrollmentOpen, transitionStorageMode } from "../../../../../shared/local-storage/scope-mode";
import type { RuntimeStorageMode } from "../../../../../shared/local-storage/contracts";
import { AppPublicationApi } from "./publication";
import { AppDeletionApi } from "./deletion";
import { appDeletionSchema, type CloudAppDeletion } from "@ai-chat/cloud-protocol/apps/model";
const installedPublication = (descriptor: AppDescriptor) => ({ revision: descriptor.cloudRevision, packageRevision: descriptor.packageRevision!,
  manifestDigest: descriptor.manifestDigest, sourcePackageDigest: descriptor.sourcePackageDigest });

export type AppPortablePorts = { enqueue<T>(run: () => Promise<T>): Promise<T>; state(): AppPortableCatalog;
  commit(next: AppPortableCatalog): Promise<void>; installed(appId: string): AppRecord | undefined; retired(appId: string): boolean;
  verifyInstalled(appId: string): Promise<{ generationId: string; manifestDigest: string; sourcePackageDigest: string }> };
const requiresMigration = (file: ReturnType<typeof appPackageCandidateSchema.parse>["migration"]) => file?.migrations.some(
  migration => migration.addColumns.length || Object.keys(migration.defaultValues).length || migration.aliases.length);
export class AppPortableApi {
  private mode: StorageMode;
  readonly publication: AppPublicationApi;
  readonly deletion: AppDeletionApi;
  constructor(private ports: AppPortablePorts, mode: StorageMode = { kind: "local-only" }) {
    this.mode = storageModeSchema.parse(mode);
    this.publication = new AppPublicationApi(ports, (scope, closing) => this.assertScope(scope, closing));
    this.deletion = new AppDeletionApi(ports, scope => this.assertScope(scope));
    if (mode.kind === "fixture" && process.versions.electron) throw new Error("FIXTURE_MODE_UNAVAILABLE");
  }
  configureMode(mode: RuntimeStorageMode) {
    return this.ports.enqueue(async () => {
      const state = this.ports.state();
      this.mode = transitionStorageMode(this.mode, mode, [...state.entries.map(item => item.scope), ...state.publications.map(item => item.scope), ...state.deletions.map(item => item.scope), ...state.admissions.filter(item => item.state === "pending").map(item => item.scope)]);
    });
  }
  private assertScope(scope: SyncScope | null, closing = false) {
    if (this.mode.kind === "local-only" || !sameScope(this.mode.scope, scope) || (!closing && !enrollmentOpen(this.mode))) throw new Error("APP_SYNC_SCOPE_UNAVAILABLE");
  }
  assertInstallable(scope: SyncScope, descriptor: AppDescriptor) {
    this.assertScope(scope);
    const entry = this.ports.state().entries.find(item => item.descriptor.appId === descriptor.appId);
    if (!entry || entry.tombstoned || !sameScope(entry.scope, scope) || descriptor.packageRevision === null ||
      canonicalJson(entry.descriptor) !== canonicalJson(descriptor)) throw new Error("APP_INSTALLATION_SUPERSEDED");
    return structuredClone(entry);
  }
  list() { return structuredClone(this.ports.state().entries); }
  isCloudManaged(appId: string) {
    const state = this.ports.state();
    return state.entries.some(entry => entry.descriptor.appId === appId && entry.scope) ||
      state.publications.some(plan => plan.operation.appId === appId && plan.scope);
  }
  get(appId: string) { return structuredClone(this.ports.state().entries.find(entry => entry.descriptor.appId === appId) ?? null); }
  pending() { return structuredClone(this.ports.state().admissions.filter(intent => intent.state === "pending")); }
  admission(operationId: string) { return structuredClone(this.ports.state().admissions.find(intent => intent.operationId === operationId) ?? null); }
  begin(scope: SyncScope, operationId: string, input: AppDescriptor, existence: { baseExists: boolean; projectExists: boolean }) {
    return this.ports.enqueue(async () => {
      this.assertScope(scope);
      const descriptor = appDescriptorSchema.parse(input);
      const payloadHash = createHash("sha256").update(canonicalJson({ scope, operationId, descriptor, ...existence })).digest("hex");
      const state = this.ports.state();
      const previous = state.admissions.find(intent => intent.operationId === operationId);
      if (previous) {
        if (previous.payloadHash !== payloadHash) throw new Error("APP_ADMISSION_IDENTITY_CONFLICT");
        return structuredClone(previous);
      }
      if (state.admissions.some(intent => intent.state === "pending" &&
        ["appId", "projectId", "baseId"].some(key => intent.descriptor[key as keyof AppDescriptor] === descriptor[key as keyof AppDescriptor]))) throw new Error("APP_ADMISSION_PENDING");
      const existing = state.entries.find(entry => entry.descriptor.appId === descriptor.appId);
      if (!existing && this.ports.retired(descriptor.appId)) throw new Error("APP_IDENTITY_CONFLICT");
      const restored = existing && !existing.scope && existing.descriptor.cloudRevision === 0 &&
        !state.publications.some(item => item.operation.appId === descriptor.appId);
      if (existing && (existing.tombstoned || !restored && !sameScope(existing.scope, scope) || existing.descriptor.projectId !== descriptor.projectId || existing.descriptor.baseId !== descriptor.baseId)) throw new Error("APP_IDENTITY_CONFLICT");
      if (state.entries.some(entry => entry.descriptor.appId !== descriptor.appId && (entry.descriptor.projectId === descriptor.projectId || entry.descriptor.baseId === descriptor.baseId))) throw new Error("APP_OWNER_ALREADY_CLAIMED");
      if (this.ports.installed(descriptor.appId) && !existing) throw new Error("Existing local installation requires explicit association");
      const intent: AppAdmissionIntent = { operationId, payloadHash, scope, descriptor, ...existence, completed: [], state: "pending" };
      await this.ports.commit(appPortableCatalogSchema.parse({ ...state, admissions: [...state.admissions, intent] }));
      return structuredClone(intent);
    });
  }
  checkpoint(operationId: string, step: "project" | "base" | "descriptor") {
    return this.ports.enqueue(async () => {
      const state = structuredClone(this.ports.state());
      const intent = state.admissions.find(item => item.operationId === operationId);
      if (!intent) throw new Error("App admission intent is unavailable");
      this.assertScope(intent.scope);
      if (intent.completed.includes(step)) return structuredClone(intent);
      const sequence = ["project", "base", "descriptor"];
      if (sequence[intent.completed.length] !== step) throw new Error("App admission checkpoint is out of order");
      if (step === "descriptor") {
        const existing = state.entries.find(entry => entry.descriptor.appId === intent.descriptor.appId);
        if (existing) {
          if (!existing.scope && existing.descriptor.cloudRevision === 0 &&
            !state.publications.some(item => item.operation.appId === intent.descriptor.appId)) existing.scope = intent.scope;
          if (existing.tombstoned || !sameScope(existing.scope, intent.scope)) throw new Error("APP_IDENTITY_CONFLICT");
          existing.descriptor = mergeDescriptor(existing.descriptor, intent.descriptor);
        } else state.entries.push({ scope: intent.scope, descriptor: intent.descriptor, installation: "not-installed",
          installedGenerationId: null, installedPackageRevision: null, installedPublication: null, tombstoned: false });
        intent.state = "complete";
      }
      intent.completed.push(step);
      await this.ports.commit(appPortableCatalogSchema.parse(state));
      return structuredClone(intent);
    });
  }
  installation(appId: string, phase: "preparing" | "failed" | "installed") {
    return this.ports.enqueue(async () => {
      const state = structuredClone(this.ports.state());
      const entry = state.entries.find(item => item.descriptor.appId === appId);
      if (!entry || entry.tombstoned) throw new Error("App descriptor is unavailable");
      this.assertScope(entry.scope);
      if (entry.descriptor.packageRevision === null) throw new Error("APP_PACKAGE_NOT_READY");
      const installed = this.ports.installed(appId);
      if (phase === "installed" && (!installed?.generationBinding.active || installed.manifest?.kind !== "base")) throw new Error("App installation has no verified active generation");
      if (phase === "installed") {
        const verified = await this.ports.verifyInstalled(appId);
        if (verified.generationId !== installed!.generationBinding.active!.generationId ||
          verified.manifestDigest !== entry.descriptor.manifestDigest ||
          verified.sourcePackageDigest !== entry.descriptor.sourcePackageDigest) throw new Error("APP_INSTALLATION_PACKAGE_CONFLICT");
      }
      entry.installation = phase;
      if (phase === "installed") {
        entry.installedGenerationId = installed!.generationBinding.active!.generationId;
        entry.installedPackageRevision = entry.descriptor.packageRevision;
        entry.installedPublication = installedPublication(entry.descriptor);
      }
      await this.ports.commit(appPortableCatalogSchema.parse(state));
    });
  }
  cancelInstallation(appId: string, scope: SyncScope) {
    return this.ports.enqueue(async () => {
      this.assertScope(scope, true);
      const state = structuredClone(this.ports.state()), entry = state.entries.find(item => item.descriptor.appId === appId);
      if (!entry || !sameScope(entry.scope, scope)) throw new Error("APP_DESCRIPTOR_UNAVAILABLE");
      entry.installation = entry.installedGenerationId ? "installed" : "not-installed";
      await this.ports.commit(appPortableCatalogSchema.parse(state));
    });
  }
  completeInstallationForCleanup(scope: SyncScope, descriptor: AppDescriptor, generationId: string) {
    return this.completeRetainedInstallation(scope, descriptor, generationId);
  }
  completeInstallationForRetirement(scope: SyncScope, descriptor: AppDescriptor, generationId: string, deletion: CloudAppDeletion) {
    return this.completeRetainedInstallation(scope, descriptor, generationId, appDeletionSchema.parse(deletion));
  }
  private completeRetainedInstallation(scope: SyncScope, descriptor: AppDescriptor, generationId: string, deletion?: CloudAppDeletion) {
    return this.ports.enqueue(async () => {
      this.assertScope(scope, true);
      if (!deletion && (this.mode.kind !== "sync" || enrollmentOpen(this.mode))) throw new Error("APP_CLEANUP_SCOPE_NOT_CLOSED");
      const state = structuredClone(this.ports.state()), entry = state.entries.find(item => item.descriptor.appId === descriptor.appId);
      if (!entry || !sameScope(entry.scope, scope) || !descriptor.packageRevision || entry.descriptor.projectId !== descriptor.projectId ||
        entry.descriptor.baseId !== descriptor.baseId) throw new Error("APP_IDENTITY_CONFLICT");
      if (deletion && (!entry.tombstoned || !entry.deletion || entry.deletion.appId !== deletion.appId ||
        entry.deletion.projectId !== deletion.projectId || entry.deletion.baseId !== deletion.baseId ||
        canonicalJson(entry.deletion.tombstone) !== canonicalJson(deletion.tombstone))) throw new Error("APP_DELETION_IDENTITY_CHANGED");
      const installed = this.ports.installed(descriptor.appId), verified = await this.ports.verifyInstalled(descriptor.appId);
      if (installed?.generationBinding.active?.generationId !== generationId || verified.generationId !== generationId ||
        verified.manifestDigest !== descriptor.manifestDigest || verified.sourcePackageDigest !== descriptor.sourcePackageDigest) throw new Error("APP_INSTALLATION_PACKAGE_CONFLICT");
      entry.installation = "installed"; entry.installedGenerationId = generationId; entry.installedPackageRevision = descriptor.packageRevision;
      entry.installedPublication = installedPublication(descriptor);
      await this.ports.commit(appPortableCatalogSchema.parse(state));
    });
  }
  stageUpdate(input: Omit<ReturnType<typeof appPackageCandidateSchema.parse>, "state" | "reason" | "receipt">) {
    return this.ports.enqueue(async () => {
      const state = structuredClone(this.ports.state());
      const entry = state.entries.find(item => item.descriptor.appId === input.appId);
      if (!entry || entry.tombstoned || entry.descriptor.packageRevision !== input.expectedPackageRevision || input.descriptor.appId !== input.appId ||
        entry.descriptor.projectId !== input.descriptor.projectId || entry.descriptor.baseId !== input.descriptor.baseId ||
        input.descriptor.packageRevision <= input.expectedPackageRevision) throw new Error("APP_PACKAGE_REVISION_CONFLICT");
      this.assertScope(entry.scope);
      const candidate = appPackageCandidateSchema.parse({ ...input, receipt: null,
        state: requiresMigration(input.migration) ? "blocked" : "pending", reason: requiresMigration(input.migration) ? "atomic-migration-unavailable" : "awaiting-receipt" });
      const previous = state.candidates.find(item => item.operationId === input.operationId);
      if (previous) {
        if (canonicalJson(previous) !== canonicalJson(candidate)) throw new Error("App package candidate identity changed");
        return structuredClone(previous);
      }
      state.candidates.push(candidate);
      await this.ports.commit(appPortableCatalogSchema.parse(state));
      return structuredClone(candidate);
    });
  }
  confirmUpdate(operationId: string, input: NonNullable<ReturnType<typeof appPackageCandidateSchema.parse>["receipt"]>) {
    return this.ports.enqueue(async () => {
      const state = structuredClone(this.ports.state());
      const candidate = state.candidates.find(item => item.operationId === operationId);
      if (!candidate || requiresMigration(candidate.migration)) throw new Error("APP_MIGRATION_REQUIRES_ATOMIC_CLOUD_RECEIPT");
      const active = state.entries.find(item => item.descriptor.appId === candidate.appId);
      if (!active) throw new Error("APP_DESCRIPTOR_UNAVAILABLE");
      this.assertScope(active.scope);
      const receipt = appPackageCandidateSchema.shape.receipt.unwrap().parse(input);
      const next = candidate.descriptor;
      if (receipt.operationId !== operationId || receipt.appId !== candidate.appId || receipt.expectedPackageRevision !== candidate.expectedPackageRevision ||
          receipt.packageRevision !== next.packageRevision || receipt.manifestDigest !== next.manifestDigest || receipt.sourcePackageDigest !== next.sourcePackageDigest || receipt.cloudRevision !== next.cloudRevision) throw new Error("APP_PACKAGE_RECEIPT_CONFLICT");
      if (candidate.receipt && canonicalJson(candidate.receipt) !== canonicalJson(receipt)) throw new Error("App receipt changed");
      if (candidate.state === "committed") {
        if (!candidate.receipt) throw new Error("APP_PACKAGE_RECEIPT_CONFLICT");
        return;
      }
      if (active.tombstoned || active.descriptor.packageRevision !== candidate.expectedPackageRevision ||
          next.cloudRevision <= active.descriptor.cloudRevision) throw new Error("APP_PACKAGE_REVISION_CONFLICT");
      candidate.receipt = receipt;
      candidate.state = "confirmed";
      candidate.reason = null;
      // Only the portable active package moves here; installation still rebuilds and authorizes locally.
      const entry = state.entries.find(item => item.descriptor.appId === candidate.appId)!;
      entry.descriptor = next;
      candidate.state = "committed";
      await this.ports.commit(appPortableCatalogSchema.parse(state));
    });
  }
  detachScope(scope: SyncScope, discardedAppIds: readonly string[] = []) {
    return this.ports.enqueue(async () => {
      const state = structuredClone(this.ports.state());
      if (state.admissions.some(intent => sameScope(intent.scope, scope) && intent.state === "pending")) {
        this.assertScope(scope, true);
        if (enrollmentOpen(this.mode)) throw new Error("APP_ADMISSION_RECOVERY_REQUIRED");
      }
      const appIds = new Set(state.entries.filter(entry => sameScope(entry.scope, scope)).map(entry => entry.descriptor.appId));
      for (const entry of state.entries) if (appIds.has(entry.descriptor.appId)) {
        if (discardedAppIds.includes(entry.descriptor.appId) && (this.ports.installed(entry.descriptor.appId) || entry.installation === "preparing")) throw new Error("CLEANUP_APP_RETENTION_CHANGED");
        entry.scope = null;
      }
      state.entries = state.entries.filter(entry => !appIds.has(entry.descriptor.appId) || !discardedAppIds.includes(entry.descriptor.appId));
      state.candidates = state.candidates.filter(candidate => !appIds.has(candidate.appId) || !discardedAppIds.includes(candidate.appId));
      state.admissions = state.admissions.filter(intent => !sameScope(intent.scope, scope));
      state.publications = state.publications.map(item => sameScope(item.scope, scope) ? { ...item, scope: null } : item);
      state.deletions = state.deletions.map(item => sameScope(item.scope, scope) ? { ...item, scope: null } : item);
      await this.ports.commit(appPortableCatalogSchema.parse(state));
    });
  }
  tombstone(appId: string, scope: SyncScope, expectedCloudRevision: number, cloudRevision: number) {
    return this.ports.enqueue(async () => {
      this.assertScope(scope);
      const state = structuredClone(this.ports.state());
      const entry = state.entries.find(item => item.descriptor.appId === appId);
      if (!entry || !sameScope(entry.scope, scope)) throw new Error("APP_DESCRIPTOR_UNAVAILABLE");
      if (entry.tombstoned && entry.descriptor.cloudRevision === cloudRevision) return;
      if (entry.descriptor.cloudRevision !== expectedCloudRevision || cloudRevision <= expectedCloudRevision) throw new Error("APP_PACKAGE_REVISION_CONFLICT");
      entry.tombstoned = true;
      entry.descriptor.cloudRevision = cloudRevision;
      await this.ports.commit(appPortableCatalogSchema.parse(state));
    });
  }
  acceptDeletion(scope: SyncScope, input: CloudAppDeletion) {
    return this.ports.enqueue(async () => {
      this.assertScope(scope, true);
      const proof = appDeletionSchema.parse(input), state = structuredClone(this.ports.state());
      let entry = state.entries.find(item => item.descriptor.appId === proof.appId);
      if (!entry) {
        const plan = state.publications.find(item => sameScope(item.scope, scope) && item.operation.appId === proof.appId);
        if (!plan || plan.operation.projectId !== proof.projectId || plan.operation.baseId !== proof.baseId) throw new Error("APP_DELETION_IDENTITY_CHANGED");
        entry = { scope, descriptor: { appId: proof.appId, projectId: proof.projectId, baseId: proof.baseId, name: plan.operation.displayName,
          createdAt: proof.createdAt, updatedAt: proof.tombstone.deletedAt, cloudRevision: proof.revision, dataCoverage: "partial",
          packageRevision: null, manifestDigest: null, sourcePackageDigest: null, sourceBlob: null }, tombstoned: true, deletion: proof,
          installation: this.ports.installed(proof.appId) ? "installed" : "not-installed", installedGenerationId: null, installedPackageRevision: null, installedPublication: null };
        state.entries.push(entry); await this.ports.commit(appPortableCatalogSchema.parse(state)); return;
      }
      if (!entry || !sameScope(entry.scope, scope) || entry.descriptor.projectId !== proof.projectId || entry.descriptor.baseId !== proof.baseId ||
        proof.revision < entry.descriptor.cloudRevision || proof.revision === entry.descriptor.cloudRevision && !entry.tombstoned) throw new Error("APP_DELETION_IDENTITY_CHANGED");
      if (entry.tombstoned) {
        if (entry.descriptor.cloudRevision !== proof.revision) throw new Error("APP_DELETION_IDENTITY_CHANGED");
        if (entry.deletion) {
          if (canonicalJson(entry.deletion.tombstone) !== canonicalJson(proof.tombstone)) throw new Error("APP_DELETION_IDENTITY_CHANGED");
          if (!entry.deletion.retainBase || proof.retainBase) return;
        }
      }
      entry.tombstoned = true; entry.descriptor.cloudRevision = proof.revision; entry.deletion = proof;
      await this.ports.commit(appPortableCatalogSchema.parse(state));
    });
  }
  assertMigrationAllowed(appId: string) {
    if (this.ports.state().entries.some(entry => entry.descriptor.appId === appId && entry.scope && !entry.tombstoned)) throw new Error("APP_MIGRATION_REQUIRES_ATOMIC_CLOUD_RECEIPT");
  }
}

function mergeDescriptor(current: AppDescriptor, next: AppDescriptor): AppDescriptor {
  if (current.appId !== next.appId || current.projectId !== next.projectId || current.baseId !== next.baseId) throw new Error("APP_IDENTITY_CONFLICT");
  if (next.cloudRevision < current.cloudRevision) return current;
  if (next.cloudRevision === current.cloudRevision) {
    const metadata = (value: AppDescriptor) => ({ ...value, packageRevision: null, manifestDigest: null, sourcePackageDigest: null, sourceBlob: null });
    if (canonicalJson(metadata(current)) !== canonicalJson(metadata(next))) throw new Error("APP_REVISION_CONFLICT");
    if (next.packageRevision === null) return current;
  }
  if (current.packageRevision !== null) {
    if (next.packageRevision === null || next.packageRevision < current.packageRevision) throw new Error("APP_PACKAGE_REVISION_CONFLICT");
    if (next.packageRevision === current.packageRevision &&
      (next.manifestDigest !== current.manifestDigest || next.sourcePackageDigest !== current.sourcePackageDigest ||
        canonicalJson(next.sourceBlob) !== canonicalJson(current.sourceBlob))) throw new Error("APP_PACKAGE_IDENTITY_CONFLICT");
  }
  return next;
}
