/**
 * [INPUT]: Depends on core generation drain counters and the external provider registry.
 * [OUTPUT]: Provides the retirement proof shared by promotion and deletion.
 * [POS]: Generation lifecycle guard; unknown or nonzero counts block collection without waiting inside a lock.
 */

import type { AppGenerationDrainCount } from "../../../../shared/app-lifecycle";
import { statusError } from "../../errors";
import type { AppGenerationDrainProviderRegistry } from "./drain-providers";

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
      throw statusError(409, "APP_GENERATION_DRAIN_BLOCKED", { blockers });
    }
    return Object.freeze({ ...input, counts, retiredAt: Date.now() });
  }
}
