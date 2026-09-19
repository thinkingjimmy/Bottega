/**
 * [INPUT]: Depends on canonical App/Project/Base Stores, lifecycle custody and the existing local delivery/build authorities.
 * [OUTPUT]: Installs and recovers fixed-identity cloud Apps and delegates local account cleanup without creating or seeding a Base.
 * [POS]: Main-owned materialization driver; source, local build, configuration and authorization have separate checkpoints.
 */
import { join } from "node:path";
import { canonicalJson, sameScope } from "../../../../../shared/local-storage/contracts";
import type { AppConfigValue, AppExtensionInstallPreflight, AppRecord } from "../../../../../shared/apps-ipc";
import type { AppStore } from "../../store/app-store";
import type { BaseStore } from "../../../bases/base-store";
import type { ProjectStore } from "../../../projects/store/project-store";
import type { LifecycleIntentStore } from "../../../lifecycle/intent-store";
import { reached, type LifecycleIntent } from "../../../lifecycle/intent-types";
import type { AdmissionGate, SagaResult } from "../../../lifecycle/admission-gate";
import { AppConfigStore, validateConfigRequirements } from "../../share/app-config-store";
import { checkCompatibilityBytes } from "../../compatibility/read";
import { exportAppGenerationSource } from "../../share/package/cloud-source";
import { detectCliRequirements } from "../../share/cli-detectors";
import { authorizeAndPromote } from "../delivery/authorization";
import { assertRequirements } from "../delivery/requirements";
import { fulfillExtensions, fulfillmentInput, type AppExtensionDelivery } from "../delivery/extensions";
import { installationRecord } from "../delivery/record";
import { cloudAppInstallSchema, type CloudAppInstall } from "./contract";
import { CloudAppInstallFiles } from "./files";
import { settleCloudInstallations } from "./scope-cleanup";
import type { SyncScope } from "../../../../../shared/local-storage/contracts";
export type CloudAppInstallPorts = { userData: string; apps: AppStore; bases: BaseStore; projects: ProjectStore;
  journal: LifecycleIntentStore; gate: AdmissionGate; configs: AppConfigStore; extensions: AppExtensionDelivery | null;
  verifyAccess(input: CloudAppInstall): Promise<void>;
  validateAgent?(agent: CloudAppInstall["agent"]): Promise<void>;
  removed?(appId: string): void;
  detectCli?: typeof detectCliRequirements;
  checkpoint?(phase: string): Promise<void> };
