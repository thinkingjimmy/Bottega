/**
 * [INPUT]: Depends on node child_process/fs/crypto, InstallSpec and ManagedRoots
 * [OUTPUT]: Provides runCommand/capture-only, install packet verification, model asset pre-emption/migration, staging, orphan clearance + cumulative progress calibre across assets, atom 0600 plist/JSON write, full action best-effort compensation with argv/builder, binary init, restore matrix
 * [POS]: Install the main/memory/runtime/managed language layer; Just take steps, not sequence the string to the state into the Coordinator
 */

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  access,
  chmod,
  copyFile,
  mkdir,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import type { ResolvedConfigValues } from "../../../../../shared/memory-ipc";
import type { InstallSpec } from "../../core/provider";
import type { ManagedRoots } from "./manifest";
import { downloadToFile, type DownloadProgress } from "./streaming-download";

export type RunCommand = (
  command: string,
  args: string[],
  options: {
    timeoutMs: number;
    env?: Record<string, string>;
    onLine(line: string): void;
  }
) => Promise<void>;

export type RunCommandCaptured = (
  command: string,
  args: string[],
  options: { timeoutMs: number; byteLimit?: number; env?: Record<string, string> }
) => Promise<{ stdout: string; stderr: string; code: number }>;

export type Downloader = (url: string) => Promise<Buffer>;

export function defaultRunCommand(): RunCommand {
  return (command, args, options) =>
    new Promise((resolve, reject) => {
      const child = spawn(command, args, {
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, ...options.env },
      });
      let tail = "";
      const feed = (chunk: Buffer) => {
        for (const line of chunk.toString("utf8").split("\n")) {
          const trimmed = line.trimEnd();
          if (!trimmed) continue;
          tail = trimmed;
          options.onLine(trimmed);
        }
      };
      child.stdout.on("data", feed);
      child.stderr.on("data", feed);
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        reject(new Error(`${command} 超时（${options.timeoutMs / 1_000}s）`));
      }, options.timeoutMs);
      timer.unref?.();
      child.once("error", (cause) => {
        clearTimeout(timer);
        reject(cause);
      });
      child.once("close", (code) => {
        clearTimeout(timer);
        if (code === 0) resolve();
        else reject(new Error(`${command} 退出码 ${code}：${tail}`));
      });
    });
}

/** capture-only：输出只交解析器，绝不进入 coordinator log/publish。 */
export function defaultRunCommandCaptured(): RunCommandCaptured {
  return (command, args, options) =>
    new Promise((resolve, reject) => {
      const limit = options.byteLimit ?? 64 * 1024;
      const child = spawn(command, args, {
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, ...options.env },
      });
      let stdout = Buffer.alloc(0);
      let stderr = Buffer.alloc(0);
      const append = (current: Buffer, chunk: Buffer) => {
        const next = Buffer.concat([current, chunk]);
        return next.subarray(Math.max(0, next.length - limit));
      };
      child.stdout.on("data", (chunk: Buffer) => {
        stdout = append(stdout, chunk);
      });
      child.stderr.on("data", (chunk: Buffer) => {
        stderr = append(stderr, chunk);
      });
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        reject(new Error(`${command} 超时（${options.timeoutMs / 1_000}s）`));
      }, options.timeoutMs);
      timer.unref?.();
      child.once("error", (cause) => {
        clearTimeout(timer);
        reject(cause);
      });
      child.once("close", (code) => {
        clearTimeout(timer);
        resolve({
          stdout: stdout.toString("utf8"),
          stderr: stderr.toString("utf8"),
          code: code ?? -1,
        });
      });
    });
}

