/**
 * [INPUT]: Depends on the current MemoryEffectiveTarget and the managed runtime registry's manifest/ownership/manual-config/service-identity checks
 * [OUTPUT]: Provides authorizeMemoryRebuild, returning the target's providerDataInstanceId once ownership and identity are proven, or throwing otherwise
 * [POS]: The main/memory/service/support destructive-operation authorization gate; every fail-closed proof must pass before any data wipe is allowed to proceed
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
