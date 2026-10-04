/**
 * [INPUT]: None.
 * [OUTPUT]: Provides PLUGINS_CHANNEL, the desktop IPC channels behind PluginsBridge (list, detail, set-enabled, disable-impact, settings, set-settings, changed).
 * [POS]: Kept apart from the schemas so the preload bundles strings, not the contracts' Zod code.
 */
export const PLUGINS_CHANNEL = Object.freeze({ list: "plugins:list", detail: "plugins:detail", setEnabled: "plugins:set-enabled",
  disableImpact: "plugins:disable-impact", settings: "plugins:settings", setSettings: "plugins:set-settings", changed: "plugins:changed" } as const);
