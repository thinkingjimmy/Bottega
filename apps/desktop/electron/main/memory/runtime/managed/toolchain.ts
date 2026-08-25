/**
 * [INPUT]: Depends on Node fs/path/os/zlib/crypto, capture-only commands to execute with HTTPS downloader
 * [OUTPUT]: Provides a ManagedToolchain with the version uv 0.12.3 lock, isolates UV_* environment and secure tar.gz developer
 * [POS]: the owner of the registry-level toolchain main/memory/runtime/managed; All providers share a single-flight supply
 */

import { createHash } from "node:crypto";
import { chmod, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import type { Downloader, RunCommandCaptured } from "./install-steps";

export const MANAGED_UV_VERSION = "0.12.3";
const MAX_ARCHIVE_BYTES = 32 * 1024 * 1024;
const MAX_EXPANDED_BYTES = 96 * 1024 * 1024;

const RELEASES = {
  arm64: {
    folder: "uv-aarch64-apple-darwin",
    sha256: "546f7f8a6c70ff13a3a9d2bc958db3427298cebf3e0cb756f9177133b7068843",
  },
  x64: {
    folder: "uv-x86_64-apple-darwin",
    sha256: "4c9f52262a14da336e4a42ed24992d12d0c956acde87619e4611d321dffa602b",
  },
} as const;

export type ManagedUv = { command: string; env: Record<string, string> };

export type ManagedToolchainOptions = {
  arch?: NodeJS.Architecture;
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
    const env = this.environment();
    await Promise.all(
      Object.values(env).map((directory) =>
        mkdir(directory, { recursive: true, mode: 0o700 })
      )
    );
    const system =
      this.options.systemCandidates ??
      ["uv", join(homedir(), ".local", "bin", "uv"), "/opt/homebrew/bin/uv", "/usr/local/bin/uv"];
    for (const command of system) {
      if (await this.matchesLockedVersion(command, env)) return { command, env };
    }

    const release = this.release();
    const command = join(this.toolsRoot, MANAGED_UV_VERSION, "uv");
    if (await this.matchesLockedVersion(command, env)) return { command, env };

    const archive = await this.options.download(
      `https://github.com/astral-sh/uv/releases/download/${MANAGED_UV_VERSION}/${release.folder}.tar.gz`
    );
    if (archive.length > MAX_ARCHIVE_BYTES) throw new Error("uv 归档超过字节预算");
    const digest = createHash("sha256").update(archive).digest("hex");
    if (digest !== release.sha256) {
      throw new Error(`uv SHA256 校验失败：期望 ${release.sha256}，实得 ${digest}`);
    }
    const binary = extractUvFromTarGz(archive, release.folder);
    const directory = join(this.toolsRoot, MANAGED_UV_VERSION);
    const staging = `${command}.tmp`;
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await writeFile(staging, binary, { mode: 0o755 });
    await chmod(staging, 0o755);
    await rename(staging, command);
    if (!(await this.matchesLockedVersion(command, env))) {
      await rm(command, { force: true });
      throw new Error("产品供给的 uv 版本校验失败");
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

  private release() {
    if (this.arch === "arm64") return RELEASES.arm64;
    if (this.arch === "x64") return RELEASES.x64;
    throw new Error(`当前 macOS 架构不受支持：${this.arch}`);
  }
}

export function extractUvFromTarGz(archive: Buffer, folder: string) {
  let tar: Buffer;
  try {
    tar = gunzipSync(archive, { maxOutputLength: MAX_EXPANDED_BYTES });
  } catch (cause) {
    throw new Error("uv 归档解压失败或超过字节预算", { cause });
  }
  const allowed = new Set([`${folder}/`, `${folder}/uv`, `${folder}/uvx`]);
  const seen = new Set<string>();
  let uv: Buffer | null = null;
  for (let offset = 0; offset + 512 <= tar.length; ) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const name = tarText(header.subarray(0, 100));
    const prefix = tarText(header.subarray(345, 500));
    const path = prefix ? `${prefix}/${name}` : name;
    const type = String.fromCharCode(header[156] || 48);
    const sizeText = tarText(header.subarray(124, 136)).trim();
    const size = Number.parseInt(sizeText || "0", 8);
    if (!Number.isSafeInteger(size) || size < 0 || size > MAX_EXPANDED_BYTES) {
      throw new Error("uv 归档成员大小无效");
    }
    if (
      path.startsWith("/") ||
      path.split("/").includes("..") ||
      !allowed.has(path) ||
      !["0", "5"].includes(type) ||
      seen.has(path)
    ) {
      throw new Error(`uv 归档含不安全成员：${path}`);
    }
    seen.add(path);
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
