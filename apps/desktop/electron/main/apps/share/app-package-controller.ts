/**
 * [INPUT]: Depends on Apps package IPC, RepoProbe/main-owned PresetCatalog/SourceResolver/AppConfig/gh Detection, Base importer, optional immutable factory flow, ShareFlow, and canonical AppRecord query port
 * [OUTPUT]: Provides typed package admission, durable original-candidate resumption, explicit update application, pending configuration and existing install/share ownership.
 * [POS]: apps/share package-installation front door; AppsService retains only the general App lifecycle while package/distribution details stay encapsulated here
 */

import { AppCompatibilityRequests, appCompatibilityRequests } from "../compatibility/requests";
import type { AppRepoProbeResult, PresetProbeResult } from "../../../../shared/apps-ipc";
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { join } from "node:path";
import {
  APPS_CHANNEL,
  type AddAppInput,
  type AppConfigValue,
  type AppRecord,
  type InstallPresetInput,
  type SharePreviewInput,
  type SharePublishInput,
} from "../../../../shared/apps-ipc";
import type { AgentBackendId } from "../../../../shared/agent-ipc";
import type { RendererIpc } from "../../ipc-registrar";
import type { BaseAppImporter } from "../install/import-base-app";
import { PresetCatalog } from "../../preset-catalog";
import {
  AppConfigStore,
  EMPTY_APP_CONFIG,
} from "./app-config-store";
import { detectGhStatus } from "./gh-detect";
import { AppCandidateUnavailableError, RepoProbeService } from "./package/repo-probe";
import {
  PresetInstallService,
  type PresetFactoryFlow,
} from "./preset/preset-install-service";
import { PresetSourceResolver } from "./preset/preset-source";
import type { ShareFlow } from "./share-flow";
import type { AppExtensionIntegration } from "../../extensions/integration/app-extension-composition";

const README_BYTE_LIMIT = 256 * 1024;

type ControllerPorts = {
  assertAppId(value: unknown): string;
  requireRecord(appId: string): AppRecord;
  normalizeRepo(value: string): { repoUrl: string };
  resolvePresetAgent(): Promise<AgentBackendId>;
};

export class AppPackageController {
  readonly compatibility: AppCompatibilityRequests;
  readonly configs: AppConfigStore;
  readonly presets: PresetCatalog;
  private readonly probes: RepoProbeService;
  private readonly presetInstaller: PresetInstallService;
  private importer: BaseAppImporter | null = null;
  private shareFlow: ShareFlow | null = null;
  private updatePort: Pick<import("../source/app-installer").AppInstaller, "resumeCompatibility" | "applyCompatibility"> | null = null;
  configureCompatibilityUpdates(port: NonNullable<AppPackageController["updatePort"]>) { this.updatePort = port; }

  constructor(userData: string, presets = new PresetCatalog()) {
    this.compatibility = appCompatibilityRequests(userData);
    this.configs = new AppConfigStore(userData);
    this.probes = new RepoProbeService(userData);
    this.presets = presets;
    this.presetInstaller = new PresetInstallService(
      new PresetSourceResolver(presets),
      this.probes,
      () => this.requireImporter()
    );
  }

  configure(importer: BaseAppImporter, shareFlow: ShareFlow) {
    if (this.importer || this.shareFlow) throw new Error("App package flows 已配置");
    this.importer = importer;
    this.shareFlow = shareFlow;
  }

  configureFactoryPreset(factory: PresetFactoryFlow) {
    this.presetInstaller.configureFactory(factory);
  }

  configureExtensions(integration: AppExtensionIntegration) {
    this.probes.configureExtensions(integration.installer);
  }

  importBase(input: {
    request: AddAppInput;
    repoUrl: string;
    agent: AgentBackendId;
  }) {
    const { preflightId, confirmedDigest } = input.request;
    if (!preflightId || !confirmedDigest) {
      throw new Error("Base App preflight 参数不完整");
    }
    const authorization = assertInstallAuthorization(input.request.authorization);
    const probe = this.probes.consume(
      preflightId,
      confirmedDigest,
      input.repoUrl
    );
    return this.requireImporter().import({
      requestId: preflightId,
      source: {
        origin: "github",
        ref: input.repoUrl,
        digest: confirmedDigest,
        packageRoot: probe.packageRoot,
        candidate: probe.candidate,
        extensionPreflights: probe.extensionPreflights,
      },
      agent: input.agent,
      config: input.request.config ?? structuredClone(EMPTY_APP_CONFIG),
      authorization,
    });
  }

