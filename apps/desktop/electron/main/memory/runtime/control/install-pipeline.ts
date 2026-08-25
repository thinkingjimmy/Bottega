/**
 * [INPUT]: Depends on InstallSpec/ManagedRoots, lock version toolchain, model/product authentication native language, configuration controller and call linear step/publish ports
 * [OUTPUT]: Provides runManagedInstallPipeline, recoverManagedManifest and commitReadyVersion: to move the installation data pipeline forward by intent/installing/candidate-installed, conservative marker, recovery and last-known-good atom promotion performed by just testing the same version results
 * [POS]: The main/memory/runtime/control installation data pipeline; Coordinator maintains a standby, ready for affirmations and operational arbitration
 */

import { rm } from "node:fs/promises";
import { join } from "node:path";
import type { MemoryProviderDescriptor, MemoryRuntimeSnapshot } from "../../../../../shared/memory-ipc";
import type { InstallSpec } from "../../core/provider";
import type { ManagedRuntimeConfigController } from "./config-controller";
import {
  ensureModelAssets,
  exists,
  fetchVerifiedArtifacts,
  type Downloader,
} from "../managed/install-steps";
import {
  newInstanceIdentity,
  type ManagedManifest,
  type ManagedRoots,
} from "../managed/manifest";
import type { ManagedToolchain } from "../managed/toolchain";
import type { ManagedInstallTarget } from "../managed/install-target";
import type { StepKind } from "../progress";

type SnapshotOverrides = Partial<
  Omit<MemoryRuntimeSnapshot, "providerId" | "revision">
>;

export async function recoverManagedManifest(input: {
  providerId: string;
  baseUrl: string;
  roots: ManagedRoots;
  spec: InstallSpec;
  marker: Pick<ManagedManifest, "instanceId" | "dataEpoch" | "ownershipToken">;
}) {
  const files = Object.fromEntries(
    (await Promise.all(
      input.spec.configFiles.map(async (file) => [
        file,
        await exists(join(input.roots.dataRoot, file)),
      ] as const)
    )).flatMap(([file, present]) =>
      present ? [[file, { mode: "manual" as const }]] : []
    )
  );
  const manifest: ManagedManifest = {
    version: 3,
    providerId: input.providerId,
    ...input.marker,
    installRoot: input.roots.installRoot,
    dataRoot: input.roots.dataRoot,
    baseUrl: input.baseUrl,
    installedVersion: input.spec.lockedVersion,
    versionSource: "locked",
    versionHistory: [],
    installedAt: Date.now(),
    files,
  };
  await input.roots.writeManifest(manifest);
  return manifest;
}

