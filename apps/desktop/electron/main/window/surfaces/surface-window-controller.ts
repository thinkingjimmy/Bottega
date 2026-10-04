/**
 * [INPUT]: Depends on process-global renderer IPC, trusted WindowRegistry identities, exact App Studio route helpers, residence/migration state machines, durable App Use switch fences, canonical/durable-draft App-chat identity, and main-owned attachment/capability cleanup ports
 * [OUTPUT]: Provides surfaceWindowController for navigation-generation-fenced show, create/focus/reclaim/use-chat sync (a new App window loads only after its move has made it resident), assertStudioRead for App-window reads, exact App-window chat projections, capsule transfer with its image side channel, crash cleanup, a listener-ready, incarnation-bound pre-quit draft flush of every window, and quit reconciliation Guards App focus/open and closes its window through draft-preserving migration.
 * Broadcasts resume-drafts when quit is cancelled so every renderer can edit again.
 * [POS]: Window-surfaces policy root; quit stops before reclamation when a window has not confirmed its drafts, naming that window for recovery.
 */

import { MigrationReplies } from "./core/migration-replies";
import { settleWindowDrafts } from "./core/draft-settlement";
import { MigrationImageCustody } from "./core/migration-images";
import { randomUUID } from "node:crypto";
import {
  WINDOW_SURFACES_CHANNEL,
  appIdFromStudioSurface,
  appStudioSurface,
  assertAppSurfaceRoute,
  canonicalAppSurfaceRoute,
  chatSurface,
  type OpenSurfaceInWindowInput,
  type ReclaimSurfaceInput,
  type ShowSurfaceInput,
  type SurfaceCapsuleV1,
  type SurfaceIntentResult,
  type SurfaceKey,
  type SurfaceMigrationCommand,
  type SurfaceMigrationReply,
  type SurfaceResidence,
} from "../../../../shared/ipc/settings/window-surfaces-ipc";
import { rendererIpc } from "../../registration/ipc-registrar";
import type { TrustedRendererContext } from "./trusted-renderer-context";
import { SurfaceMigrationCoordinator } from "./core/surface-migration";
import { SurfaceResidenceLedger } from "./core/surface-residence";
import {
  appIdForActiveUseChat as resolveActiveUseChatAppId,
  appWindowUseChat as resolveAppWindowUseChat,
  assertAppConversationRead as assertScopedConversationRead,
} from "./policy/app-window-chat-scope";
import {
  assertConversationMutationScope,
  bindConversationScope,
} from "./policy/conversation-scope";
import type {
  AppChatSlot,
  AppUseChatDestination,
  AppUseSurfaceFence,
  AppUseSwitchIntent,
} from "../../../../shared/placement/facts";
import {
  type ProductWindowRecord,
  type WindowRegistry,
  type WindowRegistryEvent,
  windowRegistry,
} from "./window-registry";
import { AppUseResidenceController } from "./residence/app-use-controller";
import {
  openSurfaceInput,
  parseAppId,
  parseChatPart,
  reclaimSurfaceInput,
  showSurfaceInput,
} from "./policy/surface-input";
import { SurfaceNavigationIntents } from "./policy/surface-navigation-intents";

/** A created App window that has not loaded its route yet: it loads only once the move has made it resident. */
export type PendingAppWindow = Readonly<{ record: ProductWindowRecord; load(): Promise<void> }>;
type AppWindowFactory = (appId: string, windowId: string, route: string) => Promise<PendingAppWindow>;

type ChatSurfaceIdentity = Readonly<{ incarnationId: string | null; appId: string | null; appRole: "edit" | "use" | null }>;

