/**
 * [INPUT]: Depends on Policy v4/Delivery, runtime-owned instance, platform capabilities, paged native-history Consent/rebuild controllers, service/support, and build/authorise/observe/run coordination
 * [OUTPUT]: Provides a platform-gated admission/recall/capture façade with native-segment history, independent Provider/statistical alerts, O(1) metadata, preview/Consent, pause/resume, delete, and rebuild recovery
 * [POS]: The main/memory/service chat combination root; Four Owners each keep the truth, Provider recall/capture Failed to get into canceled police, start recovery and attention
 */

import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { shell, type BrowserWindow } from "electron";
import {
  MEMORY_CHANNEL,
  type MemoryConsentReason,
  type MemoryEffectiveTarget,
  type MemoryFailureKind,
  type MemoryRuntimeConfigPreview,
  type MemoryStatusSnapshot,
} from "../../../../shared/memory-ipc";
import type { MemorySettings, MemorySharingMode } from "../../../../shared/settings-ipc";
import type { MemoryBackfillController } from "../orchestration/backfill-controller";
import type { MemoryCaptureController } from "../orchestration/capture-controller";
import {
  effectiveConsentDestination,
  reconcileRuntimeDestination,
} from "../orchestration/authority-controller";
import type {
  MemoryConsentController,
  ProductHistoryIntent,
} from "../orchestration/consent-controller";
import { composeMemoryControllers } from "./composition";
import {
  type FrozenTurnMemoryAdmission,
  type MemoryPrePromptValidation,
  type MemoryRecallProjection,
} from "../core/domain";
import { MemoryProviderError, type MemoryProvider } from "../core/provider";
import { MemoryDestructiveController } from "../orchestration/destructive-controller";
import { MemoryDeliveryStore } from "../delivery/store";
import { MemoryCleanupRunner } from "../delivery/cleanup-runner";
import { registerMemoryServiceIpc } from "./ipc-controller";
import { SHUTDOWN_GRACE_MS, type MemoryTurnSettledEvent } from "./memory-state";
import { MemoryTurnAdmissionPort, type CanonicalMemoryTurnSnapshot } from "../policy/admission";
import { MemoryPolicyStore } from "../policy/store";
import type { MemoryPauseController } from "../orchestration/pause-controller";
import type { MemoryRebuildController } from "../orchestration/rebuild-controller";
import { MEMORY_RECALL_TOTAL_TIMEOUT_MS, PromptContributionLease } from "../prompt-lane";
import { requireMemoryModule } from "../providers/registry";
import { MemoryHealthMonitor } from "../runtime/control/health-monitor";
import type { MemoryLifecycleOrchestrator } from "../runtime/control/lifecycle-orchestrator";
import { MemoryNetworkRuntime } from "../runtime/network-runtime";
import { MemoryWorkerLoop } from "../runtime/worker-loop";
import { MemoryAuthorityGuard } from "./support/memory-authority";
import type { MemoryServiceOptions } from "./support/memory-service-options";
import { authorizeMemoryRebuild } from "./support/rebuild-authorization";
import { MemoryMaintenanceController } from "./support/memory-maintenance";
import {
  MemoryForeignHistoryController,
  type ForeignMemorySourceSnapshot,
} from "../orchestration/foreign-history-controller";
import { RecallStatsStore } from "./recall-stats";
import {
  currentMemoryStatus,
  currentMemorySupply,
  performMemoryRecall,
  prepareMemoryContribution,
  recordSettledRecall,
} from "./support/memory-observability";
import { assertPlatformCapability } from "../../../../shared/platform-capabilities";

