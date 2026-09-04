/**
 * [INPUT]: Depends on AppStore, AppGateway, lifecycle serialization, trusted renderer identity, Base GUI grants/data ports, attachment surface leases, query worker, preferences storage, file-export custody, renderer transition publication, and the current product window
 * [OUTPUT]: Provides the cohesive Base GUI runtime boundary for projection, staged cohort acquisition/readiness keyed by the renderer's logical lease, SDK routes, cutover barriers, preferences, exports, signed-update quarantine, renderer-owned surface release, initialization, non-fatal startup cutover recovery reporting, and shutdown
 * [POS]: apps/service GUI facade; keeps AppsService as a composition root while GUI runtime ownership remains explicit and testable
 */

import { join } from "node:path";
import type { BrowserWindow } from "electron";
import type {
  AppGuiInfo,
  AppGuiInfoInput,
  AppGuiReadyInput,
  AppGuiReadyResult,
  BaseGuiLiveBinding,
} from "../../../../shared/apps-ipc";
import { asError } from "../../errors";
import type { AppGateway } from "../gateway/app-gateway";
import type { AppStore } from "../store/app-store";
import type { AppAttachmentSurfaceLeaseRegistry } from "../attachments/surface-leases";
import { BaseGuiQueryExecutor } from "../base-gui/api/query/query-executor";
import type { BaseGuiGrantStore } from "../base-gui/grant-store";
import type { WorkspacePreviewPort } from "../base-gui/workspace-preview";
import { AppFileExportController } from "../file-export/controller";
import { AppGuiProjection } from "../generation/gui-projection";
import { AppGuiCutoverCoordinator } from "../gui-cutover/coordinator";
import type { GuiBasePort } from "../generation/gui-api";
import { AppPreferencesRuntime } from "../preferences/runtime";
import { withGuiCutover } from "./lifecycle/runtime-operations";
import type { TrustedRendererContext } from "../../window/surfaces/trusted-renderer-context";

type LifecycleGate = Readonly<{
  run<T>(appId: string, operation: () => Promise<T>): Promise<T>;
}>;

export class AppGuiRuntimeService {
  private readonly queries: BaseGuiQueryExecutor;
  private readonly preferences: AppPreferencesRuntime;
  private readonly exports: AppFileExportController;
  private readonly projection: AppGuiProjection;
  private readonly cutovers: AppGuiCutoverCoordinator;
  private surfaceLeases: AppAttachmentSurfaceLeaseRegistry | null = null;
  private retirementProof: ((input: { appId: string; generationId: string }) => Promise<unknown>) | null = null;

  constructor(
    userData: string,
    private readonly store: AppStore,
    private readonly gateway: AppGateway,
    grants: BaseGuiGrantStore,
    private readonly lifecycleGate: LifecycleGate,
    currentWindow: () => BrowserWindow | null,
    emitTransition: (appId: string) => void
  ) {
    this.queries = new BaseGuiQueryExecutor(
      join(__dirname, "app-gui-query-worker-entry.js")
    );
    this.preferences = new AppPreferencesRuntime(userData, store);
    this.projection = new AppGuiProjection(store, gateway, grants);
    this.exports = new AppFileExportController(
      userData,
      (surface) => this.projection.liveBinding(surface),
      currentWindow
    );
    this.cutovers = new AppGuiCutoverCoordinator(userData, store, grants, {
      runExclusive: (appId, operation) => this.lifecycleGate.run(appId, operation),
      liveSurfaces: (appId, generationId) =>
        this.projection.registeredSurfaces(appId, generationId ?? undefined),
      stageSurface: (sourceLeaseId, generationId) =>
        this.requireSurfaceLeases().stage(sourceLeaseId, generationId).then((surface) => ({
          surfaceLeaseId: surface.surfaceLeaseId,
          mode: surface.mode,
        })),
      discardSurface: async (input) => {
        await this.projection.release(input);
        this.requireSurfaceLeases().releaseDerived(input.appSurfaceLeaseId);
      },
      emitTransition,
      closeAdmission: (appId) => {
        this.gateway.requestLeases.closeAdmission(appId);
        this.exports.closeAdmission(appId);
      },
      drain: (appId, generationId, deadlineMs) =>
        this.drain(appId, generationId, deadlineMs),
      reopenAdmission: (appId) => {
        this.gateway.requestLeases.reopenAdmission(appId);
        this.exports.reopenAdmission(appId);
      },
      syncProjection: (appId, resetCapability) =>
        this.projection.sync(appId, { resetCapability }),
      prepareAppParticipants: async (intent) => {
        await this.projection.prepareGeneration(intent.appId, intent.nextGenerationId);
        if (intent.participantPlan.includes("preferences-v1")) {
          await this.preferences.validateCutover(intent);
        }
      },
      retireGeneration: async (appId, generationId) => {
        if (!this.retirementProof) throw new Error("APP_GENERATION_RETIREMENT_PROOF_UNAVAILABLE");
        await this.retirementProof({ appId, generationId });
        await this.store.retireDrainingGeneration(appId, generationId);
        await this.preferences.store.releaseGeneration(appId, generationId);
      },
      previewPreferences: (appId, generationId) =>
        this.preferences.previewCutover(appId, generationId),
      validatePreferences: (intent) => this.preferences.validateCutover(intent),
      adoptPreferences: (intent) => this.preferences.adoptCutover(intent),
      legacyCutover: (appId, operation) => this.legacyCutover(appId, operation),
    });
    store.registerArtifactRootProvider(() => [
      ...this.cutovers.artifactRoots(),
      ...this.projection.artifactRoots(),
      ...this.exports.artifactRoots(),
    ]);
  }