export class SurfaceWindowController {
  readonly residence = new SurfaceResidenceLedger();
  private readonly replies: MigrationReplies;
  private readonly intentionalClose = new Set<string>();
  private readonly crashHandled = new Set<string>();
  private readonly transferredAttachments = new Set<string>();
  private readonly images = new MigrationImageCustody();
  private readonly conversationOwners = new Map<string, string | null>();
  private readonly migration: SurfaceMigrationCoordinator;
  private readonly appUseResidence: AppUseResidenceController;
  private readonly navigationIntents = new SurfaceNavigationIntents();
  private createAppWindow: AppWindowFactory | null = null;
  /** New App windows waiting for their move's claim before loading (a renderer that loads earlier queries while still nonresident). */
  private readonly pendingLoads = new Map<string, () => Promise<void>>();
  private resolveChatIdentity: ((chatId: string) => ChatSurfaceIdentity | undefined) | null = null;
  private resolveActiveUseChat: ((appId: string) => string | undefined) | null = null;
  private rebindAttachmentRefs: ((
    refs: readonly string[],
    sourceWindowId: string,
    targetWindowId: string,
    chatId: string
  ) => void) | null = null;
  private releaseWindowResources: ((windowId: string) => void) | null = null;
  private admissionOpen = true;
  private closePolicy: ((record: ProductWindowRecord) => boolean) | null = null;
  private ensureMain: (() => Promise<ProductWindowRecord>) | null = null;
  private closeFailure: ((record: ProductWindowRecord) => void) | null = null;
  configurePresence(input: { beforeAppClose(record: ProductWindowRecord): boolean;
    ensureMain(): Promise<ProductWindowRecord>; closeFailure(record: ProductWindowRecord): void }) {
    this.closePolicy = input.beforeAppClose; this.ensureMain = input.ensureMain; this.closeFailure = input.closeFailure;
  }


  constructor(private readonly registry: WindowRegistry = windowRegistry) {
    this.replies = new MigrationReplies(registry);
    this.migration = new SurfaceMigrationCoordinator(this.residence, {
      exportCapsule: (windowId, transactionId, surface) =>
        this.exportCapsule(windowId, transactionId, surface),
      commitSource: (windowId, transactionId, capsule) =>
        this.request(windowId, { type: "commit", transactionId, capsule }, "committed")
          .then(() => undefined).finally(() => { this.transferredAttachments.delete(transactionId); this.images.drop(transactionId); }),
      hydrate: async (windowId, sourceWindowId, transactionId, capsule, mode = "present") => {
        // The claim has moved residence to this window: only now may its renderer load and start reading.
        const load = this.pendingLoads.get(windowId);
        if (load) { this.pendingLoads.delete(windowId); await load(); }
        const prepared = await this.request(windowId, { type: "prepare-hydrate", transactionId, capsule }, "prepared");
        if (!Number.isSafeInteger(prepared.composerRevision) || prepared.composerRevision! < 0) throw new Error("COMPOSER_REVISION_INVALID");
        await this.request(sourceWindowId, { type: "validate-export", transactionId, capsule }, "validated");
        if (this.transferAttachmentRefs(capsule, sourceWindowId, windowId)) {
          this.transferredAttachments.add(transactionId);
        }
        await this.request(windowId, {
          type: "hydrate", transactionId, capsule, mode, expectedComposerRevision: prepared.composerRevision,
          images: this.images.forward(transactionId),
        }, "hydrated");
      },
      abortExport: async (windowId, transactionId) => {
        this.images.drop(transactionId);
        await this.request(windowId, { type: "abort-export", transactionId }, "restored");
      },
      restore: async (windowId, failedTargetWindowId, transactionId, capsule) => {
        this.images.drop(transactionId);
        let rebindFailure: unknown;
        if (this.transferredAttachments.delete(transactionId)) {
          try {
            this.transferAttachmentRefs(capsule, failedTargetWindowId, windowId);
          } catch (cause) {
            rebindFailure = cause;
          }
        }
        await this.request(windowId, {
          type: "restore", transactionId, capsule,
        }, "restored");
        if (rebindFailure) throw rebindFailure;
      },
    });
    this.appUseResidence = new AppUseResidenceController(
      this.residence,
      registry,
      {
        chatSurface: (chatId, incarnationId) =>
          this.validatedChatSurface(chatId, incarnationId),
        bindConversation: (chatId, windowId) =>
          this.conversationOwners.set(chatId, windowId),
        publish: (residence) => this.publishResidence(residence, "intent"),
        migrateToMain: (source, surface, route, expectedRevision, companions) =>
          this.migrateToMain(
            source,
            surface,
            route,
            expectedRevision,
            "intent",
            companions
          ),
        closeSource: (source) => this.closeNow(source),
        assertAdmission: () => this.assertAdmission(),
        assertStudio: (context, appId) =>
          this.assertAppStudioMutation(context, appId),
        isMigrating: (surface) => this.migration.isMigrating(surface),
        canClaim: (context, appId, chat, residence) =>
          this.canClaimUseChat(context, appId, chat, residence),
      }
    );
    registry.subscribe((event) => this.onRegistryEvent(event));
  }