export class MemoryService {
  readonly policy: MemoryPolicyStore;
  readonly delivery: MemoryDeliveryStore;
  private readonly recallStats: RecallStatsStore;
  private provider: MemoryProvider | null = null;
  private target: MemoryEffectiveTarget | null = null;
  private memory: MemorySettings | null = null;
  private readonly health = new MemoryHealthMonitor();
  private readonly network = new MemoryNetworkRuntime();
  private readonly worker: MemoryWorkerLoop;
  private readonly admission: MemoryTurnAdmissionPort;
  private readonly authority: MemoryAuthorityGuard;
  private readonly capture: MemoryCaptureController;
  private readonly cleanup: MemoryCleanupRunner;
  private readonly backfill: MemoryBackfillController;
  private readonly rebuild: MemoryRebuildController;
  private readonly pauseControl: MemoryPauseController;
  private readonly consent: MemoryConsentController;
  private readonly foreignHistory: MemoryForeignHistoryController;
  private readonly maintenance: MemoryMaintenanceController;
  readonly destructive: MemoryDestructiveController;
  private readonly leases = new Set<PromptContributionLease>();
  private targetResolver: ((providerId: string) => Promise<MemoryEffectiveTarget>) | null = null;
  private lifecycle: MemoryLifecycleOrchestrator | null = null;
  private window: BrowserWindow | null = null;
  private accepting = false;
  private ownersInitialized = false;
  private ownersFlight: Promise<void> | null = null;
  private ownerFailure: MemoryFailureKind | null = null;
  private controlGeneration = 0;
  private lastCaptureAt: number | null = null;
  private lastPublished = "";
  private warning: string | null = null;
  private recallWarning: string | null = null;

  constructor(userData: string, private readonly options: MemoryServiceOptions) {
    const root = join(userData, "memory");
    this.policy = new MemoryPolicyStore(root);
    this.delivery = new MemoryDeliveryStore(root);
    this.recallStats = new RecallStatsStore(join(root, "recall-v1.json"));
    this.worker = new MemoryWorkerLoop(
      options.automaticWorker !== false,
      () => this.tick(),
      (task) => void this.network.track(task)
    );
    this.admission = new MemoryTurnAdmissionPort({
      policy: this.policy,
      intent: () => ({
        revision: this.controlGeneration,
        enabled: this.memory?.enabled ?? false,
        paused: this.memory?.paused ?? false,
        sharingMode: this.memory?.sharingMode ?? "chat",
      }),
      runtime: () => ({
        revision: this.controlGeneration,
        configured: Boolean(this.target?.canEnable && this.target.providerDataInstanceId),
        providerDataInstanceId: this.target?.providerDataInstanceId ?? "",
        providerId: this.target?.providerId ?? "",
        generation: this.controlGeneration,
      }),
      ownerFailure: () => this.ownerFailure,
      attention: ({ failureKind }) => {
        this.warning = `Memory 暂不可用（${failureKind}）`;
        this.publish();
      },
    });
    this.cleanup = new MemoryCleanupRunner({
      delivery: this.delivery,
      network: this.network,
      provider: (_instanceId, providerId) => {
        const provider = this.provider;
        if (!provider || provider.id !== providerId) return null;
        return {
          provider,
          descriptor: requireMemoryModule(providerId).descriptor,
        };
      },
    });
    this.authority = new MemoryAuthorityGuard({
      policy: this.policy,
      delivery: this.delivery,
      runtimes: options.runtimes,
      active: () => ({
        memory: this.memory,
        target: this.target,
        provider: this.provider,
        controlGeneration: this.controlGeneration,
      }),
      accepting: () => this.accepting,
      ownersAvailable: () => this.ownersInitialized && !this.ownerFailure,
      rebuildActive: () => this.rebuild.active(),
      rebuildBlocked: (providerId) => this.rebuild.blocked(providerId),
      refreshHealth: (rebuild) => this.refreshHealth(false, rebuild),
    });
    const controls = composeMemoryControllers({
      policy: this.policy,
      delivery: this.delivery,
      cleanup: this.cleanup,
      network: this.network,
      runtimes: options.runtimes,
      readChat: options.readChat,
      listChatSummaries: options.listChatSummaries,
      readNativeChatSegment: options.readNativeChatSegment,
      initializeOwners: () => this.initializeOwners(),
      resolveTarget: (providerId) => this.resolveTargetFresh(providerId),
      destination: (providerId) => this.destination(providerId),
      trusted: (context, rebuild) => this.authority.trustedProviderReady(
        context,
        new AbortController().signal,
        Date.now() + MEMORY_RECALL_TOTAL_TIMEOUT_MS,
        rebuild
      ),
      validateContext: (context) => this.authority.validateContext(context),
      validate: (context, proof, rebuild) =>
        this.authority.validateFrozen(context, proof, rebuild),
      providerId: () => this.requireTarget().providerId,
      runtime: () => this.target?.providerDataInstanceId
        ? {
            providerDataInstanceId: this.target.providerDataInstanceId,
            runtimeGeneration: this.controlGeneration,
          }
        : null,
      activateTarget: (next) => {
        this.target = next;
        this.changed();
        this.installProvider(next);
      },
      changed: () => this.changed(),
      captured: () => {
        this.lastCaptureAt = Date.now();
        this.warning = null;
      },
      publish: () => this.publish(),
    });
    this.consent = controls.consent;
    this.capture = controls.capture;
    this.backfill = controls.backfill;
    this.rebuild = controls.rebuild;
    this.pauseControl = controls.pause;
    this.foreignHistory = new MemoryForeignHistoryController({
      policy: this.policy,
      capture: this.capture,
      initializeOwners: () => this.initializeOwners(),
      active: () => ({
        providerDataInstanceId: this.target?.providerDataInstanceId ?? null,
        sharingMode: this.memory?.sharingMode ?? null,
        runtimeGeneration: this.controlGeneration,
      }),
      executionEnabled: () => this.authority.executionEnabled(),
    });
    this.maintenance = new MemoryMaintenanceController({
      delivery: this.delivery,
      cleanup: this.cleanup,
      rebuild: this.rebuild,
      initializeOwners: () => this.initializeOwners(),
      enforceActivationCleanup: () => this.enforceActivationCleanup(),
      setWarning: (message) => {
        this.warning = message;
      },
      publish: () => this.publish(),
      status: () => this.status(),
    });
    this.destructive = new MemoryDestructiveController({
      policy: this.policy,
      delivery: this.delivery,
      cleanup: this.cleanup,
      initializeOwners: () => this.initializeOwners(),
      ownerAvailable: () => !this.ownerFailure,
      hasMemoryHistory: () =>
        Boolean(
          this.memory?.enabled ||
            this.ownersInitialized ||
            existsSync(this.policy.filePath) ||
            existsSync(this.delivery.filePath)
        ),
      revoked: () => {
        this.controlGeneration += 1;
        this.revokeFreshLeases();
      },
    });
  }