  initialize() {
    return Promise.all([
      this.preferences.initialize(),
      this.exports.initialize(),
      this.cutovers.initialize(),
    ]).then(() => undefined);
  }

  configureApi(port: GuiBasePort) {
    this.projection.configureApi({
      ...port,
      isActiveBinding: (binding) => this.isActiveBinding(binding),
      queryV1: (input) => this.queries.query(input),
      readPreferences: ({ binding }) => this.preferences.read(binding),
      writePreferences: (input) => this.preferences.write(input),
    });
  }

  configureWorkspacePreview(port: WorkspacePreviewPort) {
    this.projection.configureWorkspacePreview(port);
  }

  configureSurfaceLeases(registry: AppAttachmentSurfaceLeaseRegistry) {
    if (this.surfaceLeases) throw new Error("App GUI surface leases 已配置");
    this.surfaceLeases = registry;
    registry.configureStagingGeneration((appId, generationId) =>
      this.cutovers.isStagingGeneration(appId, generationId)
    );
  }

  configureGenerationRetirement(
    proof: (input: { appId: string; generationId: string }) => Promise<unknown>
  ) {
    if (this.retirementProof) throw new Error("App GUI retirement proof is already configured");
    this.retirementProof = proof;
  }

  isRoutableStagingBinding(
    appId: string,
    binding: Pick<BaseGuiLiveBinding, "generationId" | "lifecycleRevision">
  ) {
    return this.cutovers.isStagingGeneration(appId, binding.generationId);
  }

  liveBinding(input: AppGuiInfoInput | string) {
    return this.projection.liveBinding(input);
  }

  async sync(appId: string, reconcileData: () => Promise<void>) {
    let migrationFailure: unknown;
    await reconcileData().catch((cause) => {
      migrationFailure = cause;
    });
    const result = await this.projection.sync(appId, { resetCapability: true });
    if (migrationFailure) throw migrationFailure;
    return result;
  }

  async info(
    input: AppGuiInfoInput,
    reconcileData: () => Promise<void>,
    renderer: TrustedRendererContext
  ): Promise<AppGuiInfo> {
    let migrationError = "";
    await reconcileData().catch((cause) => {
      migrationError = asError(cause).message;
    });
    await this.preferences.ensureInitial(this.projection.liveBinding(input.appId));
    const target = await this.cutovers.acquire(input);
    const info = await this.projection.info(target.input, {
      ...(target.generationId ? { generationId: target.generationId } : {}),
      logicalLeaseId: input.appSurfaceLeaseId,
    }, renderer);
    const result = target.cutoverId ? { ...info, cutoverId: target.cutoverId } : info;
    return migrationError ? { ...result, error: migrationError } : result;
  }

