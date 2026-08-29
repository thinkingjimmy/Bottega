/**
 * [INPUT]: Depends on managed install/configuration ports, typed health samples, candidate manifests, version catalogs, snapshot publication, and a serial action queue
 * [OUTPUT]: Provides the managed runtime lifecycle with identity-bracketed readiness proof, candidate switching/recovery, update discovery, and compensated actions
 * [POS]: The Memory runtime orchestration owner; it is the only layer allowed to convert a current ready sample into promotion authority
 */

import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type {
  MemoryConfigPanel,
  MemoryConfigIssue,
  MemoryProviderDescriptor,
  MemoryRuntimeOperation,
  MemoryRuntimeSnapshot,
  MemoryRuntimeStep,
} from "../../../../../shared/memory-ipc";
import { SerialQueue } from "../../../persistence/serial-queue";
import { renderRuntimeArgs, type InstallSpec } from "../../core/provider";
import { ManagedRuntimeConfigController } from "./config-controller";
import {
  defaultDownloader,
  defaultRunCommand,
  defaultRunCommandCaptured,
  ensureInitialized,
  exists,
  findPackagedTemplate,
  runCleanupActions,
  withOwnedServiceStopped,
  type Downloader,
  type RunCommand,
  type RunCommandCaptured,
} from "../managed/install-steps";
import {
  ManagedRoots,
  providerDataInstanceId,
  removeManagedRoot,
  rotateDataEpoch,
  wipeDataRoot,
  type ManagedManifest,
} from "../managed/manifest";
import { ManagedToolchain } from "../managed/toolchain";
import {
  operationSteps,
  operationStepTotal,
} from "../progress";
import { MemoryRuntimeSnapshotPublisher } from "../snapshot-publisher";
import {
  defaultRuntimeProbe,
  type RuntimeHealth,
  type RuntimeReadinessProof,
  waitForRuntimeReadiness,
} from "./health-monitor";
import { resolveInstallTarget } from "../managed/install-target";
import {
  commitReadyVersion,
  recoverManagedManifest,
  runManagedInstallPipeline,
} from "./install-pipeline";
import {
  assertSwitchVersion,
  RuntimeVersionCatalog,
} from "./version-catalog";
import {
  LaunchdIdentityController,
  readDiagnosticTail,
} from "./launchd-identity";
const LOG_LIMIT = 200;
/** uv 一行一帧会把 publish 打成噪声；日志立即追加，帧按此间隔节流。 */
const LOG_PUBLISH_INTERVAL_MS = 300;
export const MANAGED_RUNTIME_START_TIMEOUT_MS = 5 * 60_000;
const START_IDENTITY_POLL_MS = 500;
const DIAGNOSTIC_TAIL_BYTES = 16 * 1024;
const DIAGNOSTIC_LINE_LIMIT = 60;
export type CoordinatorOptions = {
  configPanel?: MemoryConfigPanel;
  platform?: NodeJS.Platform;
  uid?: number;
  runCommand?: RunCommand;
  runCommandCaptured?: RunCommandCaptured;
  download?: Downloader;
  probe?: (baseUrl: string) => Promise<boolean>;
  readHealth: (baseUrl: string) => Promise<RuntimeHealth>;
  fetcher?: typeof fetch;
  startTimeoutMs?: number;
  startIdentityPollMs?: number;
  launchAgentPath?: string;
  onPublish?: (snapshot: MemoryRuntimeSnapshot) => void;
  toolchain?: Pick<ManagedToolchain, "resolve">;
};

export class ManagedRuntimeCoordinator {
  readonly roots: ManagedRoots;
  private readonly queue = new SerialQueue();
  private readonly platform: NodeJS.Platform;
  private readonly uid: number;
  private readonly runCommand: RunCommand;
  private readonly runCommandCaptured: RunCommandCaptured;
  private readonly download: Downloader;
  private readonly probe: (baseUrl: string) => Promise<boolean>;
  private readonly readHealth: (baseUrl: string) => Promise<RuntimeHealth>;
  private readonly fetcher: typeof fetch;
  private readonly launchAgentPath: string;
  private readonly toolchain: Pick<ManagedToolchain, "resolve">;
  private readonly startTimeoutMs: number;
  private readonly startIdentityPollMs: number;
  private readonly config: ManagedRuntimeConfigController;
  private readonly publisher: MemoryRuntimeSnapshotPublisher;
  private readonly versionsOwner: RuntimeVersionCatalog;
  private readonly identity: LaunchdIdentityController;
  private operation: MemoryRuntimeOperation | null = null;
  private operationId: string | null = null;
  /* 一个字段，不是两个：从前 step（人话）与 stepKind（身份）并存，
     人话那份一路烤进快照直送界面，把中文钉死在了主进程里。 */
  private step: MemoryRuntimeStep | null = null;
  private stepIndex = 0;
  private stepTotal = 0;
  private operationStartedAt: number | null = null;
  private log: string[] = [];
  private error: string | null = null;
  private lastReadyProof: RuntimeReadinessProof | null = null;
  private reachable = false;
  private reachabilityGeneration = 0;

