/**
 * [INPUT]: The selected official release, downloaded bytes and the original profile/layout authority.
 * [OUTPUT]: Verified UI-only archives imported into the immutable plugin store with official receipts.
 * [POS]: Local distribution admission. Existing compiler, archive and activation owners retain their responsibilities.
 */
import { join } from "node:path";
import { readdir, rm } from "node:fs/promises";
import { hashCanonical } from "@bottega/contracts/core/canonical-json";
import { z } from "zod";
import type { UnifiedPluginPlatform } from "../../../plugins/platform/service";
import type { OfficialWidgetOperation } from "../../../plugins/platform/model";
import { importVerifiedPluginFiles } from "../../../plugins/integration/distribution";
import { verifyCloudPluginArchive } from "../../../cloud/widgets/plugins/codec";
import { pluginBytesHash } from "../../../plugins/engineering/snapshot";
import { validateOfficialWidgetManifest } from "../../../../../shared/system-dock/widgets/catalog/manifest";
import { OFFICIAL_WIDGETS, officialWidgetId, type OfficialWidgetId, type WidgetRelease } from "../../../../../shared/system-dock/widgets/catalog/distribution";
import { weatherConfigurationSchema } from "../../../../../shared/system-dock/widgets/weather";
import type { DockWidget } from "../../../../../shared/system-dock/layout";

export function packageWidgetId(widget: DockWidget): OfficialWidgetId | null {
  if (widget.type === "builtin.ai-activity") return "bottega-ai-usage";
  return widget.type === "plugin" && widget.pluginId === "bottega-weather" && widget.contributionId === "current"
    ? "bottega-weather" : null;
}

export function verifyOfficialArchive(bytes: Buffer, pluginId: OfficialWidgetId, release: WidgetRelease) {
  if (bytes.length !== release.archive.bytes || pluginBytesHash(bytes) !== release.archive.sha256) throw new Error("Widget archive bytes differ from its catalog");
  const packet = verifyCloudPluginArchive(bytes, release.packageDigest);
  const { distribution } = packet;
  const widget = validateOfficialWidgetManifest(distribution.manifest);
  if (distribution.pluginId !== pluginId || distribution.manifest.version !== release.version ||
      distribution.revisionId !== release.revisionId || distribution.dataContract !== OFFICIAL_WIDGETS[pluginId].dataContract ||
      distribution.dataContract !== release.dataContract || release.contributionIds[0] !== widget.id ||
      hashCanonical(distribution.target) !== hashCanonical(release.target) ||
      !/^runtime\/ui\/[a-z0-9.-]+\.html$/.test(widget.entry) ||
      distribution.files.some(file => file.path !== "bottega.plugin.json" &&
        (file.role !== "runtime" || !/^runtime\/ui\/[a-zA-Z0-9._-]+\.(html|js|css|png|webp|svg|woff2?)$/.test(file.path)))) {
    throw new Error("Widget archive differs from its selected release");
  }
  return { packet, widget };
}

type Verified = ReturnType<typeof verifyOfficialArchive>;
export function assertCompatibleInstances(verified: Verified, widgets: readonly DockWidget[]) {
  const schema = z.fromJSONSchema((verified.widget.settingsSchema ?? { type: "object" }) as Parameters<typeof z.fromJSONSchema>[0]);
  const id = verified.packet.distribution.pluginId;
  for (const item of widgets) {
    if (packageWidgetId(item) !== id) continue;
    const configuration = item.type === "plugin" ? item.configuration
      : item.type === "builtin.ai-activity" ? { source: item.source, period: item.period } : null;
    if (item.type === "plugin" && !weatherConfigurationSchema.safeParse(item.configuration).success) continue;
    if (!schema.safeParse(configuration).success) throw new Error("Widget package cannot read an existing instance configuration");
  }
}

export async function pruneOfficialWidgetPackages(platform: UnifiedPluginPlatform, userData: string) {
  for (const id of officialWidgetId.options) {
    const root = join(userData, "official-widget-packages", id);
    const retained = new Set(platform.get(id) ? platform.revisions(id).map(value => value.revisionId.slice(7)) : []);
    const entries = await readdir(root, { withFileTypes: true }).catch(error => {
      if (error.code === "ENOENT") return [];
      throw error;
    });
    for (const entry of entries) {
      if (entry.isDirectory() && !retained.has(entry.name) && /^(?:[a-f0-9]{64}|\.receive-[a-zA-Z0-9]{6})$/.test(entry.name))
        await rm(join(root, entry.name), { recursive: true, force: true });
    }
  }
}

export async function installVerifiedWidget(input: {
  platform: UnifiedPluginPlatform; userData: string; verified: Verified; archiveSha256: string;
  options: OfficialWidgetOperation;
}) {
  const id = input.verified.packet.distribution.pluginId;
  const revision = await importVerifiedPluginFiles(input.verified.packet, join(input.userData, "official-widget-packages"), 0);
  try {
    return await input.platform.installOfficialWidget({
      ...revision, officialWidget: { publisherId: "bottega", archiveSha256: input.archiveSha256 },
    }, input.options);
  } finally {
    const current = input.platform.get(id);
    if (!current || !input.platform.revisions(id).some(value => value.revisionId === revision.revisionId))
      await rm(revision.rootDirectory, { recursive: true, force: true });
  }
}