  private assertAppEnabled: (appId: string) => void = () => {};
  configureAppAvailability(assertEnabled: (appId: string) => void) { this.assertAppEnabled = assertEnabled; }
  async closeApp(appId: string) {
    const record = this.registry.app(appId);
    if (record) await this.reclaimOwnedWindow(record, "close", true);
  }
  configure(
    rendererUrl: string,
    createAppWindow: AppWindowFactory,
    resolveChatIdentity: (chatId: string) => ChatSurfaceIdentity | undefined,
    resolveActiveUseChat: (appId: string) => string | undefined,
    rebindAttachmentRefs: (
      refs: readonly string[],
      sourceWindowId: string,
      targetWindowId: string,
      chatId: string
    ) => void,
    releaseWindowResources: (windowId: string) => void
  ) {
    this.createAppWindow = createAppWindow;
    this.resolveChatIdentity = resolveChatIdentity;
    this.resolveActiveUseChat = resolveActiveUseChat;
    this.rebindAttachmentRefs = rebindAttachmentRefs;
    this.releaseWindowResources = releaseWindowResources;
    rendererIpc(rendererUrl, "Rejected untrusted window surface request")
      .roles("main", "app-window")
      .handleWithContext(WINDOW_SURFACES_CHANNEL.residence, (_context, rawSurface) =>
        this.residence.get(rawSurface)
      )
      .handleWithContext(WINDOW_SURFACES_CHANNEL.navigationIntent, (context, raw) =>
        this.navigationIntents.accept(context.windowId, raw)
      )
      .handleWithContext(WINDOW_SURFACES_CHANNEL.show, (context, rawInput) =>
        this.show(context, showSurfaceInput(rawInput))
      )
      .handleWithContext(WINDOW_SURFACES_CHANNEL.openInWindow, (context, rawInput) =>
        this.openInWindow(context, openSurfaceInput(rawInput))
      )
      .handleWithContext(WINDOW_SURFACES_CHANNEL.reclaim, (context, rawInput) =>
        this.reclaim(context, reclaimSurfaceInput(rawInput))
      )
      .handleWithContext(WINDOW_SURFACES_CHANNEL.syncUseChat, (context, rawInput) =>
        this.syncUseChat(context, rawInput)
      )
      .onWithContext(WINDOW_SURFACES_CHANNEL.commandReady, (context) =>
        this.replies.ready(context)
      )
      .onWithContext(WINDOW_SURFACES_CHANNEL.migrationReply, (context, rawReply) =>
        this.acceptReply(context, rawReply)
      );
  }

  trackAppWindow(record: ProductWindowRecord) {
    record.window.on("close", (...args) => {
      if (this.intentionalClose.has(record.windowId)) return;
      const event = args[0] as { preventDefault?(): void } | undefined;
      event?.preventDefault?.();
      if (this.closePolicy?.(record)) return;
      void this.reclaimOwnedWindow(record, "close").catch((cause) => {
        /* 迁移失败不许留下一扇关不掉的窗：降级为 crash 语义收回并明示丢草稿。 */
        console.error("[window-surfaces] normal close migration failed", cause);
        this.registry.focus(record.windowId);
        this.closeFailure?.(record);
      });
    });
  }