  async initializeForPlatform(
    resolveTarget: () => Promise<MemoryEffectiveTarget>,
    memory: MemorySettings
  ) {
    if (!this.platformAvailable()) {
      this.target = null;
      this.provider = null;
      this.memory = Object.freeze({ ...memory, enabled: false });
      this.warning = "Memory is unavailable on this preview platform";
      this.publish();
      return;
    }
    await this.initialize(await resolveTarget(), memory);
  }

  async initialize(target: MemoryEffectiveTarget, memory: MemorySettings) {
    this.target = target;
    this.memory = memory;
    this.installProvider(target);
    try {
      await this.recallStats.initialize();
    } catch {
      /* RecallStatsStore 持有 durable 故障；Provider 成功只清瞬时告警。 */
    }
    /* 默认关闭时零 Policy/Delivery 写入、零 Chat 扫描。 */
    if (memory.enabled) await this.initializeOwners();
    this.publish();
  }
  completeStartup() {
    if (!this.platformAvailable()) return;
    this.accepting = true;
    this.worker.start();
    this.worker.kick();
  }
  setLifecycleOrchestrator(lifecycle: MemoryLifecycleOrchestrator) {
    this.lifecycle = lifecycle;
  }

  setTargetResolver(resolver: (providerId: string) => Promise<MemoryEffectiveTarget>) {
    this.targetResolver = resolver;
  }
  register(window: BrowserWindow, rendererUrl: string) {
    this.assertPlatformAvailable();
    this.window = window;
    this.lastPublished = "";
    registerMemoryServiceIpc(window, rendererUrl, {
      status: () => this.status(),
      refresh: () => this.refreshHealth(true),
      preview: (providerId, history, reason, sharingMode) =>
        this.consent.preview(providerId, history, reason, sharingMode),
      request: (providerId, history, reason, sharingMode, digest) =>
        this.consent.request(providerId, history, reason, sharingMode, digest),
      resolveAttention: (id, action) =>
        this.maintenance.resolveAttention(id, action),
      supply: () => this.supplyStreams(),
      reveal: (providerId) => this.revealDataRoot(providerId),
      closed: () => { if (this.window === window) this.window = null; },
    });
  }
  status(): MemoryStatusSnapshot {
    return currentMemoryStatus({
      memory: this.memory,
      target: this.target,
      policy: this.policy,
      delivery: this.delivery,
      rebuild: this.rebuild,
      health: this.health,
      recallStats: this.recallStats,
      lastCaptureAt: this.lastCaptureAt,
      warning: this.warning,
      recallWarning: this.recallWarning,
    });
  }
  async applyMemoryConfig(target: MemoryEffectiveTarget, memory: MemorySettings) {
    this.assertPlatformAvailable();
    if (this.network.isClosing) {
      throw new Error("Memory 运行时正在关停，配置稍后重试生效");
    }
    const changed =
      target.providerDataInstanceId !== this.target?.providerDataInstanceId ||
      target.baseUrl !== this.target?.baseUrl ||
      memory.enabled !== this.memory?.enabled ||
      memory.paused !== this.memory?.paused ||
      memory.sharingMode !== this.memory?.sharingMode;
    const pausing = memory.paused && this.memory?.paused === false;
    this.target = target;
    this.memory = memory;
    if (changed) {
      this.controlGeneration += 1;
      this.network.abortAll();
      /* 因暂停剥离的 contribution 按 §9.5 记 skipped(paused)，
         不得让后续 consume 误报 stale-capability。 */
      this.revokeFreshLeases(
        pausing ? { kind: "skipped", reason: "paused" } : undefined
      );
      this.installProvider(target);
    }
    if (memory.enabled) {
      await this.initializeOwners();
      await this.enforceActivationCleanup();
    }
    this.publish();
    if (this.authority.executionEnabled()) void this.refreshHealth(true);
  }
  prepareAdmission(canonical: CanonicalMemoryTurnSnapshot) {
    return this.admission.prepare(canonical);
  }
  async recall(input: Readonly<{
    admission: FrozenTurnMemoryAdmission;
    queryText: string;
    signal: AbortSignal;
    deadlineAt: number;
  }>): Promise<MemoryRecallProjection> {
    return performMemoryRecall({
      ...input,
      authority: this.authority,
      network: this.network,
      policy: this.policy,
      setWarning: (next) => {
        if (next === this.recallWarning) return;
        this.recallWarning = next;
        this.publish();
      },
    });
  }
  prepareContribution(
    admission: FrozenTurnMemoryAdmission,
    projection: MemoryRecallProjection
  ) {
    return prepareMemoryContribution(admission, projection, this.authority, this.leases);
  }
  async onTurnSettled(event: MemoryTurnSettledEvent, memoryAuthorized: boolean) {
    try {
      await this.capture.settle(event, memoryAuthorized);
    } catch (cause) {
      const detail = cause instanceof MemoryProviderError
        ? `：${cause.message.slice(0, 500)}`
        : "";
      this.warning = `Memory 交付暂未完成（capture）${detail}`;
    }
    await recordSettledRecall(this.recallStats, event);
    this.publish();
  }
  supplyStreams() {
    return currentMemorySupply({
      enabled: Boolean(this.memory?.enabled),
      paused: Boolean(this.memory?.paused),
      initialized: this.ownersInitialized,
      policy: this.policy,
      delivery: this.delivery,
      readChatRef: this.options.readChatRef,
    });
  }
  revealDataRoot(providerId: string) {
    const root = this.options.runtimes.require(providerId).roots.dataRoot;
    if (!existsSync(root)) throw new Error("Memory 数据目录尚未创建");
    shell.showItemInFolder(root);
  }
  async importForeignHistory(input: Readonly<{
    grantId: string;
    snapshots: readonly ForeignMemorySourceSnapshot[];
    authorization: Readonly<{
      sharingMode: MemorySharingMode;
      providerId: string | null;
      providerDataInstanceId: string | null;
      consentEpochId: string | null;
    }>;
  }>) {
    return this.foreignHistory.import(input);
  }
  async previewExistingProductHistory() {
    const target = this.requireTarget();
    const sharingMode = this.memory?.sharingMode ?? "chat";
    const { preview, intent } = await this.consent.previewProductHistory(
      target.providerId,
      sharingMode
    );
    return { ...preview, intent };
  }
  async commitExistingProductHistory(
    grantId: string,
    intent: ProductHistoryIntent
  ) {
    await this.consent.commitProductHistory(
      productHistoryOperationId(grantId),
      intent
    );
    this.worker.kick();
    this.publish();
  }

