/**
 * [INPUT]: Stable official Widget IDs, the live platform and a verified revision receipt.
 * [OUTPUT]: Reserved identity admission, official readiness and legacy Weather selection checks.
 * [POS]: Main-owned platform admission. Generic install paths never grant official Widget authority.
 */
import type { UnifiedPluginRevision } from "@bottega/contracts/plugins/platform";
import { isOfficialWidgetId, type OfficialWidgetId } from "../../../../../shared/system-dock/widgets/catalog/distribution";
import { validateOfficialWidgetManifest } from "../../../../../shared/system-dock/widgets/catalog/manifest";
import type { UnifiedPluginPlatform } from "../service";

export function assertUnreservedWidget(id: string) {
  if (isOfficialWidgetId(id)) throw new Error("This identity is reserved for official Widget distribution");
}

export function isLegacyWeather(revision: UnifiedPluginRevision) {
  return revision.pluginId === "bottega-weather" && revision.manifest.version === "1.0.0" &&
    revision.manifest.source.kind === "official" && !revision.officialWidget;
}

export function canActivateWidget(revision: UnifiedPluginRevision, development: boolean | undefined, origin: string) {
  if (!isOfficialWidgetId(revision.pluginId)) return !revision.officialWidget;
  if (origin !== "official") return false;
  if (!development) return isLegacyWeather(revision);
  if (!revision.officialWidget) return false;
  try {
    validateOfficialWidgetManifest(revision.manifest);
    return revision.manifest.dataContract === revision.dataContract;
  } catch { return false; }
}

export function readyOfficialWidget(platform: Pick<UnifiedPluginPlatform, "get" | "activeRevision" | "isActive">, pluginId: OfficialWidgetId) {
  const record = platform.get(pluginId), revision = platform.activeRevision(pluginId);
  return Boolean(revision?.officialWidget && record?.installation.origin === "official" &&
    record.installation.enabled && record.acceptedRevision === revision.revisionId &&
    record.installation.acceptedRevision === revision.revisionId && platform.isActive(pluginId, revision.revisionId));
}