  stopAdmission() {
    this.admissionOpen = false;
  }

  reopenAdmission() {
    this.admissionOpen = true;
    this.resumeDrafts();
  }

  resumeDrafts() {
    for (const record of this.registry.list()) {
      record.window.webContents.send(WINDOW_SURFACES_CHANNEL.command, { type: "resume-drafts" } satisfies SurfaceMigrationCommand);
    }
  }

  bindConversation(context: TrustedRendererContext, conversationId: string) {
    bindConversationScope(context, conversationId, this.conversationScopePorts());
  }

  assertConversationMutation(
    context: TrustedRendererContext,
    conversationId: string
  ) {
    assertConversationMutationScope(
      context,
      conversationId,
      this.conversationScopePorts()
    );
  }

  private conversationScopePorts() {
    return {
      identity: (chatId: string) => this.resolveChatIdentity?.(chatId),
      residence: (surface: SurfaceKey) => this.residence.get(surface),
      isResident: (current: TrustedRendererContext, residence: SurfaceResidence) =>
        this.isResident(current, residence),
      claimDraft: (current: TrustedRendererContext, chatId: string, identity: ChatSurfaceIdentity | undefined) =>
        this.claimDraftConversation(current, chatId, identity),
      bindOwner: (chatId: string, windowId: string | null) =>
        this.conversationOwners.set(chatId, windowId),
    };
  }

  appWindowUseChat(context: TrustedRendererContext) {
    return resolveAppWindowUseChat(context, {
      assertStudio: (current, appId) => this.assertAppStudioMutation(current, appId),
      activeUseChat: (appId) => this.resolveActiveUseChat?.(appId),
      chatIdentity: (chatId) => this.resolveChatIdentity?.(chatId),
    });
  }

  assertAppConversationRead(
    context: TrustedRendererContext,
    conversationId: string
  ) {
    assertScopedConversationRead(context, conversationId, this.appWindowUseChat(context));
  }

  appIdForActiveUseChat(conversationId: string) {
    const appIds = this.registry.list("app-window").flatMap(
      (record) => record.appId ? [record.appId] : []
    );
    return resolveActiveUseChatAppId(
      conversationId,
      appIds,
      (appId) => this.resolveActiveUseChat?.(appId)
    );
  }

  captureAppUseSurfaceFence(
    appId: string,
    source: AppChatSlot | null,
    target: AppChatSlot
  ): AppUseSurfaceFence {
    return this.appUseResidence.capture(appId, source, target);
  }

  assertAppUseSurfaceFence(intent: AppUseSwitchIntent) {
    this.appUseResidence.assertFence(intent);
  }

  revokeAppUseChat(intent: AppUseSwitchIntent) {
    this.appUseResidence.revoke(intent);
  }

  claimAppUseChat(intent: AppUseSwitchIntent) {
    this.appUseResidence.claim(intent);
  }

  async focusAppUseInMain(
    destination: AppUseChatDestination,
    intent?: AppUseSwitchIntent
  ) {
    return this.appUseResidence.focusInMain(destination, intent);
  }

  assertAppStudioMutation(context: TrustedRendererContext, appId: string) {
    if (context.role === "app-window" && context.appId !== appId) {
      throw new Error("App window identity does not match the requested Studio");
    }
    const residence = this.residence.get(appStudioSurface(appId));
    if (!this.isResident(context, residence)) {
      throw new Error("App Studio mutation rejected from nonresident window");
    }
  }

