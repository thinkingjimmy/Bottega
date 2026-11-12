/**
 * [INPUT]: The first local Dock layout, initialized unified plugin store and build-bound recovery archives.
 * [OUTPUT]: Persisted pre-sync instance IDs and retryable offline migration to the fixed official revisions.
 * [POS]: Local development upgrade owner. Layout and synchronization remain independent from package installation.
 */
import { join } from "node:path";
import { z } from "zod";
import { DurableJson } from "../../../persistence/durable-json";
import type { UnifiedPluginPlatform } from "../../../plugins/platform/service";
import { OFFICIAL_WIDGETS, WIDGET_CATALOG_LIMITS, officialWidgetId, type OfficialWidgetId } from "../../../../../shared/system-dock/widgets/catalog/distribution";
import type { DockConfigStore } from "../../store/config-store";
import type { OfficialWidgetDistribution } from "./owner";
import { readWidgetAsset } from "./assets";
import { readWidgetDirectory } from "./directory";
import { installVerifiedWidget, packageWidgetId, verifyOfficialArchive } from "./receive";

const captureSchema = z.object({
  version: z.literal(1),
  instances: z.record(officialWidgetId, z.array(z.string()).max(100)).nullable(),
}).strict();

export class OfficialWidgetMigration {
  private readonly file: DurableJson<z.infer<typeof captureSchema>>;
  private readonly stop = new AbortController();
  private opened = false;
  constructor(private readonly ports: {
    root: string; userData: string; platform: UnifiedPluginPlatform; config: DockConfigStore;
    distribution: OfficialWidgetDistribution;
  }) {
    this.file = new DurableJson(join(ports.userData, "dock-official-widget-migration.json"), captureSchema, () => ({ version: 1, instances: null }));
  }

  async capture() {
    await this.file.initialize();
    this.opened = true;
    await this.file.mutate(state => {
      this.stop.signal.throwIfAborted();
      if (state.instances !== null) return;
      const instances: Record<OfficialWidgetId, string[]> = { "bottega-weather": [], "bottega-ai-usage": [] };
      for (const item of this.ports.config.layout().items) {
        const id = item.kind === "widget" && packageWidgetId(item.widget);
        if (id) instances[id].push(item.id);
      }
      state.instances = instances;
    });
  }

  needs(id: OfficialWidgetId) {
    const { platform, config } = this.ports;
    const active = platform.activeRevision(id), record = platform.get(id);
    if (!this.opened || active?.officialWidget || platform.wasOfficialWidgetRemoved(id)) return false;
    if (id === "bottega-weather" && record?.installation.origin === "official" && record.manifest.version === "1.0.0") return true;
    const captured = this.file.read(state => state.instances?.[id] ?? []);
    return config.layout().items.some(item => item.kind === "widget" && captured.includes(item.id) && packageWidgetId(item.widget) === id);
  }

  retry(id: OfficialWidgetId, assertWindow = () => {}) {
    return this.ports.distribution.serialize(id, async () => {
      if (!this.needs(id)) return false;
      const { root, platform, config } = this.ports, signal = this.stop.signal;
      const legacyWeather = id === "bottega-weather" && platform.get(id)?.installation.origin === "official";
      const captured = this.file.read(state => state.instances?.[id] ?? []);
      signal.throwIfAborted(); assertWindow();
      const directory = await readWidgetDirectory(root, signal);
      const release = directory.packages.find(value => value.pluginId === id)?.releases.find(value =>
        value.version === OFFICIAL_WIDGETS[id].recoveryVersion && value.target.platform === "darwin" && value.target.arch === "arm64");
      if (!release) throw new Error("Bundled Widget recovery package is missing");
      const assertCurrent = () => {
        signal.throwIfAborted(); assertWindow();
        const active = platform.activeRevision(id);
        if (platform.wasOfficialWidgetRemoved(id) || (active?.officialWidget && active.revisionId !== release.revisionId) ||
            (!legacyWeather && !config.layout().items.some(item => item.kind === "widget" &&
              captured.includes(item.id) && packageWidgetId(item.widget) === id))) throw new Error("Widget migration scope changed");
      };
      assertCurrent();
      const bytes = await readWidgetAsset(root, release.archive.url, WIDGET_CATALOG_LIMITS.archive, signal);
      const verified = verifyOfficialArchive(bytes, id, release);
      assertCurrent();
      await installVerifiedWidget({ ...this.ports, verified, archiveSha256: release.archive.sha256, options: { signal, assertCurrent, migration: true } });
      return true;
    });
  }

  start() {
    for (const id of officialWidgetId.options) void this.retry(id).catch(error => {
      if (!this.stop.signal.aborted) console.warn("[official-widgets] local migration pending", error);
    });
  }
  stopRequests() { this.stop.abort(); }
  async close() { if (this.opened) await this.file.closeAndFlush(); }
}