  ready(input: AppGuiReadyInput): Promise<AppGuiReadyResult> {
    return this.cutovers.ready(input);
  }

  rendererOwns(input: AppGuiInfoInput, renderer: TrustedRendererContext) {
    return this.projection.rendererOwns(input, renderer);
  }

  async release(input: AppGuiInfoInput) {
    await this.cutovers.release(input);
    await this.exports.closeSurface(input.surfaceId);
    await this.projection.release(input);
    this.surfaceLeases?.releaseDerived(input.appSurfaceLeaseId);
  }

  cutover<T>(appId: string, operation: () => Promise<T>) {
    return this.cutovers.run(appId, operation);
  }

  /* 启动路径：cutover 恢复不再上抛。一条坏 intent 不能让整个产品进入启动崩溃
     循环，未收敛的部分一次性告警，其余 App 照常起来。 */
  async recoverCutovers() {
    await this.preferences.reconcileGenerationRetention();
    const findings = await this.cutovers.recover();
    if (findings.length === 0) return;
    console.warn(
      `[apps] GUI cutover 恢复未完全收敛：${findings
        .map((finding) => `${finding.appId}/${finding.outcome}(${finding.reason})`)
        .join("；")}`
    );
  }

  private legacyCutover<T>(appId: string, operation: () => Promise<T>) {
    return withGuiCutover(
      {
        runExclusive: (target, run) => this.lifecycleGate.run(target, run),
        gateway: this.gateway,
        gui: this.projection,
        activeGenerationId: (target) =>
          this.store.get(target)?.generationBinding.active?.generationId ?? null,
        closeSideEffects: (target) => this.exports.closeAdmission(target),
        drainSideEffects: (target, generationId, deadline) =>
          this.exports.drain(target, generationId, deadline),
        reopenSideEffects: (target) => this.exports.reopenAdmission(target),
      },
      appId,
      operation
    );
  }

  beginExport(input: Parameters<AppFileExportController["begin"]>[0]) {
    return this.exports.begin(input);
  }

  writeExport(input: Parameters<AppFileExportController["write"]>[0]) {
    return this.exports.write(input);
  }

  finalizeExport(input: Parameters<AppFileExportController["finalize"]>[0]) {
    return this.exports.finalize(input);
  }

  cancelExport(input: Parameters<AppFileExportController["cancel"]>[0]) {
    return this.exports.cancel(input);
  }

  closeAppSideEffects(appId: string) {
    return this.exports.closeApp(appId);
  }

  deletePreferences(appId: string) {
    return this.preferences.store.deleteApp(appId);
  }

  revoke(appId: string) {
    return this.projection.revoke(appId);
  }

  async quarantine(appId: string) {
    this.gateway.requestLeases.closeAdmission(appId);
    this.exports.closeAdmission(appId);
    await this.projection.revoke(appId);
  }

  async shutdown() {
    await this.queries.shutdown();
    await this.preferences.closeAndFlush();
    await this.exports.closeAndFlush();
    await this.cutovers.closeAndFlush();
  }

  private async drain(
    appId: string,
    generationId: string | null,
    deadlineMs: number
  ) {
    while (this.gateway.requestLeases.countApp(appId) > 0) {
      if (Date.now() >= deadlineMs) {
        throw Object.assign(new Error("APP_GUI_DRAIN_TIMEOUT"), { status: 409 });
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    if (generationId) await this.exports.drain(appId, generationId, deadlineMs);
  }

  /** 每一次 Base API 写调用都要问一遍，走不克隆的路由事实。 */
  private isActiveBinding(binding: BaseGuiLiveBinding) {
    const facts = this.store.routingFacts(binding.appId);
    return Boolean(
      facts &&
      facts.activeGenerationId === binding.generationId &&
      facts.activeContentDigest === binding.contentDigest &&
      facts.lifecycleRevision === binding.lifecycleRevision
    );
  }

  private requireSurfaceLeases() {
    if (!this.surfaceLeases) throw new Error("App GUI surface leases 尚未配置");
    return this.surfaceLeases;
  }
}
