/**
 * [INPUT]: The read-only local directory, selected Widget release, trusted requesting window and current Dock layout.
 * [OUTPUT]: Expiring reviews and idempotent cancellable package installation progress.
 * [POS]: Main-only local distribution coordinator. Browsing never registers a plugin.
 */
import { randomUUID } from "node:crypto";
import { hashCanonical } from "@bottega/contracts/core/canonical-json";
import type { UnifiedPluginPlatform } from "../../../plugins/platform/service";
import type { DockConfigStore } from "../../store/config-store";
import {
  compareWidgetVersions, widgetDirectoryRequestSchema, WIDGET_CATALOG_LIMITS,
  type OfficialWidgetId, type WidgetDirectoryResponse, type WidgetInstallProgress, type WidgetRelease,
} from "../../../../../shared/system-dock/widgets/catalog/distribution";
import { readWidgetAsset } from "./assets";
import { LocalWidgetDirectory } from "./directory";
import { assertCompatibleInstances, installVerifiedWidget, packageWidgetId, pruneOfficialWidgetPackages, verifyOfficialArchive } from "./receive";

type Review = {
  id: string; windowId: number; pluginId: OfficialWidgetId; itemId?: string; expires: number;
  release: WidgetRelease; installedAt: number | null; wasRemoved: boolean; assertWindow(): void; controller: AbortController; progress: WidgetInstallProgress;
  flight?: Promise<WidgetInstallProgress>;
};
type Ports = {
  platform: UnifiedPluginPlatform; config: DockConfigStore; root: string; userData: string; version: string;
  available(): boolean; supported(): boolean; locale(): string;
};
export class OfficialWidgetDistribution {
  private readonly directory: LocalWidgetDirectory;
  private readonly reviews = new Map<string, Review>();
  private readonly writes = new Map<OfficialWidgetId, Promise<unknown>>();
  private closed = false;

  constructor(private readonly ports: Ports) {
    this.directory = new LocalWidgetDirectory(ports.root, ports.platform, ports.version, ports.supported, ports.locale);
  }

  initialize() { return pruneOfficialWidgetPackages(this.ports.platform, this.ports.userData); }

  private assertAvailable() {
    if (this.closed || !this.ports.available()) throw new Error("Official Widget catalog is unavailable");
  }

  private assertItem(review: Pick<Review, "pluginId" | "itemId">) {
    if (!review.itemId) return;
    const item = this.ports.config.layout().items.find(value => value.id === review.itemId);
    if (item?.kind !== "widget" || packageWidgetId(item.widget) !== review.pluginId) throw new Error("Widget instance changed");
  }

  async control(raw: unknown, windowId: number, assertWindow: () => void): Promise<WidgetDirectoryResponse> {
    const request = widgetDirectoryRequestSchema.parse(raw);
    assertWindow();
    if (request.kind === "browse") {
      this.assertAvailable();
      if (!request.cached) await this.directory.refresh();
      this.assertAvailable(); assertWindow();
      return { kind: "browse", directory: this.directory.snapshot() };
    }
    if (request.kind === "review") {
      this.assertAvailable(); this.assertItem(request);
      const directory = await this.directory.refresh();
      this.assertAvailable(); this.assertItem(request); assertWindow();
      const release = directory && this.directory.selected(directory, request.pluginId).release;
      if (!release) throw new Error("No compatible official Widget package is available");
      for (const [id, review] of this.reviews) {
        if (review.expires < Date.now() && !this.writes.has(review.pluginId)) this.reviews.delete(id);
        else if (review.windowId === windowId && review.pluginId === request.pluginId && review.itemId === request.itemId &&
          hashCanonical(review.release) === hashCanonical(release) && !["failed", "cancelled"].includes(review.progress.state)) {
          return { kind: "review", reviewId: id };
        }
      }
      if (this.reviews.size >= 16) {
        const ended = [...this.reviews.values()].find(value => ["failed", "cancelled", "ready"].includes(value.progress.state));
        if (!ended) throw new Error("Widget review capacity reached");
        this.reviews.delete(ended.id);
      }
      const id = randomUUID();
      const installedAt = this.ports.platform.get(request.pluginId)?.installation.installedAt ?? null;
      this.reviews.set(id, {
        id, windowId, pluginId: request.pluginId, itemId: request.itemId, expires: Date.now() + 10 * 60_000, release,
        installedAt, wasRemoved: this.ports.platform.wasOfficialWidgetRemoved(request.pluginId), assertWindow, controller: new AbortController(), progress: { state: "downloading", bytes: 0, total: release.archive.bytes },
      });
      return { kind: "review", reviewId: id };
    }
    if (request.kind === "repair") throw new Error("Widget recovery requires its migration owner");
    const review = this.reviews.get(request.reviewId);
    if (!review || review.windowId !== windowId) throw new Error("Widget review is unavailable");
    if (request.kind === "cancel") review.controller.abort();
    if (request.kind === "accept") review.flight ??= this.serialize(review.pluginId, () => this.install(review));
    if (request.kind === "cancel" && !review.flight) review.progress = { ...review.progress, state: "cancelled" };
    return { kind: "progress", progress: request.kind === "accept" || request.kind === "cancel"
      ? await (review.flight ?? Promise.resolve(review.progress)) : { ...review.progress } };
  }

