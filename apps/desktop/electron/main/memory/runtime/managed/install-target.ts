/**
 * [INPUT]: Depends on the core/provider's InstallSpec
 * [OUTPUT]: Provides ManagedInstallTarget with resolveInstallTarget, which generates an accurate version of the master package and accompanying locks at a single point
 * [POS]: The installation target is the main/memory/runtime/managed purest value layer; repair/upgrade/switch no longer spelled uv argv
 */

import type { InstallSpec } from "../../core/provider";

export type ManagedInstallTarget = ReturnType<typeof resolveInstallTarget>;

export function resolveInstallTarget(spec: InstallSpec, requested?: string) {
  const version = requested ?? spec.lockedVersion;
  return {
    version,
    uvPackages: [
      ...(spec.pypiPackage ? [`${spec.pypiPackage}==${version}`] : []),
      ...spec.pinnedPackages,
    ],
    stepLabel: requested && requested !== spec.lockedVersion
      ? `安装自选版本 ${requested}`
      : `安装锁定版本 ${version}`,
  } as const;
}