  constructor(
    userData: string,
    readonly descriptor: MemoryProviderDescriptor,
    readonly spec: InstallSpec,
    options: CoordinatorOptions
  ) {
    this.roots = new ManagedRoots(userData, descriptor.id);
    this.platform = options.platform ?? process.platform;
    this.uid = options.uid ?? process.getuid?.() ?? 0;
    this.runCommand = options.runCommand ?? defaultRunCommand();
    this.runCommandCaptured =
      options.runCommandCaptured ?? defaultRunCommandCaptured();
    this.download = options.download ?? defaultDownloader;
    this.probe = options.probe ?? defaultRuntimeProbe;
    this.readHealth = options.readHealth;
    this.fetcher = options.fetcher ?? fetch;
    this.startTimeoutMs =
      options.startTimeoutMs ?? MANAGED_RUNTIME_START_TIMEOUT_MS;
    this.startIdentityPollMs =
      options.startIdentityPollMs ?? START_IDENTITY_POLL_MS;
    this.launchAgentPath =
      options.launchAgentPath ??
      join(
        homedir(),
        "Library",
        "LaunchAgents",
        `${spec.launchLabel}.plist`
      );
    this.toolchain =
      options.toolchain ??
      new ManagedToolchain(join(userData, "memory-tools"), {
        runCaptured: this.runCommandCaptured,
        download: this.download,
      });
    this.publisher = new MemoryRuntimeSnapshotPublisher(
      (revision) => this.buildSnapshot(revision),
      options.onPublish
    );
    this.versionsOwner = new RuntimeVersionCatalog(
      spec.pypiPackage,
      this.fetcher,
      () => this.publish()
    );
    this.identity = new LaunchdIdentityController({
      displayName: descriptor.displayName,
      launchLabel: spec.launchLabel,
      uid: this.uid,
      runCaptured: this.runCommandCaptured,
      startTimeoutMs: this.startTimeoutMs,
      startPollMs: this.startIdentityPollMs,
    });
    this.config = new ManagedRuntimeConfigController({
      roots: this.roots,
      descriptor,
      spec,
      panel: options.configPanel,
      launchAgentPath: this.launchAgentPath,
      initialize: () => this.initialize(),
      withOwnedServiceStopped: (action, startAfter) =>
        this.withOwnedServiceStopped(action, startAfter),
      publish: () => this.publish(),
    });
  }
  get providerId() {
    return this.descriptor.id;
  }

  snapshot() {
    return this.publisher.snapshot();
  }
  private async buildSnapshot(revision: number): Promise<MemoryRuntimeSnapshot> {
    const manifest = await this.roots.readManifest();
    const marker = await this.roots.readMarker();
    const installed = await exists(this.roots.venvBinary(this.spec.executable));
    // serviceReachable 只表示托管实例可达；没有 manifest 就没有实例身份。
    const configured = await this.config.hasRequiredConfiguration();
    return {
      providerId: this.providerId,
      revision,
      supported: this.platform === "darwin",
      installed,
      serviceReachable: this.reachable,
      configured,
      phase: this.operation
        ? "running"
        : this.error
          ? "failed"
          : installed && !configured
            ? "configuration-required"
            : "idle",
      operation: this.operation,
      operationId: this.operationId,
      step: this.step,
      stepIndex: this.stepIndex,
      stepTotal: this.stepTotal,
      operationStartedAt: this.operationStartedAt,
      transfer: null,
      log: [...this.log],
      error: this.error,
      configIssue: this.config.issue,
      configModes: Object.fromEntries(
        Object.entries(manifest?.files ?? {}).map(([file, state]) => [file, state.mode])
      ),
      installedVersion: manifest?.installedVersion ?? null,
      versionChange: manifest?.versionChange ?? null,
      unverifiedVersion:
        manifest?.versionChange?.phase === "candidate-installed"
          ? manifest.versionChange.targetVersion
          : null,
      lockedVersion: this.spec.lockedVersion,
      ...this.versionsOwner.facts(manifest?.installedVersion ?? null),
      versionSource: manifest?.versionSource ?? null,
      versionHistory: manifest?.versionHistory ?? [],
      versionMatch: manifest
        ? manifest.installedVersion === this.spec.lockedVersion
        : null,
      instanceId: manifest?.instanceId ?? null,
      ownershipMarkerPresent: marker !== null,
      dataEpoch: manifest?.dataEpoch ?? null,
      providerDataInstanceId: manifest
        ? providerDataInstanceId(manifest)
        : null,
      installRoot: this.roots.installRoot,
      dataRoot: this.roots.dataRoot,
    };
  }