export async function withOwnedServiceStopped<T>(input: {
  assertOwnedOrAbsent(): Promise<void>;
  bootoutWaitStopped(): Promise<void>;
  mutateWhileStopped(): Promise<T>;
  startAfter: boolean;
  bootstrap(): Promise<void>;
  assertServiceIdentity(): Promise<void>;
  awaitHealthy(): Promise<void>;
  afterHealthy?(): Promise<void>;
  cleanupOnFailure?(): Promise<void>;
}): Promise<T> {
  await input.assertOwnedOrAbsent();
  await input.bootoutWaitStopped();
  try {
    const result = await input.mutateWhileStopped();
    if (!input.startAfter) return result;
    await input.bootstrap();
    await input.assertServiceIdentity();
    await input.awaitHealthy();
    await input.afterHealthy?.();
    return result;
  } catch (cause) {
    const compensationFailures: unknown[] = [];
    await input.bootoutWaitStopped().catch((failure) => {
      compensationFailures.push(failure);
    });
    await input.cleanupOnFailure?.().catch((failure) => {
      compensationFailures.push(failure);
    });
    if (compensationFailures.length) {
      throw new AggregateError(
        [cause, ...compensationFailures],
        `${failureMessage(cause)}；失败补偿未完成：${compensationFailures
          .map(failureMessage)
          .join("；")}`
      );
    }
    throw cause;
  }
}

export async function runCleanupActions(
  actions: ReadonlyArray<Readonly<{ label: string; run(): Promise<void> }>>
) {
  const failures: unknown[] = [];
  for (const action of actions) {
    await action.run().catch((cause) => {
      failures.push(new Error(`${action.label}：${failureMessage(cause)}`, {
        cause: cause instanceof Error ? cause : undefined,
      }));
    });
  }
  if (failures.length) {
    throw new AggregateError(
      failures,
      `候选安装清理未完成：${failures.map(failureMessage).join("；")}`
    );
  }
}

const failureMessage = (cause: unknown) =>
  cause instanceof Error ? cause.message : String(cause);

export const defaultDownloader: Downloader = async (url) => {
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok) {
    throw new Error(`下载失败：HTTP ${response.status} ${url}`);
  }
  return Buffer.from(await response.arrayBuffer());
};

export async function exists(path: string) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/* ============================================================
 * 「校验」不是把哈希打印出来看一眼：先落到隔离文件，比对通过才
 * 允许安装器看见它。任何一步失败都不留下半个可安装的文件。
 * ============================================================ */
export async function fetchVerifiedArtifacts(
  spec: InstallSpec,
  roots: ManagedRoots,
  download: Downloader,
  log: (line: string) => void
) {
  if (!spec.artifacts.length) return [];
  const cache = join(roots.installRoot, "artifacts");
  await mkdir(cache, { recursive: true, mode: 0o700 });
  const verified: string[] = [];
  for (const artifact of spec.artifacts) {
    const target = join(cache, artifact.filename);
    const staging = `${target}.download`;
    log(`下载 ${artifact.filename}`);
    const bytes = await download(artifact.url);
    const digest = createHash("sha256").update(bytes).digest("hex");
    if (digest !== artifact.sha256) {
      throw new Error(
        `${artifact.filename} SHA256 校验失败：期望 ${artifact.sha256}，实得 ${digest}`
      );
    }
    await writeFile(staging, bytes, { mode: 0o600 });
    await rename(staging, target);
    log(`SHA256 校验通过 ${digest.slice(0, 16)}…`);
    verified.push(target);
  }
  return verified;
}

/* ============================================================
 * 进度是一条曲线，不是每个资产各走一遍的锯齿：起帧总量与每一次
 * 增量都在这里由同一个 assets 数组算出来，调用方只负责把帧发出去。
 * 已就位与从旧缓存迁来的资产同样计入已完成字节——否则进度条会
 * 在「其实什么都不用下载」时永远停在 0。
 * ============================================================ */