  /** A read an App window may make for its own Studio (main always may): the window must hold that Studio right now. */
  assertStudioRead(context: TrustedRendererContext) {
    if (context.role === "main") return;
    if (!context.appId) throw new Error("App window identity is missing");
    this.assertAppStudioMutation(context, context.appId);
  }

  assertSurfaceResidence(input: Readonly<{
    windowId: string;
    appId: string;
    conversationId?: string;
    conversationIncarnationId?: string;
  }>) {
    this.assertWindowOwns(input.windowId, appStudioSurface(input.appId));
    const hasConversation =
      input.conversationId !== undefined ||
      input.conversationIncarnationId !== undefined;
    if (!hasConversation) return;
    if (!input.conversationId || !input.conversationIncarnationId) {
      throw new Error("Incomplete conversation surface identity");
    }
    this.assertWindowOwns(
      input.windowId,
      chatSurface(input.conversationId, input.conversationIncarnationId)
    );
  }

  assertConversationSurfaceResidence(input: Readonly<{
    windowId: string;
    conversationId: string;
    conversationIncarnationId: string;
  }>) {
    this.assertWindowOwns(
      input.windowId,
      chatSurface(input.conversationId, input.conversationIncarnationId)
    );
  }

  async settleAll() {
    this.stopAdmission();
    await this.migration.drain();
    await settleWindowDrafts(this.registry.list(), windowId =>
      this.request(windowId, { type: "flush-drafts", transactionId: randomUUID() }, "flushed"));
    for (const record of this.registry.list("app-window")) {
      await this.reclaimOwnedWindow(record, "quit");
    }
  }

  private async show(
    context: TrustedRendererContext,
    input: ShowSurfaceInput
  ): Promise<SurfaceIntentResult> {
    this.assertAdmission();
    this.navigationIntents.assertCurrent(context.windowId, input.navigationIntentId);
    const appId = this.appIdForStudio(input.surface);
    this.assertAppEnabled(appId);
    const route = assertAppSurfaceRoute(input.route, appId);
    /* App 窗只许 show 自己的 Studio：否则任意 App 窗可对别窗强制导航并抢焦点。 */
    if (context.role !== "main" && context.appId !== appId) {
      throw new Error("Window intent App identity mismatch");
    }
    const current = this.residence.get(input.surface);
    if (this.isResident(context, current)) {
      context.window.webContents.send(WINDOW_SURFACES_CHANNEL.command, {
        type: "navigate",
        route,
      } satisfies SurfaceMigrationCommand);
      return { action: "shown", residence: current };
    }
    const owner = current.windowId
      ? this.registry.get(current.windowId)
      : this.registry.main();
    if (!owner) throw new Error("Surface owner window is unavailable");
    owner.window.webContents.send(WINDOW_SURFACES_CHANNEL.command, {
      type: "navigate",
      route,
    } satisfies SurfaceMigrationCommand);
    this.registry.focus(owner.windowId);
    return { action: "focused", residence: current };
  }

