/**
 * [INPUT]: Depends on Node fs/path and the macOS product version, architecture and packaging facts supplied by the caller.
 * [OUTPUT]: Provides the macOS 27 Apple silicon Dock Alpha gate, independent recovery availability, pending installation verification and bundled helper paths.
 * [POS]: system-dock platform policy (5.6); never raises the whole app's minimum system version and never reads environment overrides.
 */

import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { DockCapability } from "../../../shared/system-dock/ipc";

export const DOCK_MACOS_MAJOR = 27;
export type DockPaths = { bridge: string; agent: string; glass: string; launchAgents: string };
export type DockPlatform = { capability: DockCapability; paths: DockPaths; serviceName: string | null; recoveryAvailable: boolean; nativeRecoveryAvailable: boolean };

export function dockPaths(input: { packaged: boolean; resourcesPath: string; mainDirectory: string }): DockPaths {
  const root = input.packaged ? join(input.resourcesPath, "system-dock") : join(input.mainDirectory, "../system-dock");
  return { bridge: join(root, "bin/system-dock-bridge"), agent: join(root, "bin/bottega-dock-recovery"),
    glass: join(root, "bin/dock-glass.node"),
    launchAgents: input.packaged ? join(input.resourcesPath, "../Library/LaunchAgents") : join(root, "LaunchAgents") };
}
/** The recovery service is whichever `*.dock-recovery.plist` this very bundle ships; renderer or cloud input never names it. */
export function findServiceName(directory: string, exists: (path: string) => boolean = existsSync, list: (path: string) => string[] = (path) => readdirSync(path)): string | null {
  if (!exists(directory)) return null;
  try {
    const matches = list(directory).filter((name) => /^[A-Za-z0-9.-]+\.dock-recovery\.plist$/.test(name)).sort();
    return matches.length === 1 ? matches[0]! : null;
  } catch { return null; }
}
export function evaluateDockPlatform(input: { platform: NodeJS.Platform; arch: string; systemVersion: string; packaged: boolean; resourcesPath: string; mainDirectory: string;
  exists?: (path: string) => boolean; list?: (path: string) => string[] }): DockPlatform {
  const exists: (path: string) => boolean = input.exists ?? existsSync;
  const paths = dockPaths(input);
  const base = { paths, serviceName: null as string | null, recoveryAvailable: false, nativeRecoveryAvailable: false };
  const unsupported = (reason: DockCapability["reason"]): DockPlatform => ({ ...base, capability: { supported: false, replacement: false, reason } });
  if (input.platform !== "darwin") return unsupported("platform");
  if (input.arch !== "arm64") return unsupported("architecture");
  // A new admission rule must never remove an old takeover's recovery path.
  base.nativeRecoveryAvailable = exists(paths.bridge);
  base.serviceName = input.packaged ? findServiceName(paths.launchAgents, exists, input.list) : null;
  base.recoveryAvailable = base.nativeRecoveryAvailable && Boolean(base.serviceName) && exists(paths.agent);
  const major = /^\d+(?:\.\d+){0,2}$/.test(input.systemVersion) ? Number(input.systemVersion.split(".")[0]) : NaN;
  if (major !== DOCK_MACOS_MAJOR) return unsupported("os-version");
  if (!base.nativeRecoveryAvailable) return unsupported("helper-missing");
  const reason = !input.packaged ? "development" : base.recoveryAvailable ? "checking" : "helper-missing";
  return { ...base, capability: { supported: true, replacement: false, reason } };
}
/** launchd Label and Mach service share one name: the plist file name without its extension. */
export function machServiceFor(serviceName: string) { return serviceName.replace(/\.plist$/, ""); }