export async function ensureModelAssets(
  roots: ManagedRoots,
  spec: InstallSpec,
  options: {
    onProgress?: (progress: DownloadProgress) => void;
    onInvalid?: (filename: string) => void;
    fetcher?: typeof fetch;
  } = {}
) {
  const assets = spec.modelAssets ?? [];
  if (!assets.length) return { state: "ready" as const, legacySources: [] };
  const manifest = await roots.readManifest();
  if (Object.values(manifest?.files ?? {}).some((file) => file.mode === "manual")) {
    return { state: "manual" as const, legacySources: [] };
  }
  const targetRoot = join(roots.installRoot, "models");
  const legacyRoot = join(roots.dataRoot, "models");
  await mkdir(targetRoot, { recursive: true, mode: 0o700 });
  await sweepStagingOrphans(targetRoot);
  const totalBytes = assets.reduce((total, asset) => total + asset.bytes, 0);
  const legacySources: string[] = [];
  let settledBytes = 0;
  options.onProgress?.({ receivedBytes: 0, totalBytes });
  for (const asset of assets) {
    const target = join(targetRoot, asset.filename);
    const advance = () => {
      settledBytes += asset.bytes;
      options.onProgress?.({ receivedBytes: settledBytes, totalBytes });
    };
    if (await assetMatches(target, asset)) {
      advance();
      continue;
    }
    if (await exists(target)) options.onInvalid?.(asset.filename);
    const legacy = join(legacyRoot, asset.filename);
    if (await assetMatches(legacy, asset)) {
      await copyFile(legacy, target);
      if (!(await assetMatches(target, asset))) {
        await rm(target, { force: true });
        throw new Error(`${asset.filename} 从旧缓存迁移后复验失败`);
      }
      legacySources.push(legacy);
      advance();
      continue;
    }
    await downloadToFile(asset.url, target, {
      bytes: asset.bytes,
      sha256: asset.sha256,
      onProgress: (progress) => options.onProgress?.({
        receivedBytes: settledBytes + progress.receivedBytes,
        totalBytes,
      }),
      fetcher: options.fetcher,
    });
    settledBytes += asset.bytes;
  }
  return { state: "ready" as const, legacySources };
}

/** run() 单飞，没有并发下载：目录里的 *.download 一律是崩溃遗留的孤儿。 */
async function sweepStagingOrphans(directory: string) {
  const entries = await readdir(directory).catch(() => [] as string[]);
  for (const name of entries) {
    if (name.endsWith(".download")) {
      await rm(join(directory, name), { force: true, recursive: true });
    }
  }
}

async function assetMatches(
  path: string,
  asset: { bytes: number; sha256: string }
) {
  try {
    const metadata = await stat(path);
    return metadata.isFile() &&
      metadata.size === asset.bytes &&
      (await hashFile(path)) === asset.sha256;
  } catch {
    return false;
  }
}

/* ============================================================
 * plist 只承载静态 env 与 transport=env 的密钥，落盘必须 0600 且原子替换。
 * 写坏一次就再也起不来的文件，值得一次备份与一次回滚。
 * ============================================================ */
export async function writePlistAtomic(
  path: string,
  content: string
) {
  await mkdir(dirname(path), { recursive: true });
  const backup = `${path}.previous`;
  const staging = `${path}.tmp`;
  const had = await exists(path);
  if (had) await copyFile(path, backup);
  try {
    await writeFile(staging, content, { mode: 0o600 });
    await rename(staging, path);
  } catch (cause) {
    await rm(staging, { force: true });
    if (had) await copyFile(backup, path).catch(() => {});
    throw cause;
  } finally {
    await rm(backup, { force: true }).catch(() => {});
  }
}

