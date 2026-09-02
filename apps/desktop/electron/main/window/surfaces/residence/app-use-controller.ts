/**
 * [INPUT]: Depends on the SurfaceResidence ledger, WindowRegistry, durable App Use switch fences, exact chat surfaces, and injected migration/publication ports
 * [OUTPUT]: Provides App Use residence fence capture/assertion, source revoke, target claim, and return-to-main focus orchestration
 * [POS]: App Use surface residence owner; SurfaceWindowController delegates the residence saga while retaining generic window migration mechanics
 */

import {
  WINDOW_SURFACES_CHANNEL,
  appStudioSurface,
  type SurfaceMigrationCommand,
  type SurfaceKey,
  type SurfaceResidence,
} from "../../../../../shared/window-surfaces-ipc";
import {
  productDestinationRoute,
  type AppChatSlot,
  type AppUseChatDestination,
  type AppUseSurfaceFence,
  type AppUseSwitchIntent,
} from "../../../../../shared/placement/facts";
import type { SurfaceResidenceLedger } from "../core/surface-residence";
import type {
  ProductWindowRecord,
  WindowRegistry,
} from "../window-registry";
import type { TrustedRendererContext } from "../trusted-renderer-context";
import { parseAppId } from "../policy/surface-input";

type Ports = Readonly<{
  chatSurface: (chatId: unknown, incarnationId: unknown) => SurfaceKey;
  bindConversation: (chatId: string, windowId: string | null) => void;
  publish: (residence: SurfaceResidence) => void;
  migrateToMain: (
    source: ProductWindowRecord,
    surface: SurfaceKey,
    route: string,
    expectedRevision: number,
    companions: readonly SurfaceResidence[]
  ) => Promise<unknown>;
  closeSource: (source: ProductWindowRecord) => void;
  assertAdmission: () => void;
  assertStudio: (context: TrustedRendererContext, appId: string) => void;
  isMigrating: (surface: SurfaceKey) => boolean;
  canClaim: (
    context: TrustedRendererContext,
    appId: string,
    chat: { chatId?: unknown; incarnationId?: unknown } | undefined,
    residence: SurfaceResidence
  ) => boolean;
}>;

export class AppUseResidenceController {
  constructor(
    private readonly residence: SurfaceResidenceLedger,
    private readonly registry: WindowRegistry,
    private readonly ports: Ports
  ) {}

  capture(
    appId: string,
    source: AppChatSlot | null,
    target: AppChatSlot
  ): AppUseSurfaceFence {
    return {
      expectedSourceSurfaceRevision: source
        ? this.chatResidence(source).claimRevision
        : 0,
      expectedTargetSurfaceRevision: this.chatResidence(target).claimRevision,
      expectedStudioSurfaceRevision: this.residence.get(
        appStudioSurface(appId)
      ).claimRevision,
    };
  }

  assertFence(intent: AppUseSwitchIntent) {
    this.assertExpected(
      intent.source ? this.chatResidence(intent.source).claimRevision : 0,
      intent.expectedSourceSurfaceRevision
    );
    this.assertExpected(
      this.chatResidence(intent.target).claimRevision,
      intent.expectedTargetSurfaceRevision
    );
    this.assertExpected(
      this.residence.get(appStudioSurface(intent.appId)).claimRevision,
      intent.expectedStudioSurfaceRevision
    );
  }

  revoke(intent: AppUseSwitchIntent) {
    if (!intent.source) return;
    const surface = this.ports.chatSurface(
      intent.source.id,
      intent.source.incarnationId
    );
    const current = this.residence.get(surface);
    if (current.windowId === null) {
      this.assertExpected(
        current.claimRevision,
        intent.expectedSourceSurfaceRevision,
        true
      );
      return;
    }
    this.assertExpected(
      current.claimRevision,
      intent.expectedSourceSurfaceRevision
    );
    const changed = this.residence.move({
      surface,
      expectedRevision: intent.expectedSourceSurfaceRevision,
      windowId: null,
    });
    this.ports.bindConversation(intent.source.id, null);
    this.ports.publish(changed);
  }

  claim(intent: AppUseSwitchIntent) {
    const target = this.ports.chatSurface(
      intent.target.id,
      intent.target.incarnationId
    );
    const current = this.residence.get(target);
    const studio = this.residence.get(appStudioSurface(intent.appId));
    this.assertExpected(
      studio.claimRevision,
      intent.expectedStudioSurfaceRevision
    );
    if (current.windowId === studio.windowId) {
      this.assertExpected(
        current.claimRevision,
        intent.expectedTargetSurfaceRevision,
        true
      );
      return;
    }
    this.assertExpected(
      current.claimRevision,
      intent.expectedTargetSurfaceRevision
    );
    const changed = this.residence.move({
      surface: target,
      expectedRevision: intent.expectedTargetSurfaceRevision,
      windowId: studio.windowId,
    });
    this.ports.bindConversation(intent.target.id, studio.windowId);
    this.ports.publish(changed);
  }