  private async openInWindow(
    context: TrustedRendererContext,
    input: OpenSurfaceInWindowInput
  ): Promise<SurfaceIntentResult> {
    this.assertAdmission();
    this.assertStudioIntent(context, input.appId, input.surface);
    const route = assertAppSurfaceRoute(input.route, input.appId);
    const current = this.residence.get(input.surface);
    if (current.windowId) {
      this.registry.focus(current.windowId);
      return { action: "focused", residence: current };
    }
    const existing = this.registry.app(input.appId);
    if (existing) {
      this.registry.focus(existing.windowId);
      return { action: "focused", residence: current };
    }
    const create = this.createAppWindow;
    if (!create) throw new Error("App window factory is unavailable");
    const main = this.registry.main();
    if (!main) throw new Error("Main window is unavailable");
    const windowId = `app:${input.appId}:${randomUUID()}`;
    const pending = await create(input.appId, windowId, route);
    const target = pending.record;
    this.trackAppWindow(target);
    this.pendingLoads.set(target.windowId, pending.load);
    try {
      const companion = input.useChat
        ? this.validatedChatSurface(input.useChat.chatId, input.useChat.incarnationId)
        : null;
      const companionResidence = companion ? this.residence.get(companion) : null;
      if (companionResidence?.windowId) {
        this.closeNow(target);
        this.registry.focus(companionResidence.windowId);
        return { action: "focused", residence: current };
      }
      const migrated = await this.migration.migrate({
        surface: input.surface,
        targetRoute: route,
        expectedRevision: input.expectedRevision ?? current.claimRevision,
        sourceWindowId: main.windowId,
        sourceResidenceWindowId: null,
        targetWindowId: target.windowId,
        targetResidenceWindowId: target.windowId,
        ...(companionResidence
          ? {
              companions: [{
                surface: companionResidence.surface,
                expectedRevision: companionResidence.claimRevision,
              }],
            }
          : {}),
        onClaimed: (residences) => { for (const residence of residences) this.publishResidence(residence, "intent"); },
      });
      target.window.show();
      target.window.focus();
      return { action: "migrated", residence: migrated.primary };
    } catch (cause) {
      this.closeNow(target);
      throw cause;
    } finally {
      this.pendingLoads.delete(target.windowId);
    }
  }

  private async reclaim(
    context: TrustedRendererContext,
    input: ReclaimSurfaceInput
  ): Promise<SurfaceIntentResult> {
    const appId = this.appIdForStudio(input.surface);
    const route = assertAppSurfaceRoute(input.route, appId);
    const current = this.residence.get(input.surface);
    this.assertStudioIntent(context, appId, input.surface, current);
    const main = this.registry.main();
    if (!main) throw new Error("Main window is unavailable");
    if (!current.windowId) {
      this.registry.focus(main.windowId);
      return { action: "focused", residence: current };
    }
    const source = this.registry.get(current.windowId);
    if (!source) {
      const residence = this.residence.move({
        surface: input.surface,
        expectedRevision: input.expectedRevision ?? current.claimRevision,
        windowId: null,
      });
      this.publishResidence(residence, "crash", true);
      return { action: "migrated", residence };
    }
    const companions = this.residence
      .ownedBy(source.windowId)
      .filter((claim) => claim.surface !== input.surface);
    const residence = await this.migrateToMain(
      source,
      input.surface,
      route,
      input.expectedRevision ?? current.claimRevision,
      "intent",
      companions
    );
    this.closeNow(source);
    return { action: "migrated", residence };
  }

  private async reclaimOwnedWindow(
    record: ProductWindowRecord,
    reason: "close" | "quit", background = false
  ) {
    const owned = this.residence.ownedBy(record.windowId);
    const primary = owned.find((claim) => claim.surface.startsWith("app-studio:")) ?? owned[0];
    if (primary) {
      await this.migrateToMain(
        record,
        primary.surface,
        canonicalAppSurfaceRoute(parseAppId(record.appId), "app"),
        primary.claimRevision,
        reason,
        owned.filter((claim) => claim.surface !== primary.surface),
        /* 收回目标路由取胶囊自述：用户停在 data 面就回 data 面。 */
        true, background
      );
    }
    this.closeNow(record);
  }