export function renderPlist(input: {
  label: string;
  programArguments: string[];
  environment: Record<string, string>;
  workingDirectory: string;
  logDirectory: string;
}) {
  const escape = (value: string) =>
    value
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;");
  const args = input.programArguments
    .map((value) => `    <string>${escape(value)}</string>`)
    .join("\n");
  const env = Object.entries(input.environment)
    .map(
      ([key, value]) =>
        `    <key>${escape(key)}</key>\n    <string>${escape(value)}</string>`
    )
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${escape(input.label)}</string>
  <key>ProgramArguments</key>
  <array>
${args}
  </array>
  <key>EnvironmentVariables</key>
  <dict>
${env}
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
  </dict>
  <key>ThrottleInterval</key>
  <integer>10</integer>
  <key>StandardOutPath</key>
  <string>${escape(join(input.logDirectory, "server.log"))}</string>
  <key>StandardErrorPath</key>
  <string>${escape(join(input.logDirectory, "server.err.log"))}</string>
  <key>WorkingDirectory</key>
  <string>${escape(input.workingDirectory)}</string>
</dict>
</plist>
`;
}

/* ============================================================
 * init 恢复矩阵四分支（禁 --force）：
 *   两个配置都在且合法 → 已完成，什么都不做；
 *   两个都缺           → 跑一次 init；
 *   缺其一             → 从已安装包模板补齐缺的那个；
 *   补齐失败           → needs-attention。
 * 任何路径都不许用 --force 覆盖用户已有配置——那是一次不可撤销的
 * 数据丢失，换来的只是代码里少一个分支。
 * ============================================================ */
export type InitOutcome =
  | { kind: "already-initialized" }
  | { kind: "initialized" }
  | { kind: "awaiting-secrets"; missing: string[] }
  | { kind: "built"; files: Record<string, string> }
  | { kind: "repaired"; files: string[] }
  | { kind: "needs-attention"; missing: string[]; detail: string };

export async function ensureInitialized(input: {
  spec: InstallSpec;
  roots: ManagedRoots;
  runInit(): Promise<void>;
  /** 从已安装包内找到模板文件的绝对路径；找不到返回 null。 */
  findTemplate(fileName: string): Promise<string | null>;
  values: ResolvedConfigValues;
  missingRequired: string[];
  skipFiles?: ReadonlySet<string>;
}): Promise<InitOutcome> {
  const present = await Promise.all(
    input.spec.configFiles.map(async (file) => ({
      file,
      ok: await exists(join(input.roots.dataRoot, file)),
    }))
  );
  const missing = present.filter((item) => !item.ok).map((item) => item.file);
  if (missing.length === 0) return { kind: "already-initialized" };
  if (input.spec.initMode === "builder") {
    if (input.missingRequired.length) {
      return { kind: "awaiting-secrets", missing: input.missingRequired };
    }
    const built: Record<string, string> = {};
    for (const file of missing) {
      if (input.skipFiles?.has(file)) continue;
      const builder = input.spec.configBuilders?.[file];
      if (!builder) throw new Error(`${file} 缺少托管配置 builder`);
      built[file] = await writeManagedJson(
        join(input.roots.dataRoot, file),
        builder({
          dataRoot: input.roots.dataRoot,
          installRoot: input.roots.installRoot,
          values: input.values,
        })
      );
    }
    return Object.keys(built).length
      ? { kind: "built", files: built }
      : { kind: "already-initialized" };
  }
  if (missing.length === input.spec.configFiles.length) {
    await input.runInit();
    const after = await Promise.all(
      input.spec.configFiles.map((file) =>
        exists(join(input.roots.dataRoot, file))
      )
    );
    if (after.every(Boolean)) return { kind: "initialized" };
    return {
      kind: "needs-attention",
      missing: input.spec.configFiles.filter((_, index) => !after[index]),
      detail: "init 执行完成但配置文件仍缺失",
    };
  }
  const repaired: string[] = [];
  for (const file of missing) {
    const template = await input.findTemplate(file);
    if (!template) {
      return {
        kind: "needs-attention",
        missing,
        detail: `已安装包内找不到 ${file} 的模板，且不允许 --force 覆盖现有配置`,
      };
    }
    await copyFile(template, join(input.roots.dataRoot, file));
    repaired.push(file);
  }
  return { kind: "repaired", files: repaired };
}

export async function writeManagedJson(path: string, value: object) {
  const content = managedJsonContent(value);
  const staging = `${path}.tmp`;
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(staging, content, { mode: 0o600 });
  await chmod(staging, 0o600);
  await rename(staging, path);
  return createHash("sha256").update(content).digest("hex");
}

export async function hashFile(path: string) {
  const digest = createHash("sha256");
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(path);
    stream.on("data", (chunk) => digest.update(chunk));
    stream.once("error", reject);
    stream.once("end", resolve);
  });
  return digest.digest("hex");
}

export const managedJsonContent = (value: object) =>
  `${JSON.stringify(value, null, 2)}\n`;

export const hashManagedJson = (value: object) =>
  createHash("sha256").update(managedJsonContent(value)).digest("hex");

/** 在 venv 的 site-packages 里按文件名找模板；只读、只找一层深度有限的树。 */
export async function findPackagedTemplate(
  roots: ManagedRoots,
  fileName: string
) {
  const sitePackages = join(roots.installRoot, "venv", "lib");
  const queue = [sitePackages];
  let visited = 0;
  while (queue.length && visited < 4_000) {
    const directory = queue.shift()!;
    visited += 1;
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) queue.push(path);
      else if (entry.name === fileName || entry.name === `${fileName}.example`) {
        return path;
      }
    }
  }
  return null;
}
