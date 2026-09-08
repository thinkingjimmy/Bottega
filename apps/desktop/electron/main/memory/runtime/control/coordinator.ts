/**
 * [INPUT]: Depends on managed install/configuration ports, typed health samples, candidate manifests, version catalogs, snapshot publication, the operation progress ledger, the install/upgrade runners, and a serial action queue
 * [OUTPUT]: Provides the managed runtime lifecycle with identity-bracketed readiness proof, candidate switching/recovery, update discovery, and compensated actions
 * [POS]: The Memory runtime orchestration owner; it is the only layer allowed to convert a current ready sample into promotion authority
 */

import { rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type {
  MemoryConfigPanel,
  MemoryConfigIssue,
  MemoryProviderDescriptor,
  MemoryRuntimeOperation,
  MemoryRuntimeSnapshot,
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
  runManagedInstall,
  runManagedUpgrade,
  type ManagedInstallPorts,
  type StoppedServiceOptions,
} from "./install-pipeline";
import { RuntimeOperationProgress } from "./operation-progress";
import {
  assertSwitchVersion,
  RuntimeVersionCatalog,
} from "./version-catalog";
import { LaunchdIdentityController } from "./launchd-identity";
export const MANAGED_RUNTIME_START_TIMEOUT_MS = 5 * 60_000;
const START_IDENTITY_POLL_MS = 500;
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
  private readonly progress: RuntimeOperationProgress;
  private readonly installPorts: ManagedInstallPorts;
  private readonly versionsOwner: RuntimeVersionCatalog;
  private readonly identity: LaunchdIdentityController;
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
    this.progress = new RuntimeOperationProgress({
      runCommand: options.runCommand ?? defaultRunCommand(),
      publish: (overrides) => this.publisher.publish(overrides),
      redactDiagnostic: (detail) => this.config.redactDiagnostic(detail),
      logRoot: join(this.roots.root, "logs"),
    });
    this.versionsOwner = new RuntimeVersionCatalog(
      spec.pypiPackage,
      this.fetcher,
      () => this.publisher.publish()
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
      publish: () => this.publisher.publish(),
    });
    this.installPorts = {
      roots: this.roots,
      spec,
      descriptor,
      launchAgentPath: this.launchAgentPath,
      toolchain: this.toolchain,
      download: this.download,
      fetcher: this.fetcher,
      config: this.config,
      initialize: () => this.initialize(),
      beginStep: (step, action) => this.progress.beginStep(step, action),
      exec: (command, args, execOptions) =>
        this.progress.exec(command, args, execOptions),
      appendLog: (line) => this.progress.appendLog(line),
      publish: (overrides) => this.publisher.publish(overrides),
      withOwnedServiceStopped: (action, startAfter, stopOptions) =>
        this.withOwnedServiceStopped(action, startAfter, stopOptions),
    };
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
    const progress = this.progress.facts();
    return {
      providerId: this.providerId,
      revision,
      supported: this.platform === "darwin",
      installed,
      serviceReachable: this.reachable,
      configured,
      phase: progress.operation
        ? "running"
        : progress.error
          ? "failed"
          : installed && !configured
            ? "configuration-required"
            : "idle",
      ...progress,
      transfer: null,
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
    if (reachable && manifest && candidate && !this.progress.active) {
      const proof = await this.readOwnedCandidateProof(
        manifest.baseUrl,
        candidate
      );
      if (
        generation === this.reachabilityGeneration &&
        !this.progress.active &&
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
    return this.publisher.publish();
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
      this.lastReadyProof = null;
      return this.progress.run(operation, () =>
        this.execute(operation, values, version)
      );
    });
  }

  private async execute(
    operation: MemoryRuntimeOperation,
    values?: Record<string, string>,
    version?: string
  ) {
    switch (operation) {
      case "install":
        return runManagedInstall(this.installPorts, {
          rotateIdentity: true,
          target: resolveInstallTarget(this.spec),
        });
      case "repair":
        return runManagedInstall(this.installPorts, {
          rotateIdentity: false,
          target: resolveInstallTarget(
            this.spec,
            (await this.roots.readManifest())?.installedVersion
          ),
        });
      case "upgrade":
        return runManagedUpgrade(this.installPorts, resolveInstallTarget(this.spec));
      case "switch-version":
        return runManagedUpgrade(this.installPorts, resolveInstallTarget(
          this.spec,
          assertSwitchVersion(
            version,
            (await this.progress.beginStep(
              { kind: "refresh-version-catalog" },
              () => this.versionsOwner.versions(true)
            )).versions
          )
        ));
      case "config-write":
        return this.progress.beginStep({ kind: "config-write" }, () =>
          this.config.write(values ?? {})
        );
      case "config-regenerate":
        return this.progress.beginStep({ kind: "config-regenerate" }, () =>
          this.config.resolveIssue("regenerate")
        );
      case "config-adopt-manual":
        return this.progress.beginStep(
          { kind: "config-adopt-manual" },
          () => this.config.resolveIssue("adopt-manual")
        );
      case "bootstrap":
        return this.progress.beginStep({ kind: "bootstrap" }, () => this.bootstrap());
      case "bootout":
        return this.progress.beginStep({ kind: "bootout" }, () => this.bootout());
      case "runtime-reset":
        return this.runtimeReset();
      case "uninstall":
        return this.uninstall();
      default:
        throw new Error(`未知的运行时操作：${operation}`);
    }
  }

  private async initialize() {
    const resolved = await this.config.resolvedValues();
    const manifest = await this.roots.readManifest();
    const outcome = await ensureInitialized({
      spec: this.spec,
      roots: this.roots,
      runInit: () =>
        this.progress.exec(
          this.roots.venvBinary(this.spec.executable),
          renderRuntimeArgs(this.spec.initArgs ?? [], this.roots.dataRoot),
          { timeoutMs: 120_000 }
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
    this.progress.appendLog(`init: ${outcome.kind}`);
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
    await this.progress.exec(
      "launchctl",
      ["bootstrap", `gui/${this.uid}`, this.launchAgentPath],
      { timeoutMs: 15_000 }
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
      const operationId = await this.progress.beginStep({ kind: "wipe-data" }, async () => {
        const nextManifest = rotateDataEpoch(manifest);
        const id = await wipeDataRoot(this.roots, nextManifest);
        await this.roots.writeManifest({ ...nextManifest, files: {} });
        return id;
      });
      await this.progress.beginStep({ kind: "initialize" }, () => this.initialize());
      await this.progress.beginStep({ kind: "config-converge" }, () =>
        this.config.convergeManagedConfigs()
      );
      await this.progress.beginStep({ kind: "install-plist" }, () =>
        this.config.installPlist()
      );
      return operationId;
    }, true);
  }

  // 卸载删除托管根；provider 无关的授权账本仍留在 outbox。
  private async uninstall() {
    await this.withOwnedServiceStopped(async () => {
      await this.progress.beginStep({ kind: "remove-plist" }, () =>
        rm(this.launchAgentPath, { force: true })
      );
      await this.progress.beginStep({ kind: "remove-root" }, () =>
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
      this.progress.appendLog("/ready 在等待期内仍未通过；服务已启动，保留警告继续使用");
    } else {
      this.progress.appendLog("服务已就绪");
    }
    this.lastReadyProof = proof;
    this.setReachable(true);
  }
  private async withOwnedServiceStopped<T>(
    mutateWhileStopped: () => Promise<T>,
    startAfter: boolean,
    { expectedVersion, cleanupOnFailure, readyTarget }: StoppedServiceOptions = {}
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
      bootstrap: () => this.progress.beginStep({ kind: "bootstrap" }, async () => {
        if (startAfter) await this.bootstrap();
      }),
      assertServiceIdentity: () => this.assertServiceIdentity(baseUrl),
      awaitHealthy: () =>
        this.progress.beginStep({ kind: "await-ready" }, async () => {
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
          this.progress.appendLog(
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

  private setReachable(reachable: boolean) {
    this.reachabilityGeneration += 1;
    this.reachable = reachable;
  }
}