  private async migrateToMain(
    source: ProductWindowRecord,
    surface: SurfaceKey,
    route: string,
    expectedRevision: number,
    reason: "intent" | "close" | "quit" = "intent",
    companions: readonly SurfaceResidence[] = [],
    deriveRouteFromCapsule = false, background = false
  ) {
    const main = this.registry.main() ?? await this.ensureMain?.();
    if (!main) throw new Error("Main window is unavailable");
    const present = !background && (reason === "intent" || (reason === "close" && (main.window.isVisible?.() ?? true)));
    const migrated = await this.migration.migrate({
      surface,
      targetRoute: route,
      mode: present ? "present" : "background",
      ...(deriveRouteFromCapsule ? { deriveRouteFromCapsule: true as const } : {}),
      expectedRevision,
      sourceWindowId: source.windowId,
      sourceResidenceWindowId: source.windowId,
      targetWindowId: main.windowId,
      targetResidenceWindowId: null,
      ...(companions.length
        ? {
            companions: companions.map((claim) => ({
              surface: claim.surface,
              expectedRevision: claim.claimRevision,
            })),
          }
        : {}),
      onClaimed: (residences) => { for (const residence of residences) this.publishResidence(residence, reason); },
    });
    this.transferConversations(source.windowId, null);
    if (present) main.window.webContents.send(WINDOW_SURFACES_CHANNEL.command, {
      type: "navigate", route: migrated.targetRoute,
    } satisfies SurfaceMigrationCommand);
    if (present) this.registry.focus(main.windowId);
    return migrated.primary;
  }

  private syncUseChat(context: TrustedRendererContext, rawInput: unknown) {
    return this.appUseResidence.sync(context, rawInput);
  }

  private exportCapsule(
    windowId: string,
    transactionId: string,
    surface: SurfaceKey
  ) {
    return this.request(windowId, {
      type: "export",
      transactionId,
      surface,
    }, "exported").then((reply) => {
      if (!reply.capsule) throw new Error("Renderer omitted surface capsule");
      // A refused image set throws; the coordinator then restores the source from its own export record.
      this.images.hold(transactionId, reply.capsule, reply.images);
      return reply.capsule;
    });
  }

  private request(windowId: string, command: SurfaceMigrationCommand, outcome: SurfaceMigrationReply["outcome"]) {
    return this.replies.request(windowId, command, outcome);
  }
  private acceptReply(context: TrustedRendererContext, rawReply: unknown) { this.replies.accept(context, rawReply); }

  private onRegistryEvent(event: WindowRegistryEvent) {
    if (event.type === "renderer-gone" || event.type === "closed") {
      this.replies.rejectWindow(event.record.windowId);
    }
    if (event.record.role !== "app-window") {
      if (event.type === "renderer-gone" || event.type === "closed") this.releaseWindowResources?.(event.record.windowId);
      return;
    }
    if (event.type === "renderer-gone" ||
      (event.type === "closed" && !this.crashHandled.has(event.record.windowId))) {
      this.releaseWindowResources?.(event.record.windowId);
    }
    if (event.type === "renderer-gone") {
      this.recoverCrashedWindow(event.record, event.reason);
      return;
    }
    if (
      event.type === "closed" &&
      !this.intentionalClose.delete(event.record.windowId) &&
      !this.crashHandled.delete(event.record.windowId)
    ) {
      this.recoverCrashedWindow(event.record, "window-closed");
    }
  }

  private recoverCrashedWindow(record: ProductWindowRecord, reason: string) {
    if (this.crashHandled.has(record.windowId)) return;
    this.crashHandled.add(record.windowId);
    /* 立即拒绝该窗的在途请求：等 4 秒超时只会把每次 crash 变成必付的僵持税。 */
    this.replies.rejectWindow(record.windowId);
    this.transferConversations(record.windowId, null);
    const reclaimed = this.residence.reclaimWindow(record.windowId);
    for (const [index, residence] of reclaimed.entries()) {
      // 一个 renderer crash 只丢一份未 checkpoint capsule；多个驻留面不得重复报警。
      this.publishResidence(residence, "crash", index === 0);
    }
    if (!record.window.isDestroyed()) record.window.destroy();
    console.warn(`[window-surfaces] renderer lost; draft capsule unavailable (${reason})`);
  }

  private closeNow(record: ProductWindowRecord) {
    if (record.window.isDestroyed()) return;
    this.intentionalClose.add(record.windowId);
    record.window.destroy();
  }

