/**
 * [INPUT]: First-party Widget inventory, installed Electron resources and the verified plugin receiver.
 * [OUTPUT]: Offline per-package installation and repair with immutable revision custody.
 * [POS]: Shared seed and repair path for bundled native Widgets.
 */
import { randomUUID } from "node:crypto";
import { lstat, rename } from "node:fs/promises";
import { join, relative } from "node:path";
import { app } from "electron";
import { OFFICIAL_WIDGETS, type OfficialWidgetId } from "../../../../shared/system-dock/widgets/catalog/official";
import { validateOfficialWidgetManifest } from "../../../../shared/system-dock/widgets/catalog/manifest";
import type { UnifiedPluginPlatform } from "../platform/service";
import { verifyUnifiedPluginDistribution } from "../distribution/verify";
import { importVerifiedPluginFiles } from "../integration/distribution";

export async function installBundledWidget(platform: UnifiedPluginPlatform, pluginId: OfficialWidgetId,
  userData: string, signal: AbortSignal, assertCurrent = () => {}) {
  signal.throwIfAborted();
  assertCurrent();
  const mainDirectory = app.isPackaged
    ? join(process.resourcesPath, "app.asar.unpacked", relative(app.getAppPath(), __dirname))
    : __dirname;
  const directory = join(mainDirectory, "official-plugins", OFFICIAL_WIDGETS[pluginId].directory);
  const checked = await verifyUnifiedPluginDistribution(directory);
  const { distribution, packageDigest } = checked;
  if (distribution.pluginId !== pluginId) throw new Error("Bundled Widget identity differs from its resource directory");
  validateOfficialWidgetManifest(distribution.manifest, true);
  const existing = platform.get(pluginId);
  if (existing && existing.installation.origin !== "official") throw new Error("Official Widget identity is already owned");
  if (existing?.acceptedRevision === distribution.revisionId && platform.isActive(pluginId, distribution.revisionId)) return;

  const buildsRoot = join(userData, "official-widget-packages");
  const destination = join(buildsRoot, pluginId, distribution.revisionId.slice(7));
  const hasCache = await lstat(destination).then(() => true, error => {
    if (error.code === "ENOENT") return false;
    throw error;
  });
  const intact = hasCache && await verifyUnifiedPluginDistribution(destination).then(value => value.packageDigest === packageDigest, () => false);
  signal.throwIfAborted();
  assertCurrent();
  if (hasCache && !intact) {
    // Leave the damaged bytes beside the cache for diagnosis. Only the exact verified revision can replace them.
    await rename(destination, destination + ".damaged-" + randomUUID());
  }
  const revision = await importVerifiedPluginFiles(checked, buildsRoot, 0);
  await platform.installOfficialWidget({
    ...revision, officialWidget: { publisherId: "bottega", bundleDigest: packageDigest },
  }, { signal, assertCurrent });
}
