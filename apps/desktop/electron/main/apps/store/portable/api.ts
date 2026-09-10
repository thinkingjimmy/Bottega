/**
 * [INPUT]: Depends on AppStore's queue/persistence port and strict portable App contracts.
 * [OUTPUT]: Provides descriptor admission, installation receipts, package CAS and mutation-free committed receipt replay.
 * [POS]: AppStore identity collaborator; it never fabricates install paths, generations, configuration or grants.
 */
import { createHash } from "node:crypto";
import { canonicalJson, sameScope, storageModeSchema, type StorageMode, type SyncScope } from "../../../../../shared/local-storage/contracts";
import { appDescriptorSchema, appPackageCandidateSchema, appPortableCatalogSchema, type AppAdmissionIntent, type AppDescriptor, type AppPortableCatalog } from "./model";
import type { AppRecord } from "../../../../../shared/apps-ipc";

type Ports = { enqueue<T>(run: () => Promise<T>): Promise<T>; state(): AppPortableCatalog;
  commit(next: AppPortableCatalog): Promise<void>; installed(appId: string): AppRecord | undefined };
const requiresMigration = (file: ReturnType<typeof appPackageCandidateSchema.parse>["migration"]) => file?.migrations.some(
  migration => migration.addColumns.length || Object.keys(migration.defaultValues).length || migration.aliases.length);
export class AppPortableApi {
  private mode: StorageMode;
  constructor(private ports: Ports, mode: StorageMode = { kind: "local-only" }) {
    this.mode = storageModeSchema.parse(mode);
    if (mode.kind === "fixture" && process.versions.electron) throw new Error("FIXTURE_MODE_UNAVAILABLE");
  }
  private assertScope(scope: SyncScope | null) {
    if (this.mode.kind === "local-only" || !sameScope(this.mode.scope, scope)) throw new Error("APP_SYNC_SCOPE_UNAVAILABLE");
  }
  list() { return structuredClone(this.ports.state().entries); }
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
      if (existing && (existing.tombstoned || !sameScope(existing.scope, scope) || existing.descriptor.projectId !== descriptor.projectId || existing.descriptor.baseId !== descriptor.baseId)) throw new Error("APP_IDENTITY_CONFLICT");
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
      if (intent.completed.includes(step)) return structuredClone(intent);
      const sequence = ["project", "base", "descriptor"];
      if (sequence[intent.completed.length] !== step) throw new Error("App admission checkpoint is out of order");
      if (step === "descriptor") {
        if (!state.entries.some(entry => entry.descriptor.appId === intent.descriptor.appId)) state.entries.push({ scope: intent.scope,
          descriptor: intent.descriptor, installation: "not-installed", installedGenerationId: null, tombstoned: false });
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
      const installed = this.ports.installed(appId);
      if (phase === "installed" && (!installed?.generationBinding.active || installed.manifest?.kind !== "base")) throw new Error("App installation has no verified active generation");
      const generation = installed?.generations.find(item => item.generationId === installed.generationBinding.active?.generationId);
      if (phase === "installed" && generation?.manifestDigest !== `sha256:${entry.descriptor.manifestDigest}`) throw new Error("APP_INSTALLATION_PACKAGE_CONFLICT");
      entry.installation = phase;
      entry.installedGenerationId = phase === "installed" ? installed!.generationBinding.active!.generationId : null;
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
  detachScope(scope: SyncScope) {
    return this.ports.enqueue(async () => {
      const state = structuredClone(this.ports.state());
      if (state.admissions.some(intent => sameScope(intent.scope, scope) && intent.state === "pending")) throw new Error("APP_ADMISSION_RECOVERY_REQUIRED");
      const appIds = new Set(state.entries.filter(entry => sameScope(entry.scope, scope)).map(entry => entry.descriptor.appId));
      // Package candidates remain as local recovery evidence; no install tree is removed.
      for (const entry of state.entries) if (appIds.has(entry.descriptor.appId)) entry.scope = null;
      state.admissions = state.admissions.filter(intent => !sameScope(intent.scope, scope));
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
  assertMigrationAllowed(appId: string) {
    if (this.ports.state().entries.some(entry => entry.descriptor.appId === appId && entry.scope && !entry.tombstoned)) throw new Error("APP_MIGRATION_REQUIRES_ATOMIC_CLOUD_RECEIPT");
  }
}
