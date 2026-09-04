/**
 * [INPUT]: Depends on the immutable Design payload, exact catalog trust tuple, package/base schemas, and an explicit factory reinstall callback
 * [OUTPUT]: Provides DesignFactoryPresetFlow implementing local probe/discard/install without Git or remote fallback
 * [POS]: Design provisioning's user-explicit reinstall adapter; startup ensure cannot consume its in-memory preflight authority
 */

import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { AgentBackendId } from "../../../../shared/agent-ipc";
import type {
  AppConfigValue,
  AppRecord,
  InstallPresetInput,
  PresetProbeResult,
} from "../../../../shared/apps-ipc";
import { baseSnapshotFileSchema } from "../../../../shared/base-snapshot";
import { appManifestSchema } from "../../apps/install/manifest-schema";
import type { PresetFactoryFlow } from "../../apps/share/preset/preset-install-service";
import {
  inspectPackage,
  packageDigest,
} from "../../apps/share/package/package-contract";
import type { DesignFactoryTrust } from "./factory-provisioner";

type FrozenFactoryProbe = Readonly<{
  digest: string;
  trust: DesignFactoryTrust;
}>;

export class DesignFactoryPresetFlow implements PresetFactoryFlow {
  private readonly frozen = new Map<string, FrozenFactoryProbe>();

  constructor(
    private readonly sourceRoot: string,
    private readonly trust: DesignFactoryTrust,
    private readonly reinstall: () => Promise<AppRecord>
  ) {}

  handles(presetId: string) {
    return presetId === this.trust.presetId;
  }

  async probePreset(presetId: string): Promise<PresetProbeResult> {
    if (!this.handles(presetId)) throw new Error("Factory preset identity 不匹配");
    const result = await inspectFactoryPayload(this.sourceRoot, this.trust);
    this.frozen.set(result.preflightId, {
      digest: result.digest,
      trust: structuredClone(this.trust),
    });
    return result;
  }

  async discard(preflightId: string) {
    return this.frozen.delete(preflightId);
  }

  async install(
    input: InstallPresetInput,
    agent: AgentBackendId,
    config: AppConfigValue
  ) {
    void agent;
    if (!this.handles(input.presetId)) throw new Error("Factory preset identity 不匹配");
    if (Object.keys(config.values).length || config.agentReadableKeys.length) {
      throw new Error("Design factory 不接受运行时配置");
    }
    const frozen = this.frozen.get(input.preflightId);
    const current = await inspectFactoryPayload(this.sourceRoot, this.trust);
    if (
      !frozen ||
      frozen.digest !== input.digest ||
      current.digest !== input.digest ||
      !sameTrust(frozen.trust, this.trust)
    ) {
      throw new Error("Design factory preflight 已失效或 payload 漂移");
    }
    this.frozen.delete(input.preflightId);
    return this.reinstall();
  }
}

async function inspectFactoryPayload(
  sourceRoot: string,
  trust: DesignFactoryTrust
): Promise<PresetProbeResult> {
  const inspection = await inspectPackage(sourceRoot);
  if (inspection.ignored.length) throw new Error("Design factory payload 含未签名文件");
  const digest = await packageDigest(sourceRoot, inspection.files);
  if (`sha256:${digest}` !== trust.treeDigest) {
    throw new Error("Design factory treeDigest 不匹配");
  }
  const manifest = appManifestSchema.parse(
    JSON.parse(await readFile(join(sourceRoot, "app.json"), "utf8"))
  );
  if (manifest.kind !== "base") throw new Error("Design factory 必须是 Base App");
  const snapshot = baseSnapshotFileSchema.parse(
    JSON.parse(await readFile(join(sourceRoot, "data/base.json"), "utf8"))
  );
  const disclosures = await Promise.all(
    inspection.files
      .filter((file) => file.path === "README.md" || file.path === "README.zh-CN.md")
      .map(async (file) => ({
        path: file.path,
        content: await readFile(join(sourceRoot, file.path), "utf8"),
      }))
  );
  return {
    kind: "base",
    repoUrl: trust.repoUrl,
    preflightId: randomUUID(),
    digest,
    commitSha: trust.catalogPin,
    manifest,
    requirements: manifest.requirements?.tools ?? [],
    cliStatuses: [],
    disclosures,
    files: inspection.files,
    ignored: [],
    rowCount: snapshot.rows.length,
    hasGui: inspection.files.some((file) => file.path.startsWith("gui/")),
    extensionPreflights: [],
    presetId: trust.presetId,
    resolvedPin: trust.catalogPin,
    channel: "release",
  };
}

function sameTrust(left: DesignFactoryTrust, right: DesignFactoryTrust) {
  return left.presetId === right.presetId &&
    left.repoUrl === right.repoUrl &&
    left.catalogPin === right.catalogPin &&
    left.treeDigest === right.treeDigest;
}