  manifest() {
    return this.roots.readManifest();
  }

  async recoverManifestFromMarker(marker: {
    instanceId: string;
    dataEpoch: string;
    ownershipToken: string;
  }) {
    return recoverManagedManifest({
      providerId: this.providerId,
      roots: this.roots,
      spec: this.spec,
      baseUrl: this.descriptor.defaultBaseUrl,
      marker,
    });
  }

  checkUpdates(force = false): Promise<MemoryRuntimeSnapshot> {
    return this.versionsOwner.check(force);
  }

  /* 读目录不是一次运行时操作：它不动磁盘、不动 launchd，只在 catalog
     owner 自己的 single-flight 里排队。放进串行队列的唯一效果是把
     phase 打成 running——面板整块变灰，只为了看一眼有哪些版本。 */
  versions(requireFresh = false) {
    return this.versionsOwner.versions(requireFresh);
  }

  ownershipValid(manifest: ManagedManifest | null) {
    return this.roots.ownershipValid(manifest);
  }

  hasRequiredConfiguration() {
    return this.config.hasRequiredConfiguration();
  }

  async extractionDestination() {
    return this.config.extractionDestination();
  }

  async previewExtractionDestination(submitted: Record<string, string>) {
    return this.config.previewDestination(submitted);
  }

  previewConfigIssueDestination(
    issue: MemoryConfigIssue,
    action: "regenerate" | "adopt-manual"
  ) {
    return this.config.previewIssueDestination(issue, action);
  }

  async hasManualConfig() {
    const manifest = await this.roots.readManifest();
    return Object.values(manifest?.files ?? {}).some(
      (state) => state.mode === "manual"
    );
  }

  hasConfigIssue(issue: MemoryConfigIssue) {
    return this.config.hasIssue(issue);
  }

  terminalSnapshot() {
    return this.refreshReachability();
  }

  async refreshReachability() {
    const generation = ++this.reachabilityGeneration;
    const manifest = await this.roots.readManifest();
    await this.config.detectIssue(manifest);
    const reachable = manifest
      ? await this.probe(manifest.baseUrl).catch(() => false)
      : false;
    if (generation !== this.reachabilityGeneration) return this.snapshot();
    this.reachable = reachable;
    const candidate =
      manifest?.versionChange?.phase === "candidate-installed"
        ? manifest.versionChange.targetVersion
        : null;
    if (reachable && manifest && candidate && !this.operation) {
      const proof = await this.readOwnedCandidateProof(
        manifest.baseUrl,
        candidate
      );
      if (
        generation === this.reachabilityGeneration &&
        !this.operation &&
        proof
      ) {
        this.lastReadyProof = proof;
        await commitReadyVersion({
          roots: this.roots,
          spec: this.spec,
          target: resolveInstallTarget(this.spec, candidate),
          measuredVersion: proof.version,
          ready: true,
        });
      }
    }
    return this.publish();
  }

  private async readOwnedCandidateProof(
    baseUrl: string,
    candidate: string
  ): Promise<RuntimeReadinessProof | null> {
    const ownedBefore = await this.identity
      .isOwnedServiceLive(baseUrl)
      .catch(() => false);
    if (!ownedBefore) return null;

    const health = await this.readHealth(baseUrl).catch(() => null);
    if (!health?.healthy || !health.ready || health.version !== candidate) {
      return null;
    }

    const ownedAfter = await this.identity
      .isOwnedServiceLive(baseUrl)
      .catch(() => false);
    return ownedAfter ? { version: health.version, ready: true } : null;
  }