export async function runManagedInstallPipeline(input: {
  rotateIdentity: boolean;
  target: ManagedInstallTarget;
  startAfter: boolean;
  roots: ManagedRoots;
  spec: InstallSpec;
  descriptor: MemoryProviderDescriptor;
  launchAgentPath: string;
  toolchain: Pick<ManagedToolchain, "resolve">;
  download: Downloader;
  fetcher: typeof fetch;
  config: Pick<ManagedRuntimeConfigController, "convergeManagedConfigs" | "installPlist">;
  initialize(): Promise<{ kind: string }>;
  beginStep<T>(kind: StepKind, label: string, action: () => Promise<T>): Promise<T>;
  exec(
    command: string,
    args: string[],
    options: { timeoutMs: number; env?: Record<string, string> }
  ): Promise<void>;
  appendLog(line: string): void;
  publish(overrides?: SnapshotOverrides): Promise<MemoryRuntimeSnapshot>;
}) {
  await input.roots.ensure();
  const uv = await input.beginStep(
    "prepare-toolchain",
    "准备锁版 uv",
    () => input.toolchain.resolve()
  );
  const venv = join(input.roots.installRoot, "venv");
  await input.beginStep(
    "ensure-venv",
    `创建 Python ${input.spec.pythonVersion} 环境`,
    async () => {
      if (await exists(join(venv, "pyvenv.cfg"))) return;
      await input.exec(
        uv.command,
        ["venv", "--python", input.spec.pythonVersion, venv],
        { timeoutMs: 300_000, env: uv.env }
      );
    }
  );
  const verified = await input.beginStep(
    "fetch-artifacts",
    "下载并校验安装包",
    () => fetchVerifiedArtifacts(
      input.spec,
      input.roots,
      input.download,
      input.appendLog
    )
  );
  const packages = [...verified, ...input.target.uvPackages];
  await input.beginStep(
    "install-packages",
    `${input.target.stepLabel}（可能需数分钟）`,
    async () => {
      if (!packages.length) return;
      await input.exec(
        uv.command,
        [
          "pip",
          "install",
          "--python",
          join(venv, "bin", "python"),
          ...packages,
        ],
        { timeoutMs: 20 * 60_000, env: uv.env }
      );
    }
  );
  const previous = await input.roots.readManifest();
  const ownershipValid = await input.roots.ownershipValid(previous);
  const identity = previous && !input.rotateIdentity && ownershipValid !== false
    ? {
        instanceId: previous.instanceId,
        dataEpoch: previous.dataEpoch,
        ownershipToken: previous.ownershipToken,
      }
    : newInstanceIdentity();
  const manifest: ManagedManifest = {
    version: 3,
    providerId: input.descriptor.id,
    ...identity,
    installRoot: input.roots.installRoot,
    dataRoot: input.roots.dataRoot,
    baseUrl: input.descriptor.defaultBaseUrl,
    installedVersion: previous?.installedVersion ?? input.target.version,
    versionChange: previous && previous.installedVersion !== input.target.version
      ? {
          targetVersion: input.target.version,
          phase: "candidate-installed",
        }
      : undefined,
    versionSource: previous?.versionSource ?? (
      input.target.version === input.spec.lockedVersion ? "locked" : "selected"
    ),
    versionHistory: previous?.versionHistory ?? [],
    installedAt: Date.now(),
    files: previous?.files ?? {},
  };
  await input.beginStep("register-manifest", "登记托管安装", async () => {
    await input.roots.writeManifest(manifest);
    await input.roots.writeMarker(manifest);
  });
  const initialized = await input.beginStep(
    "initialize",
    "初始化数据根",
    input.initialize
  );
  /* 字节口径整体归 ensureModelAssets：这里只把它给的帧按 300ms 节流
     发出去，末帧（累计 == 总量）永远放行。 */
  let lastTransferPublish = 0;
  let recoveredModel = false;
  const models = await input.beginStep(
    "model-assets",
    "下载 embedding 模型",
    async () => {
      const outcome = await ensureModelAssets(input.roots, input.spec, {
        fetcher: input.fetcher,
        onInvalid: (filename) => {
          recoveredModel = true;
          input.appendLog(`${filename} 校验失败，正在重新下载`);
        },
        onProgress: (progress) => {
          const now = Date.now();
          if (
            now - lastTransferPublish < 300 &&
            progress.receivedBytes !== progress.totalBytes
          ) return;
          lastTransferPublish = now;
          void input.publish({
            transfer: { ...progress, recovered: recoveredModel },
          }).catch(() => undefined);
        },
      });
      await input.publish({ transfer: null });
      return outcome;
    }
  );
  const convergence = await input.beginStep(
    "config-converge",
    "收敛托管配置",
    () => input.config.convergeManagedConfigs()
  );
  if (convergence.state === "converged") {
    await Promise.all(models.legacySources.map((path) => rm(path, { force: true })));
  }
  await input.beginStep("install-plist", "写入登录自启", async () => {
    if (!input.startAfter || initialized.kind === "awaiting-secrets") {
      await rm(input.launchAgentPath, { force: true });
      input.appendLog("提交密钥后将注册登录自启并启动服务");
      return;
    }
    await input.config.installPlist();
  });
  return manifest;
}

export async function commitReadyVersion(input: {
  roots: ManagedRoots;
  spec: InstallSpec;
  target: ManagedInstallTarget;
  measuredVersion: string | null;
}) {
  const manifest = await input.roots.readManifest();
  if (!manifest) throw new Error("就绪后托管 manifest 缺失");
  const measured = input.measuredVersion;
  if (measured === null) {
    throw new Error("拒绝晋升 last-known-good：缺少实测运行版本");
  }
  if (measured !== input.target.version) {
    throw new Error(
      `拒绝晋升 last-known-good：目标 ${input.target.version}，实测 ${measured}`
    );
  }
  const versionHistory = [
    measured,
    manifest.installedVersion,
    ...(manifest.versionHistory ?? []),
  ].filter((version, index, all) => all.indexOf(version) === index).slice(0, 5);
  await input.roots.writeManifest({
    ...manifest,
    installedVersion: measured,
    versionChange: undefined,
    versionSource: measured === input.spec.lockedVersion ? "locked" : "selected",
    versionHistory,
  });
}
