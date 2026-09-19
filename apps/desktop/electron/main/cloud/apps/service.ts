/**
 * [INPUT]: Depends on current account custody, canonical App/Base Stores, private files and the fixed-identity installer; request-bound single-record decoders.
 * [OUTPUT]: Provides account-fenced catalogs, source-deletion facts, source reviews, explicit installation/removal/deletion and fixed retained-file recovery actions.
 * [POS]: Desktop cloud App front door; every disclosure and installation remains bound to its original account and package.
 */
import { randomUUID } from "node:crypto";
import { canonicalJson, hashBytes, protocolHeader, type CloudBuildConfig } from "@ai-chat/cloud-protocol";
import { verifyAppSourcePackage } from "@ai-chat/cloud-protocol/apps/source";
import type { CloudAccountState } from "../../../../shared/cloud-ipc";
import { sameScope, type SyncScope } from "../../../../shared/local-storage/contracts";
import { cloudAppCatalogSchema, type CloudAppCatalog, type CloudAppReview, type cloudAppConfirmSchema, type cloudAppRemoveLocalSchema, type cloudAppDeleteConfirmSchema } from "../../../../shared/cloud/apps/model";
import type { AppLocalRemovalService } from "../../apps/conversion/removal/service";
import { localAppRemovalSchema } from "../../apps/conversion/removal/contract";
import type { z } from "zod";
import type { AppExtensionInstallPreflight } from "../../../../shared/apps-ipc";
import type { AppConfigStore } from "../../apps/share/app-config-store";
import { detectCliRequirements } from "../../apps/share/cli-detectors";
import { AppCompatibilityError, checkCompatibilityBytes } from "../../apps/compatibility/read";
import type { AppCompatibilityBlocked } from "../../../../shared/app-host/contract";
import { cloudAppInstallSchema, type CloudAppInstall } from "../../apps/install/cloud/contract";
import type { CloudAppInstaller } from "../../apps/install/cloud/installer";
import { preflightAppExtension } from "../../apps/install/delivery/preflight";
import { fulfillmentInput, type AppExtensionDelivery } from "../../apps/install/delivery/extensions";
import { publishedAppDescriptorSchema, type PublishedAppDescriptor } from "../../apps/store/portable/model";
import type { CleanupOwners } from "../sync/account/cleanup/plan";
import type { LifecycleIntentStore } from "../../lifecycle/intent-store";
import { reached } from "../../lifecycle/intent-types";
import type { SyncBindingStore } from "../sync/account/binding";
import type { AccountTransport } from "../runtime/transport";
import { appDescriptor } from "../sync/apps/descriptor";
import { CloudAppDeletionService } from "./deletion";
import { openAppHeadForRequest, openAppPackageForRequest, type AppCipherPort } from "@ai-chat/cloud-protocol/apps/encrypted/client";
import { ChangeNotifier } from "../runtime/notifier";
type Activity = { close(): Promise<void> };
export type CloudAppsPorts = { config: CloudBuildConfig; binding: SyncBindingStore; owners: Pick<CleanupOwners, "apps" | "bases" | "projects">;
  journal: LifecycleIntentStore; installer: CloudAppInstaller; configs: AppConfigStore; extensions: AppExtensionDelivery | null;
  account(): CloudAccountState; transport: Pick<AccountTransport, "query" | "mutate">;
  crypto(): AppCipherPort;
  readSource(scope: SyncScope, descriptor: PublishedAppDescriptor, signal: AbortSignal): Promise<Uint8Array>;
  own(activity: Activity): () => void; ownLocal(activity: Activity): () => void; changed(): void;
  detectCli?: typeof detectCliRequirements; now?: () => number; removal?: AppLocalRemovalService; openRetained?(path: string): Promise<void> };
type Held = { scope: SyncScope; descriptor: PublishedAppDescriptor; bytes: Uint8Array; extensions: AppExtensionInstallPreflight[];
  previousGenerationId: string | null; previousBindingRevision: number; expiresAt: number };
