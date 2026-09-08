/**
 * [INPUT]: Depends on pinned OS/architecture uv assets, bounded tar/ZIP parsing, captured version checks and the Memory downloader
 * [OUTPUT]: Provides single-flight uv supply with archive digests, platform executable names and staging verification before atomic publication
 * [POS]: the owner of the registry-level toolchain main/memory/runtime/managed; All providers share a single-flight supply
 */

import { createHash, randomUUID } from "node:crypto";
import { chmod, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import type { Downloader, RunCommandCaptured } from "./install-steps";

import { MANAGED_UV_VERSION, managedUvAsset, UV_ARCHIVE_BYTES, UV_EXPANDED_BYTES } from "./archives/uv-assets";
import { extractUvFromZip } from "./archives/zip";
export { MANAGED_UV_VERSION } from "./archives/uv-assets";

export type ManagedUv = { command: string; env: Record<string, string> };

export type ManagedToolchainOptions = {
  arch?: NodeJS.Architecture;
  platform?: NodeJS.Platform;
  runCaptured: RunCommandCaptured;
  download: Downloader;
  systemCandidates?: string[];
};

export class ManagedToolchain {
  private flight: Promise<ManagedUv> | null = null;
  private readonly arch: NodeJS.Architecture;

  constructor(
    private readonly toolsRoot: string,
    private readonly options: ManagedToolchainOptions
  ) {
    this.arch = options.arch ?? process.arch;
  }

  resolve() {
    this.flight ??= this.resolveOnce().finally(() => {
      this.flight = null;
    });
    return this.flight;
  }

  environment() {
    return {
      UV_CACHE_DIR: join(this.toolsRoot, "cache"),
      UV_PYTHON_INSTALL_DIR: join(this.toolsRoot, "python"),
    };
  }

  private async resolveOnce(): Promise<ManagedUv> {
    const platform = this.options.platform ?? process.platform;
    const release = managedUvAsset(platform, this.arch);
    const env = this.environment();
    await Promise.all(
      Object.values(env).map((directory) =>
        mkdir(directory, { recursive: true, mode: 0o700 })
      )
    );
    const system =
      this.options.systemCandidates ??
      [release.executable, join(homedir(), ".local", "bin", release.executable),
        ...(platform === "darwin" ? ["/opt/homebrew/bin/uv", "/usr/local/bin/uv"] : [])];
    for (const command of system) {
      if (await this.matchesLockedVersion(command, env)) return { command, env };
    }

    const command = join(this.toolsRoot, MANAGED_UV_VERSION, release.executable);
    if (await this.matchesLockedVersion(command, env)) return { command, env };

    const archive = await this.options.download(
      `https://github.com/astral-sh/uv/releases/download/${MANAGED_UV_VERSION}/${release.asset}`,
      { maximumBytes: UV_ARCHIVE_BYTES, allowedOrigins: ["https://github.com", "https://release-assets.githubusercontent.com"] }
    );
    if (archive.length > UV_ARCHIVE_BYTES) throw new Error("uv 归档超过字节预算");
    const digest = createHash("sha256").update(archive).digest("hex");
    if (digest !== release.sha256) {
      throw new Error(`uv SHA256 校验失败：期望 ${release.sha256}，实得 ${digest}`);
    }
    const binary = release.format === "zip" ? extractUvFromZip(archive) : extractUvFromTarGz(archive, release.folder);
    const directory = join(this.toolsRoot, MANAGED_UV_VERSION);
    const stagingRoot = join(directory, `.staging-${randomUUID()}`);
    const staging = join(stagingRoot, release.executable);
    await mkdir(stagingRoot, { recursive: true, mode: 0o700 });
    try {
      await writeFile(staging, binary, { mode: 0o755, flag: "wx" });
      await chmod(staging, 0o755);
      if (!(await this.matchesLockedVersion(staging, env))) throw new Error("产品供给的 uv 版本校验失败");
      await rename(staging, command);
    } finally {
      await rm(stagingRoot, { recursive: true, force: true });
    }
    return { command, env };
  }

  private async matchesLockedVersion(command: string, env: Record<string, string>) {
    try {
      const result = await this.options.runCaptured(command, ["--version"], {
        timeoutMs: 10_000,
        byteLimit: 4_096,
        env,
      });
      return result.code === 0 && result.stdout.trim().split(/\s+/)[1] === MANAGED_UV_VERSION;
    } catch {
      return false;
    }
  }
}

export function extractUvFromTarGz(archive: Buffer, folder: string) {
  let tar: Buffer;
  try {
    tar = gunzipSync(archive, { maxOutputLength: UV_EXPANDED_BYTES });
  } catch (cause) {
    throw new Error("uv 归档解压失败或超过字节预算", { cause });
  }
  const allowed = new Set([`${folder}/`, `${folder}/uv`, `${folder}/uvx`]);
  const seen = new Set<string>();
  let uv: Buffer | null = null;
  for (let offset = 0; offset + 512 <= tar.length; ) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const checksum = Number.parseInt(tarText(header.subarray(148, 156)).trim(), 8);
    const actualChecksum = header.reduce((sum, byte, index) => sum + (index >= 148 && index < 156 ? 32 : byte), 0);
    if (checksum !== actualChecksum) throw new Error("uv 归档 header 校验失败");
    const name = tarText(header.subarray(0, 100));
    const prefix = tarText(header.subarray(345, 500));
    const path = prefix ? `${prefix}/${name}` : name;
    const type = String.fromCharCode(header[156] || 48);
    const sizeText = tarText(header.subarray(124, 136)).trim();
    if (!/^[0-7]+$/.test(sizeText)) throw new Error("uv 归档成员大小无效");
    const size = Number.parseInt(sizeText, 8);
    if (!Number.isSafeInteger(size) || size < 0 || size > UV_EXPANDED_BYTES) {
      throw new Error("uv 归档成员大小无效");
    }
    if (
      path.startsWith("/") ||
      path.split("/").includes("..") ||
      !allowed.has(path) ||
      (path.endsWith("/") ? type !== "5" || size !== 0 : type !== "0") ||
      seen.has(path.toLowerCase())
    ) {
      throw new Error(`uv 归档含不安全成员：${path}`);
    }
    seen.add(path.toLowerCase());
    const bodyStart = offset + 512;
    const bodyEnd = bodyStart + size;
    if (bodyEnd > tar.length) throw new Error("uv 归档成员被截断");
    if (path === `${folder}/uv` && type === "0") uv = Buffer.from(tar.subarray(bodyStart, bodyEnd));
    offset = bodyStart + Math.ceil(size / 512) * 512;
  }
  if (!uv || !seen.has(`${folder}/`) || !seen.has(`${folder}/uvx`)) {
    throw new Error("uv 归档缺少预期成员");
  }
  return uv;
}

function tarText(value: Buffer) {
  const zero = value.indexOf(0);
  return value.subarray(0, zero < 0 ? value.length : zero).toString("utf8");
}