  async assertOwnedOrAbsent(baseUrl = this.descriptor.defaultBaseUrl) {
    return this.identity.assertOwnedOrAbsent(baseUrl);
  }

  async isOwnedServiceLive(baseUrl = this.descriptor.defaultBaseUrl) {
    return this.identity.isOwnedServiceLive(baseUrl);
  }

  async assertServiceIdentity(baseUrl = this.descriptor.defaultBaseUrl) {
    return this.identity.assertServiceIdentity(baseUrl);
  }

  run(
    operation: MemoryRuntimeOperation,
    values?: Record<string, string>,
    version?: string
  ) {
    return this.queue.enqueue(async () => {
      if (this.platform !== "darwin") {
        throw new Error("当前平台暂不支持托管运行时");
      }
      this.operation = operation;
      this.operationId = `op_${randomUUID().replaceAll("-", "")}`;
      this.error = null;
      this.log = [];
      this.step = null;
      this.stepIndex = 0;
      this.stepTotal = operationStepTotal(operation);
      this.lastReadyProof = null;
      this.operationStartedAt = Date.now();
      await this.publish({ transfer: null });
      try {
        const result = await this.execute(operation, values, version);
        if (this.stepIndex !== this.stepTotal) {
          throw new Error(
            `运行时步骤未收敛：${this.stepIndex}/${this.stepTotal}`
          );
        }
        return result;
      } catch (cause) {
        await this.recordFailure(cause);
        throw new Error(this.error ?? "运行时操作失败", {
          cause: cause instanceof Error ? cause : undefined,
        });
      } finally {
        this.operation = null;
        this.step = null;
        this.stepIndex = 0;
        this.stepTotal = 0;
        this.operationStartedAt = null;
        await this.publish({ transfer: null });
      }
    });
  }

  private async execute(
    operation: MemoryRuntimeOperation,
    values?: Record<string, string>,
    version?: string
  ) {
    switch (operation) {
      case "install":
        return this.install({
          rotateIdentity: true,
          target: resolveInstallTarget(this.spec),
        });
      case "repair":
        return this.install({
          rotateIdentity: false,
          target: resolveInstallTarget(
            this.spec,
            (await this.roots.readManifest())?.installedVersion
          ),
        });
      case "upgrade":
        return this.upgrade(resolveInstallTarget(this.spec));
      case "switch-version":
        return this.upgrade(resolveInstallTarget(
          this.spec,
          assertSwitchVersion(
            version,
            (await this.beginStep(
              { kind: "refresh-version-catalog" },
              () => this.versionsOwner.versions(true)
            )).versions
          )
        ));
      case "config-write":
        return this.beginStep({ kind: "config-write" }, () =>
          this.config.write(values ?? {})
        );
      case "config-regenerate":
        return this.beginStep({ kind: "config-regenerate" }, () =>
          this.config.resolveIssue("regenerate")
        );
      case "config-adopt-manual":
        return this.beginStep(
          { kind: "config-adopt-manual" },
          () => this.config.resolveIssue("adopt-manual")
        );
      case "bootstrap":
        return this.beginStep({ kind: "bootstrap" }, () => this.bootstrap());
      case "bootout":
        return this.beginStep({ kind: "bootout" }, () => this.bootout());
      case "runtime-reset":
        return this.runtimeReset();
      case "uninstall":
        return this.uninstall();
      default:
        throw new Error(`未知的运行时操作：${operation}`);
    }
  }

  // instanceId 表示安装身份；受控 rebuild 与版本切换都保留它。
  private async install(input: {
    rotateIdentity: boolean;
    target: ReturnType<typeof resolveInstallTarget>;
  }) {
    const startAfter = await this.config.hasRequiredConfiguration();
    const result = await this.withOwnedServiceStopped(
      () => this.installWhileStopped(input, startAfter),
      startAfter,
      input.target.version,
      undefined,
      input.target
    );
    if (!startAfter) await this.completeSkippedStartupSteps();
    return result;
  }

