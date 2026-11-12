/**
 * [INPUT]: Trusted renderer identities, Electron window lifetime, DockService, accepted plugin cards and bounded visible-instance controls.
 * [OUTPUT]: WidgetCatalogOwner with actual Dock projections, real builtin default readings and window-bound presentation leases.
 * [POS]: Main-window catalog adapter; it shares data owners with the Dock and never edits layout or grants source access.
 */
import { BrowserWindow, webContents } from "electron";
import type { DockService } from "../../service";
import type { PluginDockWidgets } from "../plugins/owner";
import type { DockWidget } from '../../../../../shared/system-dock/layout';
import type { DockBarItem, WidgetFace } from '../../../../../shared/system-dock/ipc';
import { taskFace } from '../tasks';
import { maskFace } from '../../projection';
import { pluginDockSurfaceSchema } from "../../../../../shared/system-dock/widgets/plugin";
import { widgetCatalogVisibilitySchema, type WidgetCatalogSnapshot } from "../../../../../shared/system-dock/widgets/catalog";

type Observer = { ids: Set<string>; stop(): void };
export class WidgetCatalogOwner {
  private readonly observers = new Map<number, Observer>();
  private demandKey = "";
  private closed = false;
  private readonly stopSettings: () => void;
  constructor(private readonly service: DockService, private readonly plugins: () => PluginDockWidgets) {
    this.stopSettings = service.onSettings(() => this.reconcile());
  }
  private available() { return !this.closed && this.service.capability.supported && this.service.ports.local.get().enabled; }
  private defaults(): { definitionId: string; id: string; widget: DockWidget; face: WidgetFace }[] {
    const limits = { type: 'builtin.ai-limits' as const, configVersion: 1 as const, standard: 'compact' as const, selectedBackends: this.service.usage.defaultBackends(), selectionByBackend: {} };
    const activity = { type: 'builtin.ai-activity' as const, configVersion: 1 as const, standard: 'compact' as const, source: 'all' as const, period: 'today' as const };
    const tasks = { type: 'builtin.tasks' as const, configVersion: 1 as const, standard: 'compact' as const };
    return [{ definitionId: limits.type, id: 'catalog_preview_limits', widget: limits, face: this.service.usage.limitsFace(limits) },
      ...(this.service.activityAllowed() ? [{ definitionId: activity.type, id: 'catalog_preview_activity', widget: activity, face: this.service.usage.activityFace(activity) }] : []),
      { definitionId: tasks.type, id: 'catalog_preview_tasks', widget: tasks, face: taskFace(this.service.ports.tasks) }];
  }
  snapshot(windowId?: number): WidgetCatalogSnapshot {
    const state = this.service.ports.local.get();
    return { revision: this.service.settingsSnapshot().revision, edge: state.edge, privacyMask: state.privacyMask, officialDirectory: this.service.ports.custom?.officialDirectory,
      liveCards: this.available() ? this.plugins().liveCards(windowId) : [],
      items: this.available() ? this.service.allItems().filter(item => item.kind === "widget") : [],
      defaults: this.available() ? this.defaults().map(value => ({ definitionId: value.definitionId, item: { id: value.id, kind: 'widget', pinned: false, running: false, status: 'ok', iconKey: null, label: '', widget: state.privacyMask ? maskFace(value.face) : value.face } satisfies DockBarItem })) : [] };
  }
  setVisible(raw: unknown, windowId: number) {
    const input = widgetCatalogVisibilitySchema.parse(raw);
    if (!input.itemIds.length) { this.release(windowId); return; }
    const contents = webContents.fromId(windowId), window = contents && BrowserWindow.fromWebContents(contents);
    if (!contents || contents.isDestroyed() || !window || !window.isVisible() || !this.available()) throw new Error("Widget catalog is not visible");
    let observer = this.observers.get(windowId);
    if (!observer) {
      const release = () => this.release(windowId);
      const navigate = (_event: unknown, _url: string, inPlace: boolean, mainFrame: boolean) => { if (mainFrame && !inPlace) release(); };
      observer = { ids: new Set(), stop: () => {
        contents.removeListener("destroyed", release); contents.removeListener("render-process-gone", release);
        contents.removeListener("did-start-navigation", navigate); window.removeListener("hide", release);
      } };
      this.observers.set(windowId, observer);
      contents.once("destroyed", release); contents.on("render-process-gone", release);
      contents.on("did-start-navigation", navigate); window.on("hide", release);
    }
    const allowed = new Set([...this.service.ports.config.layout().items.filter(item => item.kind === "widget").map(item => item.id), ...this.defaults().map(item => item.id)]);
    observer.ids = new Set(input.itemIds.filter(id => allowed.has(id)));
    this.reconcile();
  }
  private owns(windowId: number, itemId: string) {
    return this.available() && !this.service.ports.local.get().privacyMask && Boolean(this.observers.get(windowId)?.ids.has(itemId));
  }
  async surface(raw: unknown, windowId: number) {
    const input = pluginDockSurfaceSchema.parse(raw);
    if (input.kind !== "release" && !this.owns(windowId, input.itemId)) throw new Error("Widget catalog item is not visible in this window");
    const result = await this.plugins().surface(input, windowId, "catalog");
    if (input.kind !== "release" && !this.owns(windowId, input.itemId)) {
      this.plugins().releaseWindow(windowId); throw new Error("Widget catalog closed while opening");
    }
    return result;
  }
  private reconcile() {
    if (!this.available()) { for (const id of [...this.observers.keys()]) this.release(id); }
    const ids = new Set([...this.observers.values()].flatMap(observer => [...observer.ids]));
    const widgets = this.service.ports.config.layout().items.flatMap(item => item.kind === "widget" && ids.has(item.id) ? [{ itemId: item.id, widget: item.widget }] : []);
    widgets.push(...this.defaults().flatMap(item => ids.has(item.id) ? [{ itemId: item.id, widget: item.widget }] : []));
    const key = JSON.stringify([this.service.ports.local.get().privacyMask, widgets]);
    if (key !== this.demandKey) {
      this.demandKey = key;
      this.service.setWidgetDemand("dock-catalog", this.service.ports.local.get().privacyMask ? [] : widgets);
    }
    const order = this.service.ports.config.layout().order;
    for (const [windowId, observer] of this.observers)
      this.plugins().setCatalogWindow(windowId, order.filter(id => observer.ids.has(id)));
  }
  private release(windowId: number) {
    const observer = this.observers.get(windowId);
    if (!observer) return;
    this.observers.delete(windowId); observer.stop(); this.plugins().releaseWindow(windowId); this.reconcile();
  }
  close() { this.closed = true; this.stopSettings(); for (const id of [...this.observers.keys()]) this.release(id); }
}
