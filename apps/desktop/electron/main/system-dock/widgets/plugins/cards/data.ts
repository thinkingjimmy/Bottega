/**
 * [INPUT]: The selected instance configuration and the host's Weather and Usage owners.
 * [OUTPUT]: Card- and detail-specific official data and a cached Usage face for host fallback.
 * [POS]: Main-only Widget data contract. Reads never invoke the plugin process.
 */
import { weatherOwner } from "../../../../plugins/official/weather/runtime";
import { aiActivityWidgetSchema, type AiActivityWidget } from "../../../../../../shared/system-dock/layout";
import type { DockUsage } from "../../usage";
import type { PluginDockWidget } from "../../../../../../shared/system-dock/widgets/plugin";
import type { WidgetCardPresentation } from "../../../../../../shared/system-dock/widgets/catalog/distribution";

export function usageConfiguration(configuration: unknown) {
  return aiActivityWidgetSchema.parse({ type: "builtin.ai-activity", configVersion: 1, standard: "compact",
    ...configuration as Pick<AiActivityWidget, "source" | "period"> });
}

export function readUsageWidget(usage: DockUsage, itemId: string, widget: AiActivityWidget, view: WidgetCardPresentation["view"]) {
  const detail = usage.activityDetail(itemId, widget);
  const { state, tokens, costUsd, unpricedTokens, timeZone } = detail.face;
  return { state, tokens, costUsd, unpricedTokens, source: detail.source, updatedAt: detail.updatedAt,
    ...(view === "detail" ? { timeZone, issues: detail.issues } : {}) };
}

export async function readOfficialWidget(usage: DockUsage, itemId: string, widget: PluginDockWidget,
  view: WidgetCardPresentation["view"], signal: AbortSignal) {
  signal.throwIfAborted();
  if (widget.pluginId === "bottega-ai-usage") return readUsageWidget(usage, itemId, usageConfiguration(widget.configuration), view);
  const value = await weatherOwner().read({ configuration: widget.configuration }, signal);
  const { weather, detail } = value;
  const values = detail.reading.values;
  return { city: weather.city, temperature: weather.temperature, code: weather.code, condition: values.condition,
    today: weather.today, upcoming: weather.upcoming, updatedAt: detail.reading.updatedAt,
    ...(view === "detail" ? { feelsLike: values["feels-like"], humidity: values.humidity, timeZone: detail.timeZone } : {}) };
}