  existingProductHistoryCommitted(grantId: string) {
    return this.consent.productHistoryCommitted(
      productHistoryOperationId(grantId)
    );
  }

  previewConsent(
    providerId: string,
    includeHistory: boolean,
    reason: MemoryConsentReason,
    sharingMode: MemorySharingMode
  ) {
    return this.consent.preview(providerId, includeHistory, reason, sharingMode);
  }

  previewRebuild(providerId: string, excludedChatIds: ReadonlySet<string>) {
    return this.consent.preview(
      providerId,
      true,
      "rebuild",
      this.memory?.sharingMode ?? "chat",
      excludedChatIds
    );
  }

  requestConsentAuthority(
    providerId: string,
    includeHistory: boolean,
    reason: MemoryConsentReason,
    sharingMode: MemorySharingMode,
    previewDigest: string
  ) {
    return this.consent.request(
      providerId,
      includeHistory,
      reason,
      sharingMode,
      previewDigest
    );
  }
  async consumeConsentAuthority(
    token: string,
    target: MemoryEffectiveTarget,
    purpose: "live" | "configuration" = "live"
  ) {
    const authority = await this.consent.consume(token, target, purpose);
    this.controlGeneration += 1;
    return authority;
  }

  /** Runtime Owner 已落盘后、重新开放交付前的 Consent matrix 收敛点。
      hostname 变化必须消费 UI capability；model-only 也创建 silent Epoch，
      从而让每份授权永远记住它真实发往的目的地。 */
  async reconcileRuntimeConfig(
    preview: MemoryRuntimeConfigPreview,
    confirmed: boolean
  ) {
    return reconcileRuntimeDestination(
      {
        policy: this.policy,
        initializeOwners: () => this.initializeOwners(),
        active: () => this.authority.snapshot(),
        changed: () => this.changed(),
        publish: () => this.publish(),
      },
      preview,
      confirmed
    );
  }
  async consentDestination(providerId: string, providerDataInstanceId: string) {
    await this.initializeOwners();
    return effectiveConsentDestination(
      this.policy,
      providerId,
      providerDataInstanceId
    );
  }
  async pause() {
    /* 先以 paused 原因 latch 全部 fresh lease：changed() 的通用 revoke
       默认 stale-capability，会把「因暂停剥离」误报成域内故障（§9.5）。 */
    this.revokeFreshLeases({ kind: "skipped", reason: "paused" });
    return this.pauseControl.pause();
  }
  async resume(
    target: MemoryEffectiveTarget = this.requireTarget(),
    sharingMode: MemorySharingMode = this.memory?.sharingMode ?? "chat"
  ) {
    return this.pauseControl.resume(target, sharingMode);
  }

