/**
 * [INPUT]: Depends on shared App generation drain counts and composition-registered providers.
 * [OUTPUT]: Provides the closed external drain registry and exact generation count aggregation.
 * [POS]: Generation lifecycle port; retirement does not import the Extension implementation.
 */

import type { AppGenerationDrainCount } from "../../../../shared/app-lifecycle";

export type AppGenerationDrainProvider = {
  count(input: { appId: string; generationId: string }): Promise<AppGenerationDrainCount>;
};

export type AppGenerationDrainProviderId = "app-extension";

export class AppGenerationDrainProviderRegistry {
  private readonly providers = new Map<
    AppGenerationDrainProviderId,
    AppGenerationDrainProvider
  >();

  register(id: AppGenerationDrainProviderId, provider: AppGenerationDrainProvider) {
    if (this.providers.has(id)) throw new Error(`${id} drain provider 已注册`);
    this.providers.set(id, provider);
  }

  async counts(input: { appId: string; generationId: string }) {
    return Promise.all(
      [...this.providers.values()].map((provider) => provider.count(input))
    );
  }
}