  private publishResidence(
    residence: SurfaceResidence,
    reason: "intent" | "close" | "crash" | "quit",
    draftLost = false
  ) {
    this.registry.publish(WINDOW_SURFACES_CHANNEL.command, {
      type: "residence-changed",
      residence,
      reason,
      ...(draftLost ? { draftLost: true } : {}),
    } satisfies SurfaceMigrationCommand);
  }

  private isResident(context: TrustedRendererContext, residence: SurfaceResidence) {
    return residence.windowId === null
      ? context.role === "main"
      : residence.windowId === context.windowId;
  }

  private validatedChatSurface(rawChatId: unknown, rawIncarnation: unknown) {
    const chatId = parseChatPart(rawChatId);
    const incarnation = parseChatPart(rawIncarnation);
    if (this.resolveChatIdentity?.(chatId)?.incarnationId !== incarnation) {
      throw new Error("Chat incarnation changed");
    }
    return chatSurface(chatId, incarnation);
  }

  private assertAdmission() {
    if (!this.admissionOpen) throw new Error("Window admission is closed");
  }

  private canClaimUseChat(
    context: TrustedRendererContext,
    appId: string,
    chat: { chatId?: unknown; incarnationId?: unknown } | undefined,
    residence: SurfaceResidence
  ) {
    if (this.isResident(context, residence)) return true;
    if (context.role !== "app-window" || residence.windowId !== null || !chat) return false;
    const chatId = parseChatPart(chat.chatId);
    const identity = this.resolveChatIdentity?.(chatId);
    return identity?.appId === appId && identity.appRole === "use";
  }

  private appIdForStudio(surface: SurfaceKey) {
    return parseAppId(appIdFromStudioSurface(surface));
  }

  private assertStudioIntent(
    context: TrustedRendererContext,
    appId: string,
    surface: SurfaceKey,
    residence = this.residence.get(surface)
  ) {
    this.assertAppEnabled(appId);
    if (surface !== appStudioSurface(appId)) {
      throw new Error("Window intent App Studio identity mismatch");
    }
    if (context.role === "main") return;
    if (context.appId !== appId || !this.isResident(context, residence)) {
      throw new Error("Window intent rejected from nonresident App window");
    }
  }

  private assertWindowOwns(windowId: string, surface: SurfaceKey) {
    const residence = this.residence.get(surface);
    const owner = residence.windowId ?? this.registry.main()?.windowId;
    if (!owner || owner !== windowId) {
      throw new Error(`Surface is no longer resident in window: ${surface}`);
    }
  }

  private claimDraftConversation(
    context: TrustedRendererContext,
    conversationId: string,
    identity: ChatSurfaceIdentity | undefined
  ) {
    const owner = this.conversationOwners.get(conversationId);
    if (context.role === "main") {
      if (owner) throw new Error("Conversation is resident in another window");
      this.conversationOwners.set(conversationId, null);
      return;
    }
    if (
      !context.appId ||
      identity?.appId !== context.appId ||
      !identity.appRole
    ) {
      throw new Error("App window cannot claim an unrelated draft conversation");
    }
    this.assertAppStudioMutation(context, context.appId);
    if (owner !== undefined && owner !== context.windowId) {
      throw new Error("Conversation is resident in another window");
    }
    this.conversationOwners.set(conversationId, context.windowId);
  }

  private transferConversations(from: string, to: string | null) {
    for (const [conversationId, owner] of this.conversationOwners) {
      if (owner === from) this.conversationOwners.set(conversationId, to);
    }
  }

  private transferAttachmentRefs(
    capsule: SurfaceCapsuleV1,
    sourceWindowId: string,
    targetWindowId: string
  ) {
    const composer = capsule.composer;
    if (!composer?.attachmentRefs.length) return false;
    const rebind = this.rebindAttachmentRefs;
    if (!rebind) throw new Error("File reference migration is unavailable");
    rebind(composer.attachmentRefs, sourceWindowId, targetWindowId, composer.chatId);
    return true;
  }
}

export const surfaceWindowController = new SurfaceWindowController();