export class CloudAppsService {
  private readonly listeners = new ChangeNotifier();
  private reviews = new Map<string, Held>();
  private flights = new Set<Activity>();
  private reviewCount = 0;
  private closed = false;
  private recoveryKey = "";
  private readonly deletion: CloudAppDeletionService;
  constructor(private ports: CloudAppsPorts) {
    this.deletion = new CloudAppDeletionService({ ...ports, apps: ports.owners.apps, now: () => this.now() });
  }
  subscribe = this.listeners.subscribe;
  changed() { this.listeners.notify(); }
  private current(userId: string, online = false) {
    const binding = this.ports.binding.snapshot(), account = this.ports.account();
    if (this.closed || !binding || binding.phase !== "active" || binding.userId !== userId || account.profile?.userId !== userId ||
      !["ready", "temporarily-offline"].includes(account.status)) throw new Error("APP_ACCOUNT_CHANGED");
    if (online && (account.status !== "ready" || binding.paused)) throw new Error("APP_ONLINE_SYNC_REQUIRED");
    return { environment: this.ports.config.environmentId, userId };
  }
  private async work<T>(userId: string, online: boolean, run: (current: () => SyncScope, signal: AbortSignal) => Promise<T>) {
    this.current(userId, online);
    const abort = new AbortController(); let flight: Promise<T> | undefined;
    const activity = { close: async () => { abort.abort(); await flight?.catch(() => undefined); } };
    const release = (online ? this.ports.own : this.ports.ownLocal)(activity);
    this.flights.add(activity);
    const current = () => { abort.signal.throwIfAborted(); return this.current(userId, online); };
    try { flight = Promise.resolve().then(() => run(current, abort.signal)); return await flight; }
    finally { release(); this.flights.delete(activity); this.ports.changed(); }
  }
  private descriptor(scope: SyncScope, appId: string) {
    const entry = this.ports.owners.apps.portable.get(appId);
    if (!entry || !sameScope(entry.scope, scope) || entry.tombstoned) throw new Error("APP_DESCRIPTOR_UNAVAILABLE");
    return publishedAppDescriptorSchema.parse(entry.descriptor);
  }
  async verifyAccess(input: CloudAppInstall) {
    const scope = this.current(input.scope.userId, true);
    if (!sameScope(scope, input.scope)) throw new Error("APP_ACCOUNT_CHANGED");
    const crypto = this.ports.crypto(), signal = new AbortController().signal;
    const header = { ...protocolHeader(this.ports.config), expectedUserId: scope.userId,
      encryptedSpace: { scope: crypto.scope, keyPackageFingerprint: crypto.keyPackageFingerprint } };
    const raw = await this.ports.transport.query("apps/api:get", { ...header, appId: input.descriptor.appId }); this.current(scope.userId, true);
    const remote = raw && await openAppHeadForRequest(raw, input.descriptor.appId, crypto, signal); this.current(scope.userId, true);
    if (!remote || remote.activePackageRevision !== input.descriptor.packageRevision) throw new Error("APP_PACKAGE_CHANGED");
    const encrypted = await this.ports.transport.query("apps/packages:get", { ...header, appId: remote.appId, packageRevision: input.descriptor.packageRevision }); this.current(scope.userId, true);
    const candidate = encrypted && await openAppPackageForRequest(encrypted, input.descriptor.appId, input.descriptor.packageRevision, crypto, signal);
    this.current(scope.userId, true);
    if (!candidate || canonicalJson(appDescriptor(remote, candidate)) !== canonicalJson(input.descriptor) ||
      canonicalJson(this.descriptor(scope, remote.appId)) !== canonicalJson(input.descriptor)) throw new Error("APP_PACKAGE_CHANGED");
  }
  async catalog(userId: string): Promise<CloudAppCatalog> {
    const scope = this.current(userId), pending = await this.ports.journal.listPending(); this.current(userId);
    const deleteRequests = this.ports.owners.apps.portable.deletion.list(scope).reverse();
    const items = await Promise.all(this.ports.owners.apps.portable.list().filter(entry => sameScope(entry.scope, scope)).map(async entry => {
      const { descriptor } = entry, base = this.ports.owners.bases.get(`project:${descriptor.projectId}`, descriptor.baseId);
      const state = base && this.ports.owners.bases.sync.read(`project:${descriptor.projectId}`, descriptor.baseId);
      const job = pending.find(intent => intent.kind === "app-cloud-install" && intent.input.descriptor &&
        (intent.input.descriptor as { appId?: string }).appId === descriptor.appId && sameScope(cloudAppInstallSchema.parse(intent.input).scope, scope));
      const removal = pending.find(intent => intent.kind === "app-local-remove" && intent.input.appId === descriptor.appId &&
        sameScope(localAppRemovalSchema.parse(intent.input).scope, scope));
      const local = this.ports.owners.apps.get(descriptor.appId);
      const deletion = !entry.tombstoned && deleteRequests.find(item => !item.dismissed && item.operation.appId === descriptor.appId);
      return { appId: descriptor.appId, projectId: descriptor.projectId, baseId: descriptor.baseId, name: descriptor.name, packageRevision: descriptor.packageRevision,
        installedPackageRevision: entry.installedPackageRevision, coverage: descriptor.dataCoverage,
        state: entry.tombstoned ? "deleted" : job ? entry.installation === "failed" ? "failed" : "preparing" :
          entry.installedGenerationId && descriptor.packageRevision !== entry.installedPackageRevision ? "update-available" : entry.installation,
        baseReady: Boolean(state?.confirmed && sameScope(state.scope, scope) && !state.tombstones.includes("base")),
        requestId: job?.requestId ?? null, canCancel: Boolean(job && !reached("app-cloud-install", job, "activated") &&
          (local?.generationBinding.active?.generationId ?? null) === job.input.previousGenerationId),
        localInstallation: this.ports.removal && local?.generationBinding.active && !job && !removal ?
          { generationId: local.generationBinding.active.generationId, bindingRevision: local.generationBinding.bindingRevision } : null,
        removalRequestId: removal?.requestId ?? null,
        deletion: deletion ? { requestId: deletion.operation.operationId, retainBase: deletion.operation.retainBase,
          status: !deletion.receipt ? "pending" : ["applied", "converged"].includes(deletion.receipt.outcome) || deletion.receipt.reason === "deleted" ? "confirmed" : deletion.receipt.outcome } : null,
        hasRetainedFiles: await this.ports.removal?.hasRetainedFiles(scope, descriptor.appId) ?? false };
    }));
    this.current(userId); return cloudAppCatalogSchema.parse({ items });
  }
  origin(userId: string, appId: string) {
    const scope = this.current(userId), entry = this.ports.owners.apps.portable.get(appId);
    return entry && sameScope(entry.scope, scope) ? { appId, name: entry.descriptor.name, deleted: entry.tombstoned } : null;
  }
  removeLocal(input: z.infer<typeof cloudAppRemoveLocalSchema>) {
    return this.work(input.expectedUserId, false, async current => {
      if (!this.ports.removal) throw new Error("APP_LOCAL_REMOVAL_UNAVAILABLE");
      const scope = current();
      await this.ports.removal.remove(input.requestId, { scope, appId: input.appId, generationId: input.generationId, bindingRevision: input.bindingRevision });
      current();
    });
  }
  reviewDeletion(userId: string, appId: string) {
    return this.work(userId, true, current => this.deletion.review(appId, current));
  }
  confirmDeletion(input: z.infer<typeof cloudAppDeleteConfirmSchema>) {
    return this.work(input.expectedUserId, true, current => this.deletion.confirm(input.requestId, input.retainBase, current));
  }
  retryDeletion(userId: string, requestId: string) {
    return this.work(userId, true, current => this.deletion.retry(requestId, current));
  }
  dismissDeletion(userId: string, requestId: string) {
    return this.work(userId, false, current => this.deletion.dismiss(requestId, current));
  }
  async discardDeletion(userId: string, requestId: string) { this.deletion.discard(requestId, userId); }
  retryRemoval(userId: string, requestId: string) {
    return this.work(userId, false, async current => {
      const scope = current(), found = await this.ports.journal.readByRequest("app-local-remove", requestId); current();
      if (!this.ports.removal || found?.result.state !== "pending" || !sameScope(localAppRemovalSchema.parse(found.result.intent.input).scope, scope)) throw new Error("APP_LOCAL_REMOVAL_UNAVAILABLE");
      await this.ports.removal.retry(requestId); current();
    });
  }
  openRetained(userId: string, appId: string) {
    return this.work(userId, false, async current => {
      if (!this.ports.removal || !this.ports.openRetained) throw new Error("APP_REMOVAL_ARCHIVE_UNAVAILABLE");
      const path = await this.ports.removal.retainedDirectory(current(), appId); current();
      await this.ports.openRetained(path);
    });
  }
  async review(userId: string, appId: string): Promise<CloudAppReview | AppCompatibilityBlocked> {
    await this.expire();
    if (this.reviewCount + this.reviews.size >= 2) throw new Error("APP_REVIEW_LIMIT");
    this.reviewCount++;
    try { return await this.work(userId, true, async (current, signal) => {
      const scope = current(), descriptor = this.descriptor(scope, appId), local = this.ports.owners.apps.get(appId);
      const baseline = { previousGenerationId: local?.generationBinding.active?.generationId ?? null, previousBindingRevision: local?.generationBinding.bindingRevision ?? 0 };
      if ((await this.catalog(userId)).items.some(item => item.appId === appId && (item.requestId || item.removalRequestId))) throw new Error("APP_INSTALLATION_RECOVERY_REQUIRED");
      const check = { scope, descriptor, agent: "codex" as const, authorization: { scope: "studio-only" as const, decision: "approve-requested" as const }, extensionFulfillment: [], ...baseline };
      await this.verifyAccess(check); current();
      const bytes = await this.ports.readSource(scope, descriptor, signal); current();
      if (bytes.byteLength !== descriptor.sourceBlob.bytes || hashBytes(bytes) !== descriptor.sourceBlob.sha256) throw new Error("APP_INSTALLATION_BLOB_INTEGRITY");
      const source = verifyAppSourcePackage(bytes);
      if (source.manifestDigest !== descriptor.manifestDigest || source.sourcePackageDigest !== descriptor.sourcePackageDigest) throw new Error("APP_INSTALLATION_PACKAGE_CONFLICT");
      checkCompatibilityBytes(source.files.find(file => file.path === "app.compat.json")?.bytes, { appId, appName: descriptor.name,
        hasUsableVersion: Boolean(baseline.previousGenerationId), commitSha: null, contentDigest: descriptor.sourcePackageDigest }, this.ports.owners.apps.hostVersion(), true);
      const extensions: AppExtensionInstallPreflight[] = [];
      try {
        for (const declaration of source.manifest.extensionRequirements ?? []) {
          const preflight = await preflightAppExtension(declaration, this.ports.extensions); if (preflight) extensions.push(preflight); current();
        }
        const cliStatuses = await (this.ports.detectCli ?? detectCliRequirements)(source.manifest.requirements?.tools ?? []);
        const config = await this.ports.configs.read(appId); current(); await this.verifyAccess(check); current();
        const record = this.ports.owners.apps.get(appId);
        if ((record?.generationBinding.active?.generationId ?? null) !== baseline.previousGenerationId ||
          (record?.generationBinding.bindingRevision ?? 0) !== baseline.previousBindingRevision) throw new Error("APP_INSTALLATION_LOCAL_BINDING_CHANGED");
        const requestId = randomUUID();
        this.reviews.set(requestId, { scope, descriptor, bytes, extensions, ...baseline, expiresAt: this.now() + 600_000 });
        const readme = (path: string) => new TextDecoder().decode(source.files.find(file => file.path === path)?.bytes ?? new Uint8Array()).slice(0, 262144);
        return { requestId, appId, name: descriptor.name, packageRevision: descriptor.packageRevision, update: Boolean(baseline.previousGenerationId),
          coverage: descriptor.dataCoverage, manifest: source.manifest, readme: readme("README.md"), readmeZh: readme("README.zh-CN.md"), cliStatuses, extensions, config };
      } catch (error) { await this.discardExtensions(extensions); throw error; }
    }); } catch (error) {
      if (error instanceof AppCompatibilityError) { this.current(userId, true); return { kind: "compatibility-blocked", compatibility: error.compatibility }; }
      throw error;
    } finally { this.reviewCount--; }
  }
  async confirm(input: z.infer<typeof cloudAppConfirmSchema>) {
    const held = this.reviews.get(input.requestId);
    if (!held || held.scope.userId !== input.expectedUserId || held.expiresAt <= this.now()) throw new Error("APP_REVIEW_EXPIRED");
    return this.work(input.expectedUserId, true, async current => {
      if (this.reviews.get(input.requestId) !== held) throw new Error("APP_REVIEW_EXPIRED");
      this.reviews.delete(input.requestId);
      try {
        const install: CloudAppInstall = { scope: held.scope, descriptor: held.descriptor, agent: input.agent,
          authorization: input.authorization, extensionFulfillment: fulfillmentInput(held.extensions),
          previousGenerationId: held.previousGenerationId, previousBindingRevision: held.previousBindingRevision };
        current(); await this.ports.installer.install(input.requestId, install, held.bytes, input.config, held.extensions); current();
      } finally { await this.discardExtensions(held.extensions); }
    });
  }
  async discard(userId: string, requestId: string) {
    const held = this.reviews.get(requestId); if (!held || held.scope.userId !== userId) return;
    this.reviews.delete(requestId); await this.discardExtensions(held.extensions);
  }
  private async original(userId: string, requestId: string) {
    const scope = this.current(userId), intent = await this.ports.journal.readByRequest("app-cloud-install", requestId); this.current(userId);
    if (intent?.result.state !== "pending" || !sameScope(cloudAppInstallSchema.parse(intent.result.intent.input).scope, scope)) throw new Error("APP_INSTALLATION_RECOVERY_UNAVAILABLE");
  }
  retry(userId: string, requestId: string) { return this.work(userId, true, async current => {
    await this.original(userId, requestId); current(); await this.ports.installer.retry(requestId); current();
  }); }
  cancel(userId: string, requestId: string) { return this.work(userId, false, async current => {
    await this.original(userId, requestId); current(); await this.ports.installer.cancel(requestId); current();
  }); }
  private now() { return (this.ports.now ?? Date.now)(); }
  private async discardExtensions(items: AppExtensionInstallPreflight[]) {
    await Promise.all(items.flatMap(item => item.preflightId && this.ports.extensions ? [this.ports.extensions.discard(item.preflightId)] : []));
  }
  private async expire() {
    for (const [id, held] of this.reviews) if (held.expiresAt <= this.now()) await this.discard(held.scope.userId, id);
  }
  async accountChanged() {
    this.deletion.expire(this.ports.account().profile?.userId);
    for (const [id, held] of this.reviews) {
      try { this.current(held.scope.userId, true); } catch { await this.discard(held.scope.userId, id); }
    }
    const account = this.ports.account(), binding = this.ports.binding.snapshot();
    const key = JSON.stringify([account.status, binding?.userId, binding?.phase, binding?.paused]);
    if (key === this.recoveryKey) return;
    this.recoveryKey = key;
    if (account.status !== "ready" || !binding || binding.phase !== "active" || binding.paused) return;
    for (const intent of await this.ports.journal.listPending()) {
      if (intent.kind !== "app-cloud-install" || intent.recoveryState.scopeCleanup) continue;
      const input = cloudAppInstallSchema.parse(intent.input);
      if (input.scope.userId === binding.userId && input.scope.environment === this.ports.config.environmentId) {
        await this.retry(binding.userId, intent.requestId).catch(() => undefined);
      }
    }
  }
  async close() {
    this.closed = true; this.deletion.close(); await Promise.all([...this.flights].map(activity => activity.close()));
    for (const [id, held] of this.reviews) await this.discard(held.scope.userId, id);
  }
}
