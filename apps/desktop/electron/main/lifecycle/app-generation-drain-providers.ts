/**
 * [INPUT]: Depends on shared AppGenerationDrainCount; Registered by Provider Composition Root
 * [OUTPUT]: Provides closed drain provider registry and generation accurate counting aggregate
 * [POS]: The extension of the lifecycle; Core retirement not import Extension aggregate
 */

import type { AppGenerationDrainCount } from "../../../shared/app-lifecycle";

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
