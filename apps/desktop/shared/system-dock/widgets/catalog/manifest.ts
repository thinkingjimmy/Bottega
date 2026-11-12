/**
 * [INPUT]: The unified plugin manifest and known official Widget identities.
 * [OUTPUT]: Validates the one-contribution, UI-only declaration used by the builder and local package receiver.
 * [POS]: Static contract validation. The Main receiver also verifies every artifact and its selected catalog identity.
 */
import type { UnifiedPluginManifest } from "@bottega/contracts/plugins/platform";
import { isOfficialWidgetId, OFFICIAL_WIDGETS } from "./distribution";

export function validateOfficialWidgetManifest(manifest: UnifiedPluginManifest) {
  const widget = manifest.contributions[0];
  const requirements = manifest.requirements;
  if (!isOfficialWidgetId(manifest.id) || manifest.source.kind !== "official" ||
      manifest.source.editable || manifest.source.format !== "bottega" || manifest.essential ||
      manifest.providerAlias || manifest.dependencies.length || requirements.features.length ||
      requirements.runtimes.length !== 1 || requirements.runtimes[0] !== "desktop" ||
      requirements.platforms.length !== 1 || requirements.platforms[0] !== "darwin" ||
      (requirements.nodeMajor !== undefined && requirements.nodeMajor !== 24) ||
      manifest.slots.declares.length || manifest.slots.injects.length !== 1 ||
      manifest.slots.injects[0]?.slot !== "dock.widgets" || manifest.slots.injects[0]?.ownerPluginId !== "host" ||
      manifest.contributions.length !== 1 || widget?.kind !== "widget" ||
      widget.id !== OFFICIAL_WIDGETS[manifest.id].contributionId || widget.slot !== "dock.widgets" ||
      !widget.customCard || widget.summary || manifest.dataContract !== OFFICIAL_WIDGETS[manifest.id].dataContract ||
      (requirements.hostContract && requirements.hostContract !== manifest.dataContract)) {
    throw new Error("Invalid official Widget declaration");
  }
  return widget;
}