  private async installWhileStopped(
    input: {
      rotateIdentity: boolean;
      target: ReturnType<typeof resolveInstallTarget>;
    },
    startAfter: boolean
  ) {
    return runManagedInstallPipeline({
      ...input,
      startAfter,
      roots: this.roots,
      spec: this.spec,
      descriptor: this.descriptor,
      launchAgentPath: this.launchAgentPath,
      toolchain: this.toolchain,
      download: this.download,
      fetcher: this.fetcher,
      config: this.config,
      initialize: () => this.initialize(),
      beginStep: (step, action) => this.beginStep(step, action),
      exec: (command, args, options) =>
        this.exec(command, args, options.timeoutMs, options.env),
      appendLog: (line) => this.appendLog(line),
      publish: (overrides) => this.publish(overrides),
    });
  }

  /* 升级只替换运行字节，不轮换安装身份。目标与已装版本相同时必须在
     动手之前拒绝：三阶段 versionChange 对同版是空操作（stageVersionChange
     直接早退），可 remove-plist/remove-venv 照删不误——那会留下一个
     「manifest 说装着、磁盘上什么都没有」的窗口。同版重装走 repair。 */
  private async upgrade(target: ReturnType<typeof resolveInstallTarget>) {
    const installedVersion = (await this.roots.readManifest())?.installedVersion;
    if (installedVersion === target.version) {
      throw new Error(
        `RUNTIME_VERSION_UNCHANGED: 目标版本 ${target.version} 与当前安装版本相同，请使用修复`
      );
    }
    const startAfter = await this.config.hasRequiredConfiguration();
    const result = await this.withOwnedServiceStopped(
      async () => {
        await this.beginStep({ kind: "remove-plist" }, async () => {
          await this.stageVersionChange(target.version, "intent");
          await rm(this.launchAgentPath, { force: true });
        });
        await this.beginStep({ kind: "remove-venv" }, async () => {
          await this.stageVersionChange(target.version, "installing");
          await rm(join(this.roots.installRoot, "venv"), {
            recursive: true,
            force: true,
          });
        });
        return this.installWhileStopped(
          { rotateIdentity: false, target },
          startAfter
        );
      },
      startAfter,
      target.version,
      async () => {
        await this.cleanupCandidateInstall();
      },
      target
    );
    if (!startAfter) await this.completeSkippedStartupSteps();
    return result;
  }

  private async cleanupCandidateInstall() {
    const manifest = await this.roots.readManifest();
    const change = manifest?.versionChange;
    if (!manifest || !change) return;
    if (change.phase === "candidate-installed") {
      await this.roots.writeManifest({
        ...manifest,
        versionChange: { ...change, phase: "installing" },
      });
    }
    const actions = [
      {
        label: "移除候选登录自启",
        run: () => rm(this.launchAgentPath, { force: true }),
      },
    ];
    if (change.phase !== "intent") actions.push({
        label: "移除候选运行环境",
        run: () => rm(join(this.roots.installRoot, "venv"), {
          recursive: true,
          force: true,
        }),
      });
    await runCleanupActions(actions);
  }
  private async stageVersionChange(
    targetVersion: string,
    phase: "intent" | "installing"
  ) {
    const manifest = await this.roots.readManifest();
    if (!manifest || manifest.installedVersion === targetVersion) return;
    await this.roots.writeManifest({
      ...manifest,
      versionChange: { targetVersion, phase },
    });
  }
  private async completeSkippedStartupSteps() {
    await this.beginStep(
      { kind: "bootstrap", context: "deferred" },
      async () => undefined
    );
    await this.beginStep(
      { kind: "await-ready", context: "deferred" },
      async () => undefined
    );
  }
  private async initialize() {
    const resolved = await this.config.resolvedValues();
    const manifest = await this.roots.readManifest();
    const outcome = await ensureInitialized({
      spec: this.spec,
      roots: this.roots,
      runInit: () =>
        this.exec(
          this.roots.venvBinary(this.spec.executable),
          renderRuntimeArgs(this.spec.initArgs ?? [], this.roots.dataRoot),
          120_000
        ),
      findTemplate: (file) => findPackagedTemplate(this.roots, file),
      values: resolved.values,
      missingRequired: resolved.missingRequired,
      skipFiles: new Set(
        Object.entries(manifest?.files ?? {}).flatMap(([file, state]) =>
          state.mode === "manual" ? [file] : []
        )
      ),
    });
    this.appendLog(`init: ${outcome.kind}`);
    if (outcome.kind === "built" && manifest) {
      await this.roots.writeManifest({
        ...manifest,
        files: {
          ...manifest.files,
          ...Object.fromEntries(
            Object.entries(outcome.files).map(([file, hash]) => [
              file,
              { mode: "managed" as const, hash },
            ])
          ),
        },
      });
    }
    if (outcome.kind === "needs-attention") {
      throw new Error(
        `${this.descriptor.displayName} 配置不完整：${outcome.detail}（缺 ${outcome.missing.join("、")}）`
      );
    }
    return outcome;
  }