  /** disable 撤销边（幂等）：无可撤内容零写入；有则闭合 Epoch 并撤 leases。 */
  async revokeConsentForDisable(providerId: string) {
    await this.initializeOwners();
    const state = this.policy.snapshot().state;
    const hasOpenConsent = Boolean(this.policy.currentConsent());
    if (!hasOpenConsent && state.pausedAt === null) return;
    await this.policy.revokeForDisable(`disable:${providerId}:${randomUUID()}`);
    this.revokeFreshLeases();
    this.publish();
  }

  snapshotProjectRebind(projectId: string) {
    return this.destructive.snapshotProjectRebind(projectId);
  }

  /** Project 改绑显式 retain/new；Policy receipt 必须先于 Project source CAS。 */
  async prepareProjectRebind(
    projectId: string,
    operationId: string,
    expectation: {
      expectedOldMemorySpaceId: string | null;
      expectedSpaceGenerationRevision: number | null;
      mode: "retain" | "new";
    }
  ) {
    return this.destructive.prepareProjectRebind(
      projectId,
      operationId,
      expectation
    );
  }
  async reconcile() {
    if (!this.platformAvailable()) return;
    if (this.memory?.enabled) await this.initializeOwners();
    this.worker.kick();
  }
  async refreshHealth(force: boolean, rebuild = false) {
    const target = this.target;
    const provider = this.provider;
    if (
      !rebuild &&
      target?.managed &&
      !this.lifecycle?.isHeld(target.providerId)
    ) {
      const runtime = await this.options.runtimes.refresh(target.providerId);
      if (runtime.configIssue) {
        this.warning = "Memory 受管配置已漂移，已保持隔离";
        this.health.reset();
        this.publish();
        return this.status();
      }
    }
    if ((!rebuild && !this.authority.executionEnabled()) || !target || !provider) {
      this.health.reset();
      return this.status();
    }
    const generation = this.controlGeneration;
    const fingerprint = target.providerDataInstanceId ?? target.baseUrl;
    const verifyIdentity = this.authority.identityVerifier();
    return this.health.refresh({
      force,
      control: { generation, effectiveFingerprint: fingerprint },
      provider,
      network: this.network,
      current: () => ({
        generation: this.controlGeneration,
        effectiveFingerprint:
          this.target?.providerDataInstanceId ?? this.target?.baseUrl ?? "",
      }),
      publish: () => this.publish(),
      status: () => this.status(),
      ...(verifyIdentity ? { verifyIdentity } : {}),
    });
  }

