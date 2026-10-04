/**
 * [INPUT]: Depends on a narrow live App-registry reader, its global default grant, and the canonical Design preset id
 * [OUTPUT]: Provides DesignEnabled, a stateless projection used by Skills, gateway admission, watcher, and App UI
 * [POS]: Design's single enabled truth adapter; it deliberately stores no cache or duplicate lifecycle flag
 */

export const DESIGN_PRESET_ID = "design-canvas";
export const DESIGN_FACTORY_CUSTODY_SLOT = "factory:design-canvas:singleton";

export type DesignAppProjection = Readonly<{
  id: string;
  presetId?: string;
  state: string;
  defaultGrant?: unknown | null;
  generationBinding: Readonly<{ active: unknown | null }>;
}>;

export type DesignAppRegistry = Readonly<{
  get(appId: string): DesignAppProjection | undefined;
  list(): readonly DesignAppProjection[];
}>;

export class DesignEnabled {
  constructor(private readonly apps: DesignAppRegistry) {}

  isAppEnabled(appId: string) {
    const app = this.apps.get(appId);
    return Boolean(
      app?.presetId === DESIGN_PRESET_ID &&
        app.state === "ready" &&
        app.defaultGrant != null &&
        app.generationBinding.active
    );
  }

  enabledAppId() {
    return this.apps.list().find((app) => this.isAppEnabled(app.id))?.id ?? null;
  }

  isEnabled() {
    return this.enabledAppId() !== null;
  }
}