  private async bootstrap() {
    await this.exec(
      "launchctl",
      ["bootstrap", `gui/${this.uid}`, this.launchAgentPath],
      15_000
    );
  }

  private async bootout(baseUrl?: string) {
    const effectiveBaseUrl =
      baseUrl ??
      (await this.roots.readManifest())?.baseUrl ??
      this.descriptor.defaultBaseUrl;
    await this.identity.bootout(effectiveBaseUrl);
  }

  private async runtimeReset() {
    const manifest = await this.roots.readManifest();
    if (!manifest) throw new Error("未找到托管安装，无法执行运行时重置");
    return this.withOwnedServiceStopped(async () => {
      const operationId = await this.beginStep({ kind: "wipe-data" }, async () => {
        const nextManifest = rotateDataEpoch(manifest);
        const id = await wipeDataRoot(this.roots, nextManifest);
        await this.roots.writeManifest({ ...nextManifest, files: {} });
        return id;
      });
      await this.beginStep({ kind: "initialize" }, () => this.initialize());
      await this.beginStep({ kind: "config-converge" }, () =>
        this.config.convergeManagedConfigs()
      );
      await this.beginStep({ kind: "install-plist" }, () =>
        this.config.installPlist()
      );
      return operationId;
    }, true);
  }

  // 卸载删除托管根；provider 无关的授权账本仍留在 outbox。
  private async uninstall() {
    await this.withOwnedServiceStopped(async () => {
      await this.beginStep({ kind: "remove-plist" }, () =>
        rm(this.launchAgentPath, { force: true })
      );
      await this.beginStep({ kind: "remove-root" }, () =>
        removeManagedRoot(this.roots)
      );
      this.setReachable(false);
    }, false);
  }

  private async awaitReady(baseUrl: string, expectedVersion: string | null) {
    this.lastReadyProof = null;
    const proof = await waitForRuntimeReadiness({
      read: () => this.readHealth(baseUrl),
      expectedVersion,
      timeoutMs: this.startTimeoutMs,
      displayName: this.descriptor.displayName,
    });
    if (!proof.ready) {
      this.appendLog("/ready 在等待期内仍未通过；服务已启动，保留警告继续使用");
    } else {
      this.appendLog("服务已就绪");
    }
    this.lastReadyProof = proof;
    this.setReachable(true);
  }
  private async withOwnedServiceStopped<T>(
    mutateWhileStopped: () => Promise<T>,
    startAfter: boolean,
    expectedVersion?: string,
    cleanupOnFailure?: () => Promise<void>,
    readyTarget?: ReturnType<typeof resolveInstallTarget>
  ) {
    const manifest = await this.roots.readManifest();
    const candidateVersion = manifest?.versionChange?.phase === "candidate-installed"
      ? manifest.versionChange.targetVersion
      : null;
    const promotionTarget = readyTarget ?? (
      candidateVersion ? resolveInstallTarget(this.spec, candidateVersion) : null
    );
    const baseUrl = manifest?.baseUrl ?? this.descriptor.defaultBaseUrl;
    const result = await withOwnedServiceStopped({
      assertOwnedOrAbsent: () => this.assertOwnedOrAbsent(baseUrl),
      bootoutWaitStopped: () => this.bootout(baseUrl),
      mutateWhileStopped,
      startAfter,
      bootstrap: () => this.beginStep({ kind: "bootstrap" }, async () => {
        if (startAfter) await this.bootstrap();
      }),
      assertServiceIdentity: () => this.assertServiceIdentity(baseUrl),
      awaitHealthy: () =>
        this.beginStep({ kind: "await-ready" }, async () => {
          if (startAfter) {
            await this.awaitReady(
              baseUrl,
              expectedVersion ?? candidateVersion ??
                (await this.roots.readManifest())?.installedVersion ?? null
            );
          }
        }),
      afterHealthy: async () => {
        if (startAfter) await this.assertServiceIdentity(baseUrl);
        if (!promotionTarget) return;
        const promotion = await commitReadyVersion({
          roots: this.roots,
          spec: this.spec,
          target: promotionTarget,
          measuredVersion: this.lastReadyProof?.version ?? null,
          ready: this.lastReadyProof?.ready ?? false,
        });
        if (!promotion.promoted) {
          this.appendLog(
            `候选版本 ${promotionTarget.version} 尚未通过 /ready，保留未验证状态`
          );
        }
      },
      /* 清理候选安装只由制造候选的动作显式传入（upgrade/switch-version）。
         配置写入、重生成与 runtime-reset 也会经过这里，它们的失败与候选
         无关——默认回落会把一个 durable candidate-installed 的 venv 删掉，
         用户下次提交密钥时才发现要重下二十分钟。 */
      cleanupOnFailure,
    });
    return result;
  }
  private async beginStep<T>(step: MemoryRuntimeStep, action: () => Promise<T>) {
    if (!this.operation) throw new Error("运行时步骤缺少活动操作");
    const expected = operationSteps(this.operation)[this.stepIndex];
    if (expected !== step.kind) {
      throw new Error(
        `运行时步骤顺序错误：期望 ${expected ?? "结束"}，实得 ${step.kind}`
      );
    }
    this.step = step;
    this.stepIndex += 1;
    /* 日志是技术流水，记身份而非译文：它要能被 grep、能跨语言比对，
       与界面上那句读给人听的话本就不是同一种东西。 */
    this.appendLog(`— ${step.kind}`);
    await this.publish();
    return action();
  }

