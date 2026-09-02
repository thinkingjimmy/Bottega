/**
 * [INPUT]: Depends on the main-owned PresetCatalog/SourceResolver, RepoProbeService, BaseAppImporter, and an optional immutable local-factory flow
 * [OUTPUT]: Provides probePreset/discard/install with frozen preset identity and Studio-only authorization forwarding, plus an explicit product-factory branch that never falls through to Git
 * [POS]: apps/share preset installation boundary; renderer holds only opaque preflight/digest evidence and cannot choose a URL or pin
 */

import type {
  AppConfigValue,
  AppRecord,
  InstallPresetInput,
  PresetProbeResult,
} from "../../../../shared/apps-ipc";
import type { AgentBackendId } from "../../../../shared/agent-ipc";
import type { BaseAppImporter } from "../install/import-base-app";
import type { RepoProbeService } from "./repo-probe";
import type {
  PresetSourceResolver,
  ResolvedPresetSource,
} from "./preset-source";

type FrozenPresetProbe = {
  source: ResolvedPresetSource;
  digest: string;
};

export type PresetFactoryFlow = Readonly<{
  handles(presetId: string): boolean;
  probePreset(presetId: string): Promise<PresetProbeResult>;
  discard(preflightId: string): Promise<boolean>;
  install(
    input: InstallPresetInput,
    agent: AgentBackendId,
    config: AppConfigValue
  ): Promise<AppRecord>;
}>;

export class PresetInstallService {
  private readonly frozen = new Map<string, FrozenPresetProbe>();
  private factory: PresetFactoryFlow | null = null;

  constructor(
    private readonly resolver: Pick<PresetSourceResolver, "resolve">,
    private readonly probes: RepoProbeService,
    private readonly importer: () => BaseAppImporter
  ) {}

  configureFactory(factory: PresetFactoryFlow) {
    if (this.factory) throw new Error("Factory preset flow 已配置");
    this.factory = factory;
  }

  async probePreset(presetId: string): Promise<PresetProbeResult> {
    if (this.factory?.handles(presetId)) {
      return this.factory.probePreset(presetId);
    }
    const source = await this.resolver.resolve(presetId);
    const result = await this.probes.probe(
      source.cloneLocator,
      source.expectedCommitSha
    );
    if (result.kind !== "base") throw new Error("首方预设必须是 Base App");
    if (result.commitSha !== source.expectedCommitSha) {
      await this.probes.discard(result.preflightId);
      throw new Error("预设取源 commit 与 main 期望不一致");
    }
    this.frozen.set(result.preflightId, { source, digest: result.digest });
    return {
      ...result,
      presetId,
      resolvedPin: source.expectedCommitSha,
      channel: source.channel,
    };
  }

  async discard(preflightId: string) {
    if (await this.factory?.discard(preflightId)) return;
    this.frozen.delete(preflightId);
    await this.probes.discard(preflightId);
  }

  async install(
    input: InstallPresetInput,
    agent: AgentBackendId,
    config: AppConfigValue
  ) {
    if (this.factory?.handles(input.presetId)) {
      return this.factory.install(input, agent, config);
    }
    const known = this.frozen.get(input.preflightId);
    const current = await this.resolver.resolve(input.presetId);
    if (
      !known ||
      known.digest !== input.digest ||
      known.source.presetId !== input.presetId ||
      known.source.cloneLocator !== current.cloneLocator ||
      known.source.expectedCommitSha !== current.expectedCommitSha ||
      known.source.channel !== current.channel
    ) {
      throw new Error("preset preflight 已失效或取源身份漂移");
    }
    const frozen = this.probes.consume(
      input.preflightId,
      input.digest,
      current.cloneLocator
    );
    this.frozen.delete(input.preflightId);
    if (frozen.commitSha !== current.expectedCommitSha) {
      throw new Error("冻结包 commit 与解析 pin 不一致");
    }
    return this.importer().import({
      requestId: input.requestId,
      source: {
        origin: "preset",
        ref: input.presetId,
        digest: input.digest,
        packageRoot: frozen.packageRoot,
        preset: {
          presetId: input.presetId,
          resolvedPin: current.expectedCommitSha,
          channel: current.channel,
        },
        extensionPreflights: frozen.extensionPreflights,
      },
      agent,
      config,
      authorization: input.authorization,
    });
  }
}