export class CloudAppInstaller {
  constructor(private ports: CloudAppInstallPorts) {}
  settleScopeCleanup(scope: SyncScope, cleanupOperationId: string, current: () => void) {
    return settleCloudInstallations(this.ports, scope, cleanupOperationId, current);
  }
  settleDeletion(scope: SyncScope, deletion: import("@ai-chat/cloud-protocol/apps/model").CloudAppDeletion, current: () => void) {
    return settleCloudInstallations(this.ports, scope, `app-deletion-${deletion.tombstone.revision}`, current, deletion);
  }
  async install(requestId: string, input: CloudAppInstall, bytes: Uint8Array, config: AppConfigValue,
    preflights: readonly AppExtensionInstallPreflight[] = []) {
    input = cloudAppInstallSchema.parse(input);
    if (canonicalJson(fulfillmentInput(preflights)) !== canonicalJson(input.extensionFulfillment)) throw new Error("APP_EXTENSION_PREFLIGHT_CHANGED");
    await this.current(input);
    const files = new CloudAppInstallFiles(this.ports.userData, requestId, input, this.ports.apps.sourceDirectory(input.descriptor.appId));
    await files.stage(bytes);
    await this.validateSource(input, files, config);
    await this.ports.configs.stagePending(files.configReference, config);
    const result = await this.ports.gate.admitAndRun<AppRecord>({ kind: "app-cloud-install", requestId, input }, intent => this.execute(intent, preflights));
    if (result.state === "executed" && result.result.status === "done") return result.result.value!;
    if (result.state === "settled" && result.status === "done") {
      const record = this.ports.apps.get(input.descriptor.appId);
      if (record) return record;
    }
    throw new Error("APP_INSTALLATION_RECOVERY_REQUIRED");
  }
  recover(intent: LifecycleIntent) { return this.execute(intent, []); }
  async retry(requestId: string) {
    const intent = (await this.ports.journal.listPending()).find(item => item.kind === "app-cloud-install" && item.requestId === requestId);
    if (!intent) throw new Error("APP_INSTALLATION_RECOVERY_UNAVAILABLE");
    return this.ports.gate.runRecovery(intent.intentId, current => this.recover(current));
  }
  async cancel(requestId: string) {
    const intent = (await this.ports.journal.listPending()).find(item => item.kind === "app-cloud-install" && item.requestId === requestId);
    if (!intent) return;
    return this.ports.gate.runRecovery(intent.intentId, async current => {
      const input = cloudAppInstallSchema.parse(current.input), appId = input.descriptor.appId;
      const record = this.ports.apps.get(appId), active = record?.generationBinding.active?.generationId ?? null;
      if (reached("app-cloud-install", current, "activated") || active !== input.previousGenerationId) throw new Error("APP_INSTALLATION_CANCEL_TOO_LATE");
      if (record?.generationBinding.pending) {
        await this.verifyGeneration(appId, record.generationBinding.pending.generationId, input.descriptor);
        await this.ports.apps.abortPendingGeneration(appId, record.generationBinding.pending.generationId);
      }
      if (record && !active) await this.ports.apps.remove(appId);
      if (!active) this.ports.removed?.(appId);
      await this.ports.apps.portable.cancelInstallation(appId, input.scope);
      await this.ports.configs.removePending(new CloudAppInstallFiles(this.ports.userData, current.requestId, input).configReference);
      return { status: "business-rejected", error: { code: "USER_CANCELLED", message: "App installation was cancelled." } };
    });
  }
  private async execute(initial: LifecycleIntent, preflights: readonly AppExtensionInstallPreflight[]): Promise<SagaResult<AppRecord>> {
    if (initial.kind !== "app-cloud-install") throw new Error("APP_INSTALLATION_INTENT_INVALID");
    if (initial.recoveryState.scopeCleanup) throw new Error("APP_INSTALLATION_SCOPE_CLOSING");
    let intent = initial;
    const input = cloudAppInstallSchema.parse(intent.input), { descriptor } = input, appId = descriptor.appId;
    const files = new CloudAppInstallFiles(this.ports.userData, intent.requestId, input, this.ports.apps.sourceDirectory(appId));
    const advance = async (phase: string, recovery: Record<string, unknown> = {}) => {
      await this.ports.checkpoint?.(`before:${phase}`);
      intent = await this.ports.journal.advance(intent.intentId, phase, recovery);
      await this.ports.checkpoint?.(phase);
    };
    try {
      await this.current(input);
      await this.ports.apps.portable.installation(appId, "preparing");
      const config = reached("app-cloud-install", intent, "workspace-ready") ? await this.ports.configs.read(appId) :
        await this.ports.configs.readPending(files.configReference);
      const verified = await this.validateSource(input, files, config);
      if (!reached("app-cloud-install", intent, "source-ready")) {
        await files.prepare(); await advance("source-ready");
      }
      if (!reached("app-cloud-install", intent, "extensions-ready")) {
        const expected = new Set((verified.manifest.extensionRequirements ?? []).filter(item => item.source).map(item => item.declaredComponentIdentity));
        if (expected.size !== input.extensionFulfillment.length || input.extensionFulfillment.some(item => !expected.has(item.declaredComponentIdentity))) throw new Error("APP_EXTENSION_REQUIREMENTS_UNCONFIRMED");
        const result = await fulfillExtensions({ extensions: this.ports.extensions, journal: this.ports.journal }, intent, preflights);
        if (!result.complete) throw new Error("APP_EXTENSIONS_NOT_READY");
        await advance("extensions-ready");
      }
      if (!reached("app-cloud-install", intent, "generation-ready")) {
        await this.current(input);
        let record = this.ports.apps.get(appId);
        if (!record) {
          if (input.previousGenerationId !== null) throw new Error("APP_INSTALLATION_LOCAL_BINDING_CHANGED");
          await this.ports.apps.reservePortableId(input.scope, descriptor);
          record = await this.ports.apps.set(installationRecord({ id: appId, dir: this.ports.apps.sourceDirectory(appId),
            displayName: descriptor.name, agent: input.agent, origin: "local", sourceRepoUrl: null }));
        }
        const pending = record.generationBinding.pending;
        const active = record.generationBinding.active;
        // Re-entering after a Store commit must reuse its sealed generation, not rebuild an inferred version.
        if (!pending && (active?.generationId ?? null) === input.previousGenerationId) {
          if (record.generationBinding.bindingRevision !== input.previousBindingRevision) throw new Error("APP_INSTALLATION_LOCAL_BINDING_CHANGED");
          record = await this.ports.apps.publishGeneration(appId, current => ({ ...current, manifest: verified.manifest,
            displayName: descriptor.name, state: current.generationBinding.active ? current.state : "creating", lastError: null }),
          { generationSourceDir: files.source });
        }
        const generationId = record.generationBinding.pending?.generationId ?? record.generationBinding.active?.generationId;
        if (!generationId) throw new Error("APP_INSTALLATION_GENERATION_MISSING");
        await this.verifyGeneration(appId, generationId, descriptor);
        await advance("generation-ready", { generationId });
      }
      if (!reached("app-cloud-install", intent, "activated")) {
        await this.current(input);
        const generationId = String(intent.recoveryState.generationId);
        await this.verifyGeneration(appId, generationId, descriptor);
        await authorizeAndPromote(this.ports.apps, appId, input.authorization, true, async () => {
          await this.current(input);
          const record = this.ports.apps.get(appId);
          if ((record?.generationBinding.pending?.generationId ?? record?.generationBinding.active?.generationId) !== generationId) throw new Error("APP_INSTALLATION_LOCAL_BINDING_CHANGED");
        });
        if (this.ports.apps.get(appId)?.generationBinding.active?.generationId !== generationId) throw new Error("APP_INSTALLATION_LOCAL_BINDING_CHANGED");
        await advance("activated");
      }
      if (!reached("app-cloud-install", intent, "workspace-ready")) {
        await this.current(input);
        await files.publishWorkspace(this.ports.apps.sourceDirectory(appId));
        await this.ports.configs.write(appId, config, verified.manifest.requirements?.tools ?? []);
        await advance("workspace-ready");
      }
      await this.current(input);
      await this.ports.apps.portable.installation(appId, "installed");
      const record = await this.ports.apps.update(appId, current => ({ ...current, state: "ready", lastError: null, pendingInstallRequirements: undefined }));
      await advance("installed"); await this.ports.configs.removePending(files.configReference);
      return { status: "done", value: record, receipt: { appId, projectId: descriptor.projectId, baseId: descriptor.baseId,
        packageRevision: descriptor.packageRevision, generationId: record.generationBinding.active!.generationId } };
    } catch (error) {
      const entry = this.ports.apps.portable.get(appId);
      if (entry && !entry.tombstoned && sameScope(entry.scope, input.scope)) {
        await this.ports.apps.portable.installation(appId, "failed").catch(() => undefined);
      }
      throw error;
    }
  }
  private async current(input: CloudAppInstall) {
    const { descriptor } = input;
    await this.ports.verifyAccess(input);
    this.ports.apps.portable.assertInstallable(input.scope, descriptor);
    const project = this.ports.projects.get(descriptor.projectId);
    if (!project?.sync || !sameScope(project.sync.scope, input.scope) || project.workspaceBinding.kind !== "app" || project.workspaceBinding.appId !== descriptor.appId) throw new Error("APP_PROJECT_IDENTITY_CONFLICT");
    const base = this.ports.bases.get(`project:${descriptor.projectId}`, descriptor.baseId);
    if (!base || base.meta.navigation?.kind !== "internal-app" || base.meta.navigation.appId !== descriptor.appId) throw new Error("APP_BASE_NOT_READY");
    const state = this.ports.bases.sync.read(`project:${descriptor.projectId}`, descriptor.baseId);
    if (!state.confirmed || !sameScope(state.scope, input.scope) || state.tombstones.includes("base")) throw new Error("APP_BASE_NOT_READY");
  }
  private async validateSource(input: CloudAppInstall, files: CloudAppInstallFiles, config: AppConfigValue) {
    await this.ports.validateAgent?.(input.agent);
    const verified = await files.read();
    checkCompatibilityBytes(verified.files.find(file => file.path === "app.compat.json")?.bytes, { appId: input.descriptor.appId,
      appName: input.descriptor.name, hasUsableVersion: Boolean(this.ports.apps.get(input.descriptor.appId)?.generationBinding.active),
      commitSha: null, contentDigest: input.descriptor.sourcePackageDigest }, this.ports.apps.hostVersion(), true);
    const requirements = verified.manifest.requirements?.tools ?? [];
    validateConfigRequirements(requirements); assertRequirements(requirements, config);
    const states = await (this.ports.detectCli ?? detectCliRequirements)(requirements);
    if (states.some(state => state.detectable && !state.installed && requirements.some(item => item.id === state.id && item.required))) throw new Error("APP_REQUIRED_TOOL_UNAVAILABLE");
    return verified;
  }
  private async verifyGeneration(appId: string, generationId: string, descriptor: CloudAppInstall["descriptor"]) {
    const result = await exportAppGenerationSource(this.ports.apps, appId, generationId, join(this.ports.userData, "app-source-verification"));
    if (result.manifestDigest !== descriptor.manifestDigest || result.sourcePackageDigest !== descriptor.sourcePackageDigest) throw new Error("APP_INSTALLATION_PACKAGE_CONFLICT");
  }
}
