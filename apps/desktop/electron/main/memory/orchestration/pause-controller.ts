/**
 * [INPUT]: Depends on Policy v4, current sharing mode, rebuild, active projection, runtime extraction destination and Memory target
 * [OUTPUT]: Provides pause/resume: constantly rotate live Consent ((revoke/new build), rebuild mode only exempts abortNetwork
 * [POS]: The main/memory/orchestration is a suspension intent executorSettings Owner Persistent user intent, this controller only covers Policy/runtime facts
 */

import { randomUUID } from "node:crypto";
import type { MemoryEffectiveTarget } from "../../../../shared/memory-ipc";
import type { MemorySharingMode } from "../../../../shared/settings-ipc";
import type { MemoryPolicyStore } from "../policy/store";

type Dependencies = {
  policy: MemoryPolicyStore;
  rebuildActive(): boolean;
  initializeOwners(): Promise<void>;
  destination(providerId: string): Promise<{ hostname: string; model: string }>;
  changed(): void;
  abortNetwork(): void;
  publish(): void;
};

/* pause/resume 恒走同一条路：revoke 当下、resume 重签。rebuild job 的
   capability 是独立的 purpose=rebuild Epoch（不占 admission 槽位），
   所以这里 revoke live Epoch 不会碰 job 授权——旧的「rebuild 态只移动
   boundary」特例因此消失；它曾让暂停窗口的 Epoch 永不闭合，未来 rebuild
   会把该窗口重建成已授权历史。唯一保留的 rebuild 差异是不 abortNetwork
   （历史回灌的授权在 grant 冻结时已定，暂停不撤销历史）。 */
export class MemoryPauseController {
  constructor(private readonly dependencies: Dependencies) {}

  async pause() {
    await this.dependencies.initializeOwners();
    await this.dependencies.policy.pause(`pause:${randomUUID()}`);
    this.dependencies.changed();
    if (!this.dependencies.rebuildActive()) this.dependencies.abortNetwork();
    this.dependencies.publish();
  }

  async resume(target: MemoryEffectiveTarget, sharingMode: MemorySharingMode) {
    await this.dependencies.initializeOwners();
    if (!target.providerDataInstanceId) throw new Error("Memory instance 不可用");
    const destination = await this.dependencies.destination(target.providerId);
    await this.dependencies.policy.resume({
      operationId: `resume:${randomUUID()}`,
      providerDataInstanceId: target.providerDataInstanceId,
      providerId: target.providerId,
      extractionHostname: destination.hostname,
      extractionModel: destination.model,
      sharingMode,
      effectiveAt: Date.now(),
    });
    this.dependencies.changed();
    this.dependencies.publish();
  }
}