  async focusInMain(
    destination: AppUseChatDestination,
    intent?: AppUseSwitchIntent
  ) {
    const studioSurface = appStudioSurface(destination.appId);
    const studio = this.residence.get(studioSurface);
    if (intent) this.assertFocusIntent(destination, intent, studio);
    const route = productDestinationRoute(destination);
    const main = this.registry.main();
    if (!main) throw new Error("Main window is unavailable");
    if (studio.windowId === null) {
      main.window.webContents.send(WINDOW_SURFACES_CHANNEL.command, {
        type: "navigate",
        route,
      } satisfies SurfaceMigrationCommand);
      this.registry.focus(main.windowId);
      return;
    }
    const source = this.registry.get(studio.windowId);
    if (!source) throw new Error("App surface owner is unavailable");
    await this.ports.migrateToMain(
      source,
      studioSurface,
      route,
      studio.claimRevision,
      this.residence
        .ownedBy(source.windowId)
        .filter((claim) => claim.surface !== studioSurface)
    );
    this.ports.closeSource(source);
  }

  sync(context: TrustedRendererContext, rawInput: unknown) {
    this.ports.assertAdmission();
    const input = rawInput as {
      appId?: unknown;
      previous?: { chatId?: unknown; incarnationId?: unknown };
      next?: { chatId?: unknown; incarnationId?: unknown };
    } | null;
    const appId = parseAppId(input?.appId);
    this.ports.assertStudio(context, appId);
    const previous = input?.previous
      ? this.ports.chatSurface(
          input.previous.chatId,
          input.previous.incarnationId
        )
      : null;
    const next = input?.next
      ? this.ports.chatSurface(
          input.next.chatId,
          input.next.incarnationId
        )
      : null;
    for (const surface of [appStudioSurface(appId), previous, next]) {
      if (surface && this.ports.isMigrating(surface)) {
        throw new Error("Surface migration in progress; use-chat sync rejected");
      }
    }
    if (previous === next) return next ? this.residence.get(next) : null;
    if (previous && !this.isResident(context, this.residence.get(previous))) {
      throw new Error("Window intent rejected for a surface resident elsewhere");
    }
    const nextResidence = next ? this.residence.get(next) : null;
    if (
      nextResidence &&
      !this.ports.canClaim(context, appId, input?.next, nextResidence)
    ) {
      if (nextResidence.windowId) this.registry.focus(nextResidence.windowId);
      throw new Error("Use chat is resident in another window");
    }
    const targetWindowId = context.role === "main" ? null : context.windowId;
    const moves = [
      ...(previous
        ? [
            {
              surface: previous,
              expectedRevision: this.residence.get(previous).claimRevision,
              windowId: null,
            },
          ]
        : []),
      ...(next && nextResidence?.windowId !== targetWindowId
        ? [
            {
              surface: next,
              expectedRevision: nextResidence!.claimRevision,
              windowId: targetWindowId,
            },
          ]
        : []),
    ];
    if (!moves.length) return null;
    const changed = this.residence.moveMany(moves);
    if (previous) {
      this.ports.bindConversation(input!.previous!.chatId as string, null);
    }
    if (next) {
      this.ports.bindConversation(
        input!.next!.chatId as string,
        targetWindowId
      );
    }
    for (const residence of changed) this.ports.publish(residence);
    return next ? this.residence.get(next) : null;
  }

  private chatResidence(slot: AppChatSlot) {
    return this.residence.get(
      this.ports.chatSurface(slot.id, slot.incarnationId)
    );
  }

  private assertFocusIntent(
    destination: AppUseChatDestination,
    intent: AppUseSwitchIntent,
    studio: SurfaceResidence
  ) {
    if (
      intent.appId !== destination.appId ||
      intent.target.id !== destination.chatId ||
      intent.target.incarnationId !== destination.incarnationId
    ) {
      throw new Error("App Use focus destination does not match switch intent");
    }
    this.assertExpected(
      studio.claimRevision,
      intent.expectedStudioSurfaceRevision,
      studio.windowId === null
    );
  }

  private assertExpected(
    actual: number,
    expected: number,
    allowCompletedEffect = false
  ) {
    if (actual === expected) return;
    if (allowCompletedEffect && actual === expected + 1) return;
    throw new Error("APP_USE_SURFACE_FENCE_STALE");
  }

  private isResident(
    context: TrustedRendererContext,
    residence: SurfaceResidence
  ) {
    return residence.windowId === null
      ? context.role === "main"
      : residence.windowId === context.windowId;
  }
}