  private async install(review: Review): Promise<WidgetInstallProgress> {
    const signal = review.controller.signal;
    const assertCurrent = () => {
      signal.throwIfAborted(); this.assertAvailable(); this.assertItem(review); review.assertWindow();
      if (review.expires < Date.now()) throw new Error("Widget installation review expired");
      const directory = this.directory.current();
      const selected = directory && this.directory.selected(directory, review.pluginId).release;
      if (!selected || hashCanonical(selected) !== hashCanonical(review.release)) throw new Error("Widget installation review changed");
    };
    const update = (patch: Partial<WidgetInstallProgress>) => { review.progress = { ...review.progress, ...patch }; };
    let phase: NonNullable<WidgetInstallProgress["error"]> = "download";
    try {
      assertCurrent();
      const installed = this.ports.platform.activeRevision(review.pluginId);
      const state = this.ports.platform.get(review.pluginId);
      if (installed?.officialWidget && (compareWidgetVersions(installed.manifest.version, review.release.version) > 0 ||
          (installed.revisionId === review.release.revisionId && (!state?.installation.enabled || state.runtimeReady)))) {
        update({ state: "ready", bytes: review.release.archive.bytes }); return review.progress;
      }
      if (installed?.officialWidget && installed.manifest.version === review.release.version &&
          installed.revisionId !== review.release.revisionId) throw new Error("A published Widget version changed identity");
      const bytes = await readWidgetAsset(this.ports.root, review.release.archive.url, WIDGET_CATALOG_LIMITS.archive, signal, bytes => update({ bytes }));
      assertCurrent(); phase = "verification"; update({ state: "verifying" });
      const verified = verifyOfficialArchive(bytes, review.pluginId, review.release);
      const compatible = () => {
        assertCurrent();
        assertCompatibleInstances(verified, this.ports.config.layout().items.flatMap(value => value.kind === "widget" ? [value.widget] : []));
      };
      compatible(); phase = "install"; update({ state: "installing" });
      await installVerifiedWidget({ ...this.ports, verified, archiveSha256: review.release.archive.sha256, options: {
        signal, assertCurrent: compatible, priorInstallation: { installedAt: review.installedAt, removed: review.wasRemoved },
      } });
      update({ state: "ready", bytes: bytes.length });
    } catch (error) {
      if (!signal.aborted) console.warn("[official-widgets] install failed", error);
      update(signal.aborted ? { state: "cancelled" } : { state: "failed", error: phase });
    }
    return review.progress;
  }

  serialize<T>(id: OfficialWidgetId, run: () => Promise<T>) {
    const task = (this.writes.get(id) ?? Promise.resolve()).catch(() => undefined).then(run);
    this.writes.set(id, task);
    void task.finally(() => { if (this.writes.get(id) === task) this.writes.delete(id); }).catch(() => undefined);
    return task;
  }

  async close() {
    this.closed = true;
    this.directory.close();
    for (const review of this.reviews.values()) review.controller.abort();
    await Promise.allSettled(this.writes.values());
    this.reviews.clear();
  }
}
