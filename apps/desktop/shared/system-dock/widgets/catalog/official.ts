/**
 * [INPUT]: First-party Widget package and contribution identities.
 * [OUTPUT]: Shared bundled package inventory, native labels and legacy layout aliases.
 * [POS]: Lightweight identity table used by the builder, Dock and plugin platform.
 */
export const OFFICIAL_WIDGETS = {
  "bottega-weather": { directory: "weather", contributionId: "current", dataContract: "weather-v1", label: "weather" },
  "bottega-ai-limits": { directory: "ai-limits", contributionId: "remaining", dataContract: "limits-v1", label: "limits" },
  "bottega-ai-usage": { directory: "ai-usage", contributionId: "today", dataContract: "usage-v1", label: "activity" },
  "bottega-tasks": { directory: "tasks", contributionId: "status", dataContract: "tasks-v1", label: "tasks" },
} as const;
export type OfficialWidgetId = keyof typeof OFFICIAL_WIDGETS;
export const officialWidgetIds = Object.keys(OFFICIAL_WIDGETS) as OfficialWidgetId[];
export const isOfficialWidgetId = (id: string): id is OfficialWidgetId => Object.hasOwn(OFFICIAL_WIDGETS, id);

export const NATIVE_WIDGET_PLUGINS = {
  "builtin.ai-limits": "bottega-ai-limits",
  "builtin.ai-activity": "bottega-ai-usage",
  "builtin.tasks": "bottega-tasks",
} as const;

export const officialDefinitionId = (id: OfficialWidgetId) => id + "." + OFFICIAL_WIDGETS[id].contributionId;

export type NativeWidgetType = keyof typeof NATIVE_WIDGET_PLUGINS;

export function nativeWidgetType(pluginId: string, contributionId: string): NativeWidgetType | undefined {
  return (Object.keys(NATIVE_WIDGET_PLUGINS) as NativeWidgetType[]).find(type => {
    const id = NATIVE_WIDGET_PLUGINS[type];
    return pluginId === id && contributionId === OFFICIAL_WIDGETS[id].contributionId;
  });
}
