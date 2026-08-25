/**
 * [INPUT]: Depends on the manifest, attribution, manual acceptance and service identity of the current Memory target and hosted runtime registry
 * [OUTPUT]: ProvIDes authorizing MemoryRebuild to return the only provider data instance ID when successful
 * [POS]: The main/memory/service/support destructive-operation authorization gate; Complete the fail-closed goal proof before any clean library
 */

import type { MemoryEffectiveTarget } from "../../../../../shared/memory-ipc";
import type { ManagedRuntimeRegistry } from "../../runtime/managed-registry";

export async function authorizeMemoryRebuild(
  providerId: string,
  target: MemoryEffectiveTarget,
  runtimes: ManagedRuntimeRegistry
) {
  if (
    providerId !== target.providerId ||
    !target.canRebuild ||
    !target.providerDataInstanceId
  ) {
    throw new Error(target.blockedReason ?? "当前目标不支持重建记忆");
  }
  const coordinator = runtimes.require(providerId);
  const manifest = await coordinator.manifest();
  if (!manifest || (await coordinator.ownershipValid(manifest)) !== true) {
    throw new Error("托管目录归属校验失败，拒绝重建");
  }
  if (await coordinator.hasManualConfig()) {
    throw new Error("配置已手工接管，产品无法确认清库目标");
  }
  await coordinator.assertServiceIdentity(target.baseUrl);
  return target.providerDataInstanceId;
}