  private async exec(
    command: string,
    args: string[],
    timeoutMs: number,
    env?: Record<string, string>
  ) {
    let lastPublishedAt = 0;
    try {
      await this.runCommand(command, args, {
        timeoutMs,
        ...(env ? { env } : {}),
        onLine: (line) => {
          this.appendLog(line);
          const now = Date.now();
          if (now - lastPublishedAt < LOG_PUBLISH_INTERVAL_MS) return;
          lastPublishedAt = now;
          void this.publish().catch(() =>
            console.warn("[memory] runtime progress publish failed")
          );
        },
      });
    } finally {
      /* 尾帧必发：被节流吞掉的最后几行常常正是失败原因。 */
      await this.publish().catch(() =>
        console.warn("[memory] runtime progress publish failed")
      );
    }
  }

  private appendLog(line: string) {
    this.log.push(line);
    if (this.log.length > LOG_LIMIT) {
      this.log.splice(0, this.log.length - LOG_LIMIT);
    }
  }

  private async recordFailure(cause: unknown) {
    const rawMessage = cause instanceof Error ? cause.message : String(cause);
    const message = await this.config
      .redactDiagnostic(rawMessage)
      .catch(() => "运行时操作失败");
    /* 只留原因，不拼「某步失败：」——那句前缀 renderer 已按 step 身份
       翻译着加了一遍（memory.runtime.stepFailed），两处各加一次，界面上
       读到的是「X failed: X失败：真正的原因」。 */
    this.error = message;
    this.appendLog(`× ${this.step?.kind ?? "operation"}: ${message}`);

    if (this.step?.kind !== "bootstrap" && this.step?.kind !== "await-ready") return;
    const logRoot = join(this.roots.root, "logs");
    for (const file of ["server.err.log", "server.log"]) {
      const tail = await readDiagnosticTail(join(logRoot, file), DIAGNOSTIC_TAIL_BYTES);
      if (!tail.trim()) continue;
      const safe = await this.config.redactDiagnostic(tail).catch(() => "");
      const lines = safe
        .split(/\r?\n/)
        .map((line) => line.trimEnd())
        .filter(Boolean)
        .slice(-DIAGNOSTIC_LINE_LIMIT);
      if (!lines.length) continue;
      this.appendLog(`— 本地服务日志 ${file}`);
      for (const line of lines) this.appendLog(line);
    }
  }

  private setReachable(reachable: boolean) {
    this.reachabilityGeneration += 1;
    this.reachable = reachable;
  }

  private publish(
    overrides?: Partial<Omit<MemoryRuntimeSnapshot, "providerId" | "revision">>
  ) {
    return this.publisher.publish(overrides);
  }
}
