/**
 * [INPUT]: Main-owned PresetCatalog/SourceResolver, RepoProbeService and BaseAppImporter.
 * [OUTPUT]: Frozen ordinary preset probe/discard/install with canonical identity and Studio-only authorization forwarding.
 * [POS]: apps/share/preset installation boundary over ../package/repo-probe.ts; renderer holds only opaque preflight/digest evidence and cannot choose a URL or pin
 */

import type {
  AppConfigValue,
  InstallPresetInput,
  PresetProbeResult,
} from "../../../../../shared/ipc/apps/apps-ipc";
import type { AgentBackendId } from "../../../../../shared/ipc/agent/agent-ipc";
import type { BaseAppImporter } from "../../install/import-base-app";
import type { RepoProbeService } from "../package/repo-probe";
import type {
  PresetSourceResolver,
  ResolvedPresetSource,
} from "./preset-source";

type FrozenPresetProbe = {
  source: ResolvedPresetSource;
  digest: string;
};

export class PresetInstallService {
  private readonly frozen = new Map<string, FrozenPresetProbe>();

  constructor(
    private readonly resolver: Pick<PresetSourceResolver, "resolve">,
    private readonly probes: RepoProbeService,
    private readonly importer: () => BaseAppImporter
  ) {}

  async probePreset(presetId: string): Promise<PresetProbeResult>;
  async probePreset(presetId: string, expectedCommitSha: string | undefined): Promise<PresetProbeResult | { kind: "candidate-unavailable" }>;
  async probePreset(presetId: string, expectedCommitSha?: string): Promise<PresetProbeResult | { kind: "candidate-unavailable" }> {
    const source = await this.resolver.resolve(presetId);
    if (expectedCommitSha && source.expectedCommitSha !== expectedCommitSha) return { kind: "candidate-unavailable" };
    const result = await this.probes.probe(
      source.cloneLocator,
      source.expectedCommitSha,
      presetId
    );
    if (result.kind === "compatibility-blocked") return result;
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
    this.frozen.delete(preflightId);
    await this.probes.discard(preflightId);
  }

  async install(
    input: InstallPresetInput,
    agent: AgentBackendId,
    config: AppConfigValue
  ) {
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
        candidate: frozen.candidate,
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