  hasPendingImport(appId: string) {
    return this.requireImporter().hasPending(appId);
  }

  retryPendingImport(appId: string) {
    return this.requireImporter().retryPending(appId);
  }

  cancelPendingImport(appId: string) {
    return this.requireImporter().cancelPending(appId);
  }

  /** 首方预设仍先冻结并绑定 digest；跳过的只是第三方代码风险确认。 */
  async installPreset(input: InstallPresetInput, agent: AgentBackendId) {
    return this.presetInstaller.install({
      ...input,
    }, agent, input.config ?? structuredClone(EMPTY_APP_CONFIG));
  }

  environment(appId: string, record: AppRecord) {
    return this.configs.environment(
      appId,
      record.manifest?.requirements?.tools ?? []
    );
  }

  register(ipc: RendererIpc, ports: ControllerPorts) {
    ipc
      .handle(APPS_CHANNEL.probeRepo, (rawUrl) =>
        this.compatibility.guard(() => this.probes.probe(ports.normalizeRepo(String(rawUrl)).repoUrl))
      )
      .handle(APPS_CHANNEL.discardProbe, (rawPreflightId) =>
        this.probes.discard(String(rawPreflightId))
      )
      .handle(APPS_CHANNEL.probePreset, (rawPresetId) =>
        this.compatibility.guard(() => this.presetInstaller.probePreset(assertPresetId(rawPresetId)))
      )
      .handle(APPS_CHANNEL.discardPresetProbe, (rawPreflightId) =>
        this.presetInstaller.discard(String(rawPreflightId))
      )
      .handle(APPS_CHANNEL.installPreset, async (rawInput) =>
        this.compatibility.guard(async () => this.installPreset(
          assertInstallPresetInput(rawInput),
          await ports.resolvePresetAgent()
        ))
      )
      .handle(APPS_CHANNEL.compatibilityRequests, () => this.compatibility.list())
      .handle(APPS_CHANNEL.resumeCompatibility, (requestId) => this.compatibility.guard(() => this.resumeCompatibility(String(requestId))))
      .handle(APPS_CHANNEL.applyCompatibility, (requestId) => this.compatibility.guard(async () => {
        const saved = await this.compatibility.require(String(requestId));
        if (!saved.candidate.appId || !this.updatePort) throw new Error("App update is unavailable");
        const checked = await this.updatePort.resumeCompatibility(saved.candidate.appId, saved.candidate.contentDigest);
        if (checked.kind !== "installed-update") return checked;
        await this.updatePort.applyCompatibility(saved.candidate.appId, saved.candidate.contentDigest);
        await this.compatibility.forget(String(requestId));
        return { kind: "updated" } as const;
      }))
      .handle(APPS_CHANNEL.forgetCompatibility, (requestId) => this.compatibility.forget(String(requestId)))
      .handle(APPS_CHANNEL.ghStatus, () => detectGhStatus())
      .handle(APPS_CHANNEL.readConfig, (rawId) => {
        const appId = ports.assertAppId(rawId);
        ports.requireRecord(appId);
        return this.configs.read(appId);
      })
      .handle(APPS_CHANNEL.writeConfig, (rawId, rawConfig) => {
        const appId = ports.assertAppId(rawId);
        const record = ports.requireRecord(appId);
        return this.configs.write(
          appId,
          rawConfig as AppConfigValue,
          record.manifest?.requirements?.tools ?? record.pendingInstallRequirements?.tools ?? []
        );
      })
      .handle(APPS_CHANNEL.sharePreview, (rawInput) =>
        this.compatibility.guard(() => this.requireShareFlow().preview(rawInput as SharePreviewInput))
      )
      .handle(APPS_CHANNEL.sharePublish, (rawInput) =>
        this.compatibility.guard(() => this.requireShareFlow().publishShare(rawInput as SharePublishInput))
      )
      .handle(APPS_CHANNEL.shareDiscard, (rawPreviewId) =>
        this.requireShareFlow().discardPreview(String(rawPreviewId))
      );
  }

