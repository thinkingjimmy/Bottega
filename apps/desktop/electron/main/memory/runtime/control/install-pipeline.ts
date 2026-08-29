/**
 * [INPUT]: Depends on InstallSpec/ManagedRoots, the locked toolchain, configuration controller, manifest store, and coordinator-supplied readiness proof
 * [OUTPUT]: Provides install/recovery pipelines and commitReadyVersion for intent → installing → candidate-installed → ready promotion
 * [POS]: The managed installation state machine; it records candidate facts while the coordinator owns live readiness arbitration
 */

import { rm } from "node:fs/promises";
import { join } from "node:path";
import type {
  MemoryProviderDescriptor,
  MemoryRuntimeSnapshot,
  MemoryRuntimeStep,
} from "../../../../../shared/memory-ipc";
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
  beginStep<T>(step: MemoryRuntimeStep, action: () => Promise<T>): Promise<T>;
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
    { kind: "prepare-toolchain" },
    () => input.toolchain.resolve()
  );
  const venv = join(input.roots.installRoot, "venv");
  await input.beginStep(
    { kind: "ensure-venv", version: input.spec.pythonVersion },
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
    { kind: "fetch-artifacts" },
    () => fetchVerifiedArtifacts(
      input.spec,
      input.roots,
      input.download,
      input.appendLog
    )
  );
  const packages = [...verified, ...input.target.uvPackages];
  await input.beginStep(
    {
      kind: "install-packages",
      version: input.target.version,
      /* 自选版本与锁定版本要说成两句话：前者是用户刚做的决定，后者是
         产品的默认——同一句「安装 X」抹掉了这个区别。 */
      ...(input.target.version === input.spec.lockedVersion
        ? {}
        : { context: "selected" as const }),
    },
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
    versionChange: !previous || previous.installedVersion !== input.target.version
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
  await input.beginStep({ kind: "register-manifest" }, async () => {
    await input.roots.writeManifest(manifest);
    await input.roots.writeMarker(manifest);
  });
  const initialized = await input.beginStep(
    { kind: "initialize" },
    input.initialize
  );
  /* 字节口径整体归 ensureModelAssets：这里只把它给的帧按 300ms 节流
     发出去，末帧（累计 == 总量）永远放行。 */
  let lastTransferPublish = 0;
  let recoveredModel = false;
  const models = await input.beginStep(
    { kind: "model-assets" },
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
    { kind: "config-converge" },
    () => input.config.convergeManagedConfigs()
  );
  if (convergence.state === "converged") {
    await Promise.all(models.legacySources.map((path) => rm(path, { force: true })));
  }
  await input.beginStep({ kind: "install-plist" }, async () => {
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
  ready: boolean;
}) {
  if (!input.ready) return { promoted: false as const };
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
  return { promoted: true as const };
}
