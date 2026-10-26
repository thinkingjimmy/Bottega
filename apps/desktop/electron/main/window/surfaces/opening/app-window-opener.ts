/**
 * [INPUT]: Depends on the product registry, residence/migration owners, pending App-window factory and validated window intents.
 * [OUTPUT]: Provides AppWindowOpener with one opening flight per App, existing-window focus and draft-preserving migration rollback.
 * [POS]: window/surfaces/opening creation policy shared by renderer intents and main-owned Dock activation.
 */
import { randomUUID } from "node:crypto";
import { assertAppSurfaceRoute, type OpenSurfaceInWindowInput, type SurfaceIntentResult, type SurfaceKey, type SurfaceResidence } from "../../../../../shared/ipc/settings/window-surfaces-ipc";
import type { SurfaceResidenceLedger } from "../core/surface-residence";
import type { SurfaceMigrationCoordinator } from "../core/surface-migration";
import type { PendingAppWindow } from "../surface-window-controller";
import type { ProductWindowRecord, WindowRegistry } from "../window-registry";

type Ports = {
  registry: WindowRegistry;
  residence: SurfaceResidenceLedger;
  migration: SurfaceMigrationCoordinator;
  pendingLoads: Map<string, () => Promise<void>>;
  assertOpen(appId: string): void;
  create(appId: string, windowId: string, route: string): Promise<PendingAppWindow>;
  track(record: ProductWindowRecord): void;
  close(record: ProductWindowRecord): void;
  chatSurface(chatId: string, incarnationId: string): SurfaceKey;
  publish(residence: SurfaceResidence): void;
};

export class AppWindowOpener {
  private readonly flights = new Map<string, Promise<SurfaceIntentResult>>();
  constructor(private readonly ports: Ports) {}
  open(input: OpenSurfaceInWindowInput): Promise<SurfaceIntentResult> {
    this.ports.assertOpen(input.appId);
    assertAppSurfaceRoute(input.route, input.appId);
    const pending = this.flights.get(input.appId);
    if (pending) return pending;
    const flight = this.perform(input).finally(() => { this.flights.delete(input.appId); });
    this.flights.set(input.appId, flight);
    return flight;
  }
  private async perform(input: OpenSurfaceInWindowInput): Promise<SurfaceIntentResult> {
    const p = this.ports;
    const route = assertAppSurfaceRoute(input.route, input.appId);
    const current = p.residence.get(input.surface);
    const existing = current.windowId ? p.registry.get(current.windowId) : p.registry.app(input.appId);
    if (existing) { p.registry.focus(existing.windowId); return { action: "focused", residence: current }; }
    const main = p.registry.main();
    if (!main) throw new Error("Main window is unavailable");
    const pending = await p.create(input.appId, `app:${input.appId}:${randomUUID()}`, route);
    const target = pending.record;
    p.track(target);
    p.pendingLoads.set(target.windowId, pending.load);
    try {
      p.assertOpen(input.appId);
      const companion = input.useChat ? p.chatSurface(input.useChat.chatId, input.useChat.incarnationId) : null;
      const companionResidence = companion ? p.residence.get(companion) : null;
      if (companionResidence?.windowId) {
        p.close(target); p.registry.focus(companionResidence.windowId);
        return { action: "focused", residence: current };
      }
      const migrated = await p.migration.migrate({
        surface: input.surface, targetRoute: route,
        expectedRevision: input.expectedRevision ?? current.claimRevision,
        sourceWindowId: main.windowId, sourceResidenceWindowId: null,
        targetWindowId: target.windowId, targetResidenceWindowId: target.windowId,
        ...(companionResidence ? { companions: [{ surface: companionResidence.surface, expectedRevision: companionResidence.claimRevision }] } : {}),
        onClaimed: (residences) => { for (const residence of residences) p.publish(residence); },
      });
      target.window.show(); target.window.focus();
      return { action: "migrated", residence: migrated.primary };
    } catch (cause) { p.close(target); throw cause; }
    finally { p.pendingLoads.delete(target.windowId); }
  }
}
