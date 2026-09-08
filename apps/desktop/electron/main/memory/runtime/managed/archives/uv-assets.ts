/**
 * [INPUT]: Depends on reviewed upstream uv release assets and explicit OS/architecture facts
 * [OUTPUT]: Provides the single pinned uv version, archive/member/digest contracts and venv entry mapping
 * [POS]: Memory managed supply metadata; independent of compiler payload and model-network authorization
 */

import { join } from "node:path";

export const MANAGED_UV_VERSION = "0.12.3";
export const UV_ARCHIVE_BYTES = 32 * 1024 * 1024;
export const UV_EXPANDED_BYTES = 96 * 1024 * 1024;
export const WINDOWS_UV_MEMBERS = ["uv.exe", "uvw.exe", "uvx.exe"] as const;

const ASSETS = {
  "darwin-arm64": { folder: "uv-aarch64-apple-darwin", format: "tar.gz", sha256: "546f7f8a6c70ff13a3a9d2bc958db3427298cebf3e0cb756f9177133b7068843" },
  "darwin-x64": { folder: "uv-x86_64-apple-darwin", format: "tar.gz", sha256: "4c9f52262a14da336e4a42ed24992d12d0c956acde87619e4611d321dffa602b" },
  "linux-x64": { folder: "uv-x86_64-unknown-linux-gnu", format: "tar.gz", sha256: "600cf9a742aca00d292673b16b5acffaa7b8c269a364ad0c2e79498dcb1fe101" },
  "win32-x64": { folder: "uv-x86_64-pc-windows-msvc", format: "zip", sha256: "b23350c79e8ad0192b8124af13a0f17e8d4e4549524785e1aef389ae5a06990e" },
} as const;

export function managedUvAsset(platform: NodeJS.Platform, arch: NodeJS.Architecture) {
  const asset = ASSETS[`${platform}-${arch}` as keyof typeof ASSETS];
  if (!asset) throw new Error(`MEMORY_RUNTIME_ASSET_UNAVAILABLE: ${platform}-${arch}`);
  return { ...asset, executable: asset.format === "zip" ? "uv.exe" : "uv", asset: `${asset.folder}.${asset.format}` };
}

export function venvExecutable(venv: string, executable: string, platform = process.platform) {
  return platform === "win32" ? join(venv, "Scripts", `${executable.replace(/\.exe$/i, "")}.exe`) : join(venv, "bin", executable);
}
