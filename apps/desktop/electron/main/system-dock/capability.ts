/**
 * [INPUT]: Depends on Node fs/os/path and immutable platform/packaging facts supplied by the caller.
 * [OUTPUT]: Provides the Dock runtime gate (macOS 15.0+ on arm64, helper present) evaluated before any Dock module loads a window, registers a service, or writes a preference, plus replacement admission (packaged build with the bundled recovery LaunchAgent) and the resolved helper/agent paths.
 * [POS]: system-dock platform policy (5.6); never raises the whole app's minimum system version and never reads environment overrides.
 */

import { existsSync, readdirSync } from "node:fs";
import { release } from "node:os";
import { join } from "node:path";
import type { DockCapability } from "../../../shared/system-dock/ipc";

export const MINIMUM_DARWIN_MAJOR = 24; // macOS 15.0 Sequoia
export type DockPaths = { bridge: string; agent: string; launchAgents: string };
export type DockPlatform = { capability: DockCapability; paths: DockPaths; serviceName: string | null };

export function dockPaths(input: { packaged: boolean; resourcesPath: string; mainDirectory: string }): DockPaths {
  const root = input.packaged ? join(input.resourcesPath, "system-dock") : join(input.mainDirectory, "../system-dock");
  return { bridge: join(root, "bin/system-dock-bridge"), agent: join(root, "bin/bottega-dock-recovery"),
    launchAgents: input.packaged ? join(input.resourcesPath, "../Library/LaunchAgents") : join(root, "LaunchAgents") };
}
/** The recovery service is whichever `*.dock-recovery.plist` this very bundle ships; renderer or cloud input never names it. */
export function findServiceName(directory: string, exists: (path: string) => boolean = existsSync, list: (path: string) => string[] = (path) => readdirSync(path)): string | null {
  if (!exists(directory)) return null;
  const matches = list(directory).filter((name) => /^[A-Za-z0-9.-]+\.dock-recovery\.plist$/.test(name)).sort();
  return matches.length === 1 ? matches[0]! : null;
}
export function evaluateDockPlatform(input: { platform: NodeJS.Platform; arch: string; darwinRelease?: string; packaged: boolean; resourcesPath: string; mainDirectory: string;
  exists?: (path: string) => boolean; list?: (path: string) => string[] }): DockPlatform {
  const exists: (path: string) => boolean = input.exists ?? existsSync;
  const paths = dockPaths(input);
  const unsupported = (reason: DockCapability["reason"]): DockPlatform => ({ capability: { supported: false, replacement: false, reason }, paths, serviceName: null });
  if (input.platform !== "darwin") return unsupported("platform");
  if (input.arch !== "arm64") return unsupported("architecture");
  const major = Number.parseInt((input.darwinRelease ?? release()).split(".")[0] ?? "", 10);
  if (!Number.isFinite(major) || major < MINIMUM_DARWIN_MAJOR) return unsupported("os-version");
  if (!exists(paths.bridge)) return unsupported("helper-missing");
  if (!input.packaged) return { capability: { supported: true, replacement: false, reason: "development" }, paths, serviceName: null };
  const serviceName = findServiceName(paths.launchAgents, exists, input.list);
  if (!serviceName || !exists(paths.agent)) return { capability: { supported: true, replacement: false, reason: "helper-missing" }, paths, serviceName: null };
  return { capability: { supported: true, replacement: true, reason: null }, paths, serviceName };
}
/** launchd Label and Mach service share one name: the plist file name without its extension. */
export function machServiceFor(serviceName: string) { return serviceName.replace(/\.plist$/, ""); }
