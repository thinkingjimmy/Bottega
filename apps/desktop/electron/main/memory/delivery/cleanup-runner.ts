/**
 * [INPUT]: Depends on Delivery cleanup/RemoteTarget bookkeeping, provider purgeModel/session Delete ports with MemoryNetwork Runtime
 * [OUTPUT]: Provides descriptor classification of the accurate cleanup driver; The source session is removed by the tombstone and the entire Space action purges the workspace, which is absorbed by the adapter as the authorized finish mode
 * [POS]: network execution boundaries of memory/delivery; Store only remembers the fact that the destructive provider calls do not enter the durable gate
 */

import type { MemoryProviderDescriptor } from "../../../../shared/memory-ipc";
import type { MemoryProvider } from "../core/provider";
import { memorySpaceGate } from "../space-gate";
import type { MemoryDeliveryStore } from "./store";
import type { MemoryNetworkRuntime } from "../runtime/network-runtime";

type ProviderBinding = Readonly<{
  descriptor: MemoryProviderDescriptor;
  provider: MemoryProvider;
}>;

export class MemoryCleanupRunner {
  constructor(
    private readonly dependencies: {
      delivery: MemoryDeliveryStore;
      network: MemoryNetworkRuntime;
      provider(instanceId: string, providerId: string): ProviderBinding | null;
    }
  ) {}

  async drive(instanceId: string, requestId: string) {
    const snapshot = this.dependencies.delivery.snapshot();
    const instance = snapshot.providerInstances[instanceId];
    const request = instance?.cleanupRequests[requestId];
    if (!instance || !request) throw new Error("Cleanup request 不存在");
    if (request.state === "completed") return null;
    const binding = this.dependencies.provider(instanceId, instance.providerId);
    if (!binding || binding.descriptor.purgeModel === "runtime-reset") {
      return null;
    }
    const claimed = await this.dependencies.delivery.claimCleanupRequest(
      instanceId,
      requestId
    );
    try {
      await this.dependencies.network.run(async (signal) => {
        const targets = claimed.targetIds.map((targetId) => {
          const target = this.dependencies.delivery.remoteTarget(instanceId, targetId);
          if (!target) throw new Error(`Cleanup target ${targetId} 不存在`);
          return target;
        });
        for (const target of targets) {
          await binding.provider.disposeSessionRaw(
            Object.freeze({
              sessionKey: `${target.memorySpaceId}:${target.sourceSessionKey}`,
              workspacePeerId: target.expectedPeerId,
              remoteSessionId: target.remoteSessionId,
            }),
            { signal }
          );
        }
        if (claimed.reason !== "tombstone") {
          if (!binding.provider.purgeWorkspace) {
            throw new Error("Provider 声明 workspace-purge 却未实现 purgeWorkspace");
          }
          for (const workspacePeerId of new Set(
            targets.map((target) => target.expectedPeerId)
          )) {
            await binding.provider.purgeWorkspace({ workspacePeerId, signal });
          }
        }
      });
      return memorySpaceGate.run(claimed.memorySpaceId, () =>
        this.dependencies.delivery.completeCleanupRequest({
          providerDataInstanceId: instanceId,
          providerId: instance.providerId,
          requestId,
        })
      );
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : "远端清理失败";
      await this.dependencies.delivery.failCleanupRequest(
        instanceId,
        requestId,
        detail
      );
      throw cause;
    }
  }

  async driveOne() {
    for (const instance of Object.values(
      this.dependencies.delivery.snapshot().providerInstances
    )) {
      const request = Object.values(instance.cleanupRequests)
        .filter((item) => item.state === "pending")
        .sort((left, right) => left.createdAt - right.createdAt)[0];
      if (!request) continue;
      const receipt = await this.drive(instance.id, request.id);
      if (receipt) return true;
    }
    return false;
  }
}
