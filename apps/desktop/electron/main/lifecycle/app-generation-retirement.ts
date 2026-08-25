/**
 * [INPUT]: Depends on the core drain counters and AppGenerationDrainProviderRegistry
 * [OUTPUT]: Provides AppGenerationRetirementCoordinator; Commonly promote with the same proof as delete, without waiting for the lock
 * [POS]: generation GC is the only access to the lifecycle; Any unknown/nonzero count is fail-closed
 */

import type { AppGenerationDrainCount } from "../../../shared/app-lifecycle";
import type { AppGenerationDrainProviderRegistry } from "./app-generation-drain-providers";

export type CoreGenerationDrainSource = {
  counts(input: { appId: string; generationId: string }): Promise<AppGenerationDrainCount[]>;
};

export class AppGenerationRetirementCoordinator {
  constructor(
    private readonly core: CoreGenerationDrainSource,
    private readonly providers: AppGenerationDrainProviderRegistry
  ) {}

  async proof(input: { appId: string; generationId: string }) {
    const counts = [
      ...(await this.core.counts(input)),
      ...(await this.providers.counts(input)),
    ];
    const blockers = counts.filter((entry) => entry.count > 0);
    if (blockers.length) {
      throw Object.assign(new Error("APP_GENERATION_DRAIN_BLOCKED"), {
        status: 409,
        blockers,
      });
    }
    return Object.freeze({ ...input, counts, retiredAt: Date.now() });
  }
}