  rebuildActive() {
    return this.rebuild.active();
  }
  async prepareRebuildRecovery() {
    this.assertPlatformAvailable();
    return this.maintenance.prepareRebuildRecovery();
  }
  async recoverRebuilds() {
    this.assertPlatformAvailable();
    return this.maintenance.recoverRebuilds();
  }

  stopAdmission() {
    this.accepting = false;
  }
  async reopen() {
    this.network.reopen();
    this.accepting = true;
    if (this.ownersInitialized) {
      await this.policy.bumpRevocation(
        `reopen:${randomUUID()}`,
        "runtime-reopen",
        "scope-policy:manual-v1"
      );
      this.controlGeneration += 1;
    }
    this.worker.start();
  }
  async quiesce() {
    this.accepting = false;
    this.worker.stop();
    this.revokeFreshLeases();
    if (this.ownersInitialized) {
      await this.policy.bumpRevocation(
        `quiesce:${randomUUID()}`,
        "runtime-quiesce",
        "scope-policy:manual-v1"
      );
      this.controlGeneration += 1;
    }
    this.network.beginDraining();
    this.network.abortAll();
    await this.network.shutdown(this.options.shutdownGraceMs ?? SHUTDOWN_GRACE_MS);
  }

  terminalPublish() {
    this.lastPublished = "";
    this.publish();
  }
  async authorizeRebuild(providerId: string) {
    return authorizeMemoryRebuild(
      providerId,
      this.requireTarget(),
      this.options.runtimes
    );
  }
  async rebuildWithinLifecycle(providerId: string, requestedOperationId?: string) {
    const instanceId = await this.authorizeRebuild(providerId);
    await this.initializeOwners();
    const operationId = requestedOperationId ?? `rebuild:${randomUUID()}`;
    await this.rebuild.start({
      operationId,
      providerDataInstanceId: instanceId,
      providerId,
    });
  }
  async shutdown() {
    this.accepting = false;
    this.worker.stop();
    this.network.beginDraining();
    await this.network.shutdown(this.options.shutdownGraceMs ?? SHUTDOWN_GRACE_MS);
  }
  async closeAndFlush() {
    await this.recallStats.closeAndFlush();
    if (!this.ownersInitialized) return;
    await Promise.all([this.policy.closeAndFlush(), this.delivery.closeAndFlush()]);
  }

