/**
 * [INPUT]: Depends on managed roots, the pinned platform toolchain, independent Memory downloads, the coordinator's stopped-service window and progress ledger, and coordinator readiness proof
 * [OUTPUT]: Provides ManagedInstallPorts/StoppedServiceOptions, the install/repair runner (runManagedInstall), the upgrade/switch-version runner (runManagedUpgrade) with intent→installing staging and candidate cleanup, marker recovery, and last-known-good promotion (commitReadyVersion)
 * [POS]: The managed installation state machine; it records candidate facts and drives the stopped-service window while the coordinator owns live readiness arbitration
 */

import { venvExecutable } from "../managed/archives/uv-assets";
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
  runCleanupActions,
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

export type StoppedServiceOptions = {
  expectedVersion?: string;
  cleanupOnFailure?: () => Promise<void>;
  readyTarget?: ManagedInstallTarget;
};

/** Everything the coordinator lends the install runners; readiness arbitration stays behind withOwnedServiceStopped. */
export type ManagedInstallPorts = {
  roots: ManagedRoots;
  spec: InstallSpec;
  descriptor: MemoryProviderDescriptor;
  launchAgentPath: string;
  toolchain: Pick<ManagedToolchain, "resolve">;
  download: Downloader;
  fetcher: typeof fetch;
  config: Pick<
    ManagedRuntimeConfigController,
    "convergeManagedConfigs" | "installPlist" | "hasRequiredConfiguration"
  >;
  initialize(): Promise<{ kind: string }>;
  beginStep<T>(step: MemoryRuntimeStep, action: () => Promise<T>): Promise<T>;
  exec(
    command: string,
    args: string[],
    options: { timeoutMs: number; env?: Record<string, string> }
  ): Promise<void>;
  appendLog(line: string): void;
  publish(overrides?: SnapshotOverrides): Promise<MemoryRuntimeSnapshot>;
  withOwnedServiceStopped<T>(
    mutateWhileStopped: () => Promise<T>,
    startAfter: boolean,
    options?: StoppedServiceOptions
  ): Promise<T>;
};

// instanceId 表示安装身份；受控 rebuild 与版本切换都保留它。
export async function runManagedInstall(
  ports: ManagedInstallPorts,
  input: { rotateIdentity: boolean; target: ManagedInstallTarget }
) {
  const startAfter = await ports.config.hasRequiredConfiguration();
  const result = await ports.withOwnedServiceStopped(
    () => runManagedInstallPipeline({ ...ports, ...input, startAfter }),
    startAfter,
    { expectedVersion: input.target.version, readyTarget: input.target }
  );
  if (!startAfter) await completeSkippedStartupSteps(ports);
  return result;
}

/* 升级只替换运行字节，不轮换安装身份。目标与已装版本相同时必须在
   动手之前拒绝：三阶段 versionChange 对同版是空操作（stageVersionChange
   直接早退），可 remove-plist/remove-venv 照删不误——那会留下一个
   「manifest 说装着、磁盘上什么都没有」的窗口。同版重装走 repair。 */
export async function runManagedUpgrade(
  ports: ManagedInstallPorts,
  target: ManagedInstallTarget
) {
  const installedVersion = (await ports.roots.readManifest())?.installedVersion;
  if (installedVersion === target.version) {
    throw new Error(
      `RUNTIME_VERSION_UNCHANGED: 目标版本 ${target.version} 与当前安装版本相同，请使用修复`
    );
  }
  const startAfter = await ports.config.hasRequiredConfiguration();
  const result = await ports.withOwnedServiceStopped(
    async () => {
      await ports.beginStep({ kind: "remove-plist" }, async () => {
        await stageVersionChange(ports.roots, target.version, "intent");
        await rm(ports.launchAgentPath, { force: true });
      });
      await ports.beginStep({ kind: "remove-venv" }, async () => {
        await stageVersionChange(ports.roots, target.version, "installing");
        await rm(join(ports.roots.installRoot, "venv"), {
          recursive: true,
          force: true,
        });
      });
      return runManagedInstallPipeline({
        ...ports,
        rotateIdentity: false,
        target,
        startAfter,
      });
    },
    startAfter,
    {
      expectedVersion: target.version,
      cleanupOnFailure: () => cleanupCandidateInstall(ports),
      readyTarget: target,
    }
  );
  if (!startAfter) await completeSkippedStartupSteps(ports);
  return result;
}

async function cleanupCandidateInstall(
  ports: Pick<ManagedInstallPorts, "roots" | "launchAgentPath">
) {
  const manifest = await ports.roots.readManifest();
  const change = manifest?.versionChange;
  if (!manifest || !change) return;
  if (change.phase === "candidate-installed") {
    await ports.roots.writeManifest({
      ...manifest,
      versionChange: { ...change, phase: "installing" },
    });
  }
  const actions = [
    {
      label: "移除候选登录自启",
      run: () => rm(ports.launchAgentPath, { force: true }),
    },
  ];
  if (change.phase !== "intent") actions.push({
      label: "移除候选运行环境",
      run: () => rm(join(ports.roots.installRoot, "venv"), {
        recursive: true,
        force: true,
      }),
    });
  await runCleanupActions(actions);
}

async function stageVersionChange(
  roots: ManagedRoots,
  targetVersion: string,
  phase: "intent" | "installing"
) {
  const manifest = await roots.readManifest();
  if (!manifest || manifest.installedVersion === targetVersion) return;
  await roots.writeManifest({
    ...manifest,
    versionChange: { targetVersion, phase },
  });
}

async function completeSkippedStartupSteps(
  ports: Pick<ManagedInstallPorts, "beginStep">
) {
  await ports.beginStep(
    { kind: "bootstrap", context: "deferred" },
    async () => undefined
  );
  await ports.beginStep(
    { kind: "await-ready", context: "deferred" },
    async () => undefined
  );
}

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

async function runManagedInstallPipeline(
  input: ManagedInstallPorts & {
    rotateIdentity: boolean;
    target: ManagedInstallTarget;
    startAfter: boolean;
  }
) {
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
          venvExecutable(venv, "python"),
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
  await input.beginStep(
    { kind: "model-assets" },
    async () => {
      await ensureModelAssets(input.roots, input.spec, {
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
    }
  );
  await input.beginStep(
    { kind: "config-converge" },
    () => input.config.convergeManagedConfigs()
  );
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