  async probeAdmission(repoUrl: string, commitSha?: string) {
    const result = await this.probes.probe(repoUrl, commitSha);
    if (result.kind === "base") await this.probes.discard(result.preflightId);
    return result;
  }

  private async resumeCompatibility(requestId: string): Promise<AppRepoProbeResult | PresetProbeResult | { kind: "candidate-unavailable" } | { kind: "installed-update"; appId: string }> {
    const saved = await this.compatibility.require(requestId);
    const candidate = saved.candidate;
    if (candidate.appId) return this.updatePort?.resumeCompatibility(candidate.appId, candidate.contentDigest) ?? { kind: "candidate-unavailable" };
    if (candidate.presetId) {
      const result = await this.presetInstaller.probePreset(candidate.presetId, candidate.commitSha ?? undefined);
      if (result.kind === "candidate-unavailable") return result;
      const commit = result.kind === "base" ? result.commitSha : result.compatibility.candidate.commitSha;
      if (commit !== candidate.commitSha) {
        if (result.kind === "base") await this.presetInstaller.discard(result.preflightId);
        return { kind: "candidate-unavailable" };
      }
      return result;
    }
    if (!candidate.repoUrl || !candidate.commitSha) return { kind: "candidate-unavailable" };
    try { return await this.probes.probe(candidate.repoUrl, candidate.commitSha); }
    catch (cause) {
      if (cause instanceof AppCandidateUnavailableError) return { kind: "candidate-unavailable" };
      throw cause;
    }
  }

  async readReadme(record: AppRecord) {
    const path = join(record.dir, "README.md");
    let file;
    try {
      file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw cause;
    }
    try {
      const metadata = await file.stat();
      if (!metadata.isFile() || metadata.size > README_BYTE_LIMIT) {
        throw new Error("App README 无效或超过 256 KB");
      }
      const content = await file.readFile();
      if (content.byteLength !== metadata.size) {
        throw new Error("App README 在读取期间发生变化");
      }
      return content.toString("utf8");
    } finally {
      await file.close();
    }
  }

  private requireImporter() {
    if (!this.importer) throw new Error("Base App import 尚未初始化");
    return this.importer;
  }

  private requireShareFlow() {
    if (!this.shareFlow) throw new Error("App share 尚未初始化");
    return this.shareFlow;
  }
}

/**
 * presetId 不做格式校验：命中启动扫描的 canonical 清单是唯一门禁，
 * 再补一条正则只是把同一件事写两遍，还会和清单的判定各自漂移。
 * requestId 则必须在门口对齐 AppConfigStore 的 reference 字符集——
 * 否则包复制完成后才在 stagePending 处炸出确定性 staging 孤儿。
 */
function assertInstallPresetInput(value: unknown): InstallPresetInput {
  if (!value || typeof value !== "object") throw new Error("预设安装参数无效");
  const input = value as Partial<InstallPresetInput>;
  if (
    typeof input.presetId !== "string" ||
    !input.presetId ||
    input.presetId.length > 64 ||
    typeof input.preflightId !== "string" ||
    !/^[0-9a-f-]{36}$/.test(input.preflightId) ||
    typeof input.digest !== "string" ||
    !/^[0-9a-f]{64}$/.test(input.digest) ||
    typeof input.requestId !== "string" ||
    !/^[A-Za-z0-9-]{10,80}$/.test(input.requestId) ||
    !isInstallAuthorization(input.authorization)
  ) {
    throw new Error("预设安装参数无效");
  }
  return {
    presetId: input.presetId,
    requestId: input.requestId,
    preflightId: input.preflightId,
    digest: input.digest,
    authorization: assertInstallAuthorization(input.authorization),
    ...(input.config ? { config: input.config as AppConfigValue } : {}),
  };
}

function isInstallAuthorization(value: unknown) {
  const input = value as { scope?: unknown; decision?: unknown } | null;
  return input?.scope === "studio-only" &&
    input.decision === "approve-requested";
}

function assertInstallAuthorization(value: unknown) {
  if (!isInstallAuthorization(value)) {
    throw new Error("Base App 安装授权意图无效");
  }
  return {
    scope: "studio-only" as const,
    decision: "approve-requested" as const,
  };
}

function assertPresetId(value: unknown) {
  if (typeof value !== "string" || !value || value.length > 64) {
    throw new Error("预设 App id 无效");
  }
  return value;
}
