/**
 * [INPUT]: A trusted development fixture directory, the Dock capability and current installed plugin revisions.
 * [OUTPUT]: Last usable directory projection, verified static previews and the highest compatible stable release.
 * [POS]: Read-only local catalog owner. Only an installation operation reads an archive.
 */
import { parseStrictJson } from "@bottega/contracts/core/canonical";
import type { UnifiedPluginPlatform } from "../../../plugins/platform/service";
import {
  compareWidgetVersions, OFFICIAL_WIDGETS, WIDGET_CATALOG_LIMITS, widgetDirectorySchema,
  type DistributedWidgetId, type WidgetDirectory, type WidgetDirectoryRow, type WidgetRelease,
} from "../../../../../shared/system-dock/widgets/catalog/distribution";
import { localAssetName, readPreview, readWidgetAsset } from "./assets";

export async function readWidgetDirectory(root: string, signal?: AbortSignal) {
  const bytes = await readWidgetAsset(root, "catalog.json", WIDGET_CATALOG_LIMITS.catalog, signal);
  const directory = widgetDirectorySchema.parse(parseStrictJson(bytes, { maxBytes: WIDGET_CATALOG_LIMITS.catalog, maxDepth: 16, maxNodes: 16_000 }));
  if (directory.packages.some(value => value.releases.some(release => !localAssetName(release.archive.url))) ||
      directory.widgets.some(widget => !localAssetName(widget.preview.url))) throw new Error("Invalid Widget fixture asset address");
  return directory;
}

export function chooseWidgetRelease(directory: WidgetDirectory, id: DistributedWidgetId, version: string, supported: boolean) {
  const releases = directory.packages.find(entry => entry.pluginId === id)?.releases ?? [];
  const ordered = releases.toSorted((a, b) => compareWidgetVersions(b.version, a.version));
  const compatibleRuntime = (release: WidgetRelease) => supported && release.target.platform === process.platform &&
    release.target.arch === process.arch && release.target.nodeMajor === 24 && release.target.sdkVersion === 1;
  const runtime = ordered.filter(compatibleRuntime);
  const contract = runtime.filter(release => release.dataContract === OFFICIAL_WIDGETS[id].dataContract && release.contributionIds[0] === OFFICIAL_WIDGETS[id].contributionId);
  const release = contract.find(value => compareWidgetVersions(value.minBottegaVersion, version) <= 0);
  const minimum = contract.map(value => value.minBottegaVersion).sort(compareWidgetVersions)[0];
  return { release, reason: !runtime.length ? "runtime" as const : !contract.length ? "contract" as const : "version" as const, minimum };
}

export class LocalWidgetDirectory {
  private cached?: { directory: WidgetDirectory; images: Map<DistributedWidgetId, string | null> };
  private flight?: ReturnType<LocalWidgetDirectory["load"]>;
  private available = false;
  private readonly shutdown = new AbortController();
  constructor(readonly root: string, private readonly platform: UnifiedPluginPlatform,
    private readonly version: string, private readonly supported: () => boolean, private readonly locale: () => string) {}

  private async load() {
    const signal = this.shutdown.signal;
    try {
      const directory = await readWidgetDirectory(this.root, signal);
      const images = await Promise.all(directory.widgets.map(async widget => [widget.pluginId, await readPreview(this.root, widget.preview, signal)] as const));
      signal.throwIfAborted();
      this.cached = { directory, images: new Map(images) };
      this.available = true;
    } catch { this.available = false; }
    return this.available ? this.cached?.directory : undefined;
  }

  refresh() { return this.flight ??= this.load().finally(() => { this.flight = undefined; }); }

  selected(directory: WidgetDirectory, pluginId: DistributedWidgetId) {
    return chooseWidgetRelease(directory, pluginId, this.version, this.supported());
  }

  snapshot() {
    const directory = this.cached?.directory;
    const rows = directory?.widgets.map((widget): WidgetDirectoryRow => {
      const { release, reason, minimum } = this.selected(directory, widget.pluginId);
      const installed = this.platform.activeRevision(widget.pluginId);
      const record = this.platform.get(widget.pluginId);
      const installedVersion = installed?.officialWidget && "archiveSha256" in installed.officialWidget ? installed.manifest.version : null;
      const status = !release ? "incompatible" : !installedVersion ? (installed ? "repair" : "install")
        : compareWidgetVersions(release.version, installedVersion) > 0 ? "update"
        : record?.installation.enabled && !record.runtimeReady && release.revisionId === installed?.revisionId ? "repair" : "installed";
      const locale = this.locale() as keyof typeof widget.name;
      return { pluginId: widget.pluginId, name: widget.name[locale] ?? widget.name.en,
        description: widget.description[locale] ?? widget.description.en, preview: this.cached?.images.get(widget.pluginId) ?? null,
        status, installedVersion, version: release?.version ?? null, ...(!release ? { reason, minimum } : {}) };
    }) ?? [];
    return { state: this.available ? "ready" as const : "unavailable" as const, version: directory?.version ?? null, rows };
  }
  current() { return this.available ? this.cached?.directory : undefined; }
  close() { this.shutdown.abort(); }
}