  runWorkerOnce() {
    this.assertPlatformAvailable();
    return this.tick();
  }
  private async initializeOwners() {
    this.assertPlatformAvailable();
    if (this.ownersInitialized || this.ownerFailure) return;
    if (!this.ownersFlight) {
      this.ownersFlight = (async () => {
        try {
          const policy = await this.policy.initialize();
          if (!policy.initialized) {
            this.ownerFailure = "policy-store";
            this.warning = "Memory Policy 账本初始化失败；聊天仍可正常使用";
            return;
          }
          await this.delivery.initialize();
          this.ownersInitialized = true;
        } catch {
          this.ownerFailure = this.policy.snapshot().initialized
            ? "initialization"
            : "policy-store";
          this.warning = "Memory 子系统初始化失败；聊天仍可正常使用";
        }
      })().finally(() => {
        this.ownersFlight = null;
      });
    }
    await this.ownersFlight;
  }
  private installProvider(target: MemoryEffectiveTarget) {
    this.assertPlatformAvailable();
    const module = requireMemoryModule(target.providerId);
    this.provider =
      this.options.providerFactory?.(target.providerId, target.baseUrl) ??
      module.createProvider({ baseUrl: target.baseUrl });
    this.health.reset();
  }
  private async destination(providerId: string) {
    const destination = await this.options.runtimes.require(providerId).extractionDestination();
    if (!destination) throw new Error("提取服务目的地尚未配置");
    return destination;
  }
  private revokeFreshLeases(reason?: MemoryPrePromptValidation) {
    for (const lease of this.leases) lease.revoke(reason);
    this.leases.clear();
  }
  private changed() {
    this.controlGeneration += 1;
    this.revokeFreshLeases();
  }
  private requireTarget() {
    this.assertPlatformAvailable();
    if (!this.target) throw new Error("Memory 目标尚未解析");
    return this.target;
  }
  private resolveTargetFresh(providerId: string) {
    this.assertPlatformAvailable();
    if (!this.targetResolver) throw new Error("Memory target resolver 尚未就绪");
    return this.targetResolver(providerId);
  }

  private platformAvailable() {
    return this.options.platformSupport.capabilities.memory;
  }

  private assertPlatformAvailable() {
    assertPlatformCapability(this.options.platformSupport, "memory");
  }
  /* pending cleanup 只投影为可见状态，绝不自动发起破坏性 rebuild：
     rebuild = 清空 data root + 全量重提取（消耗第三方 API 费用），
     必须由用户在带范围/目的地/费用披露的重建确认面显式触发。
     recall/capture 的 fail-closed 由 executionEnabled() 的
     activationCleanupOperation 门保证，与本告警互补。 */
  private async enforceActivationCleanup() {
    const instanceId = this.target?.providerDataInstanceId;
    const operationId = instanceId
      ? this.delivery.activationCleanupOperation(instanceId)
      : null;
    if (!operationId || this.rebuild.active() || !this.memory?.enabled) return;
    this.warning =
      "记忆库有待完成的清理，长期记忆暂不可用；请在设置中执行「重建记忆」";
  }
  private async tick() {
    if (!this.authority.executionEnabled() || this.network.isStopping) {
      this.publish();
      return;
    }
    try {
      await this.refreshHealth(false);
      await this.cleanup.driveOne();
      await this.backfill.tick();
    } catch {
      /* 周期探针只更新 degraded 状态，不向应用生命周期抛错。 */
    }
    this.publish();
  }
  private publish() {
    const window = this.window;
    if (!window || window.isDestroyed()) return;
    const status = this.status();
    const encoded = JSON.stringify(status);
    if (encoded === this.lastPublished) return;
    try {
      window.webContents.send(MEMORY_CHANNEL.status, status);
      this.lastPublished = encoded;
    } catch {
      /* renderer 已关闭不影响 Memory/Chat。 */
    }
  }
}

const productHistoryOperationId = (grantId: string) =>
  `history-product:${grantId}`;
