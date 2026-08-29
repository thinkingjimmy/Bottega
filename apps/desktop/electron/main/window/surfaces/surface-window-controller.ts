/**
 * [INPUT]: Depends on process-global renderer IPC, trusted WindowRegistry identities, exact App Studio route helpers, residence/migration state machines, canonical/durable-draft App-chat identity and active-use-slot lookup, and main-owned attachment/capability cleanup ports
 * [OUTPUT]: Provides SurfaceWindowController and its process-global instance for route-bound create/focus/reclaim/use-chat sync, exact App-window chat projections, transactional capsule transfer, crash cleanup, and quit reconciliation
 * [POS]: Window-surfaces policy root; it is the only path that may move Studio/chat residence or rebind renderer-owned attachment references
 */

import { randomUUID } from "node:crypto";
import {
  WINDOW_SURFACES_CHANNEL,
  appIdFromStudioSurface,
  appStudioSurface,
  assertAppSurfaceRoute,
  canonicalAppSurfaceRoute,
  chatSurface,
  assertSurfaceKey,
  type OpenSurfaceInWindowInput,
  type ReclaimSurfaceInput,
  type ShowSurfaceInput,
  type SurfaceCapsuleV1,
  type SurfaceIntentResult,
  type SurfaceKey,
  type SurfaceMigrationCommand,
  type SurfaceMigrationReply,
  type SurfaceResidence,
} from "../../../../shared/window-surfaces-ipc";
import { rendererIpc } from "../../ipc-registrar";
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
import {
  type ProductWindowRecord,
  type WindowRegistry,
  type WindowRegistryEvent,
  windowRegistry,
} from "./window-registry";

type AppWindowFactory = (
  appId: string,
  windowId: string,
  route: string
) => Promise<ProductWindowRecord>;

type ChatSurfaceIdentity = Readonly<{
  incarnationId: string | null;
  appId: string | null;
  appRole: "edit" | "use" | null;
}>;

type PendingReply = {
  expectedWindowId: string;
  expectedOutcome: SurfaceMigrationReply["outcome"];
  resolve(value: SurfaceMigrationReply): void;
  reject(cause: unknown): void;
  timer: ReturnType<typeof setTimeout>;
};

const assertAppId = (value: unknown) => {
  if (typeof value !== "string" || !/^[A-Za-z0-9._-]{1,160}$/.test(value)) {
    throw new Error("Invalid App id");
  }
  return value;
};

export class SurfaceWindowController {
  readonly residence = new SurfaceResidenceLedger();
  private readonly pending = new Map<string, PendingReply>();
  private readonly intentionalClose = new Set<string>();
  private readonly crashHandled = new Set<string>();
  private readonly transferredAttachments = new Set<string>();
  private readonly conversationOwners = new Map<string, string | null>();
  private readonly migration: SurfaceMigrationCoordinator;
  private createAppWindow: AppWindowFactory | null = null;
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

  constructor(private readonly registry: WindowRegistry = windowRegistry) {
    this.migration = new SurfaceMigrationCoordinator(this.residence, {
      exportCapsule: (windowId, transactionId, surface) =>
        this.exportCapsule(windowId, transactionId, surface),
      commitSource: (windowId, transactionId, capsule) =>
        this.request(windowId, { type: "commit", transactionId, capsule }, "committed")
          .then(() => undefined).finally(() => this.transferredAttachments.delete(transactionId)),
      hydrate: async (windowId, sourceWindowId, transactionId, capsule) => {
        if (this.transferAttachmentRefs(capsule, sourceWindowId, windowId)) {
          this.transferredAttachments.add(transactionId);
        }
        await this.request(windowId, {
          type: "hydrate", transactionId, capsule,
        }, "hydrated");
      },
      restore: async (windowId, failedTargetWindowId, transactionId, capsule) => {
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
    registry.subscribe((event) => this.onRegistryEvent(event));
  }

  configure(
    mainWindow: ProductWindowRecord["window"],
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
    rendererIpc(mainWindow, rendererUrl, "Rejected untrusted window surface request")
      .roles("main", "app-window")
      .handleWithContext(WINDOW_SURFACES_CHANNEL.residence, (_context, rawSurface) =>
        this.residence.get(rawSurface)
      )
      .handleWithContext(WINDOW_SURFACES_CHANNEL.show, (context, rawInput) =>
        this.show(context, this.showInput(rawInput))
      )
      .handleWithContext(WINDOW_SURFACES_CHANNEL.openInWindow, (context, rawInput) =>
        this.openInWindow(context, this.openInput(rawInput))
      )
      .handleWithContext(WINDOW_SURFACES_CHANNEL.reclaim, (context, rawInput) =>
        this.reclaim(context, this.reclaimInput(rawInput))
      )
      .handleWithContext(WINDOW_SURFACES_CHANNEL.syncUseChat, (context, rawInput) =>
        this.syncUseChat(context, rawInput)
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
      void this.reclaimOwnedWindow(record, "close").catch((cause) => {
        /* 迁移失败不许留下一扇关不掉的窗：降级为 crash 语义收回并明示丢草稿。 */
        console.error("[window-surfaces] normal close migration failed", cause);
        this.recoverCrashedWindow(record, "close-failed");
      });
    });
  }

  stopAdmission() {
    this.admissionOpen = false;
  }

  reopenAdmission() {
    this.admissionOpen = true;
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

  assertAppStudioMutation(context: TrustedRendererContext, appId: string) {
    if (context.role === "app-window" && context.appId !== appId) {
      throw new Error("App window identity does not match the requested Studio");
    }
    const residence = this.residence.get(appStudioSurface(appId));
    if (!this.isResident(context, residence)) {
      throw new Error("App Studio mutation rejected from nonresident window");
    }
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
    for (const record of this.registry.list("app-window")) {
      try {
        await this.reclaimOwnedWindow(record, "quit");
      } catch {
        this.recoverCrashedWindow(record, "quit-timeout");
      }
    }
  }

  private async show(
    context: TrustedRendererContext,
    input: ShowSurfaceInput
  ): Promise<SurfaceIntentResult> {
    this.assertAdmission();
    const appId = this.appIdForStudio(input.surface);
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
    const target = await create(input.appId, windowId, route);
    this.trackAppWindow(target);
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
      });
      for (const residence of migrated.residences) {
        this.publishResidence(residence, "intent");
      }
      target.window.show();
      target.window.focus();
      return { action: "migrated", residence: migrated.primary };
    } catch (cause) {
      this.closeNow(target);
      throw cause;
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
    reason: "close" | "quit"
  ) {
    const owned = this.residence.ownedBy(record.windowId);
    const primary = owned.find((claim) => claim.surface.startsWith("app-studio:")) ?? owned[0];
    if (primary) {
      await this.migrateToMain(
        record,
        primary.surface,
        canonicalAppSurfaceRoute(assertAppId(record.appId), "app"),
        primary.claimRevision,
        reason,
        owned.filter((claim) => claim.surface !== primary.surface),
        /* 收回目标路由取胶囊自述：用户停在 data 面就回 data 面。 */
        true
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
    deriveRouteFromCapsule = false
  ) {
    const main = this.registry.main();
    if (!main) throw new Error("Main window is unavailable");
    const migrated = await this.migration.migrate({
      surface,
      targetRoute: route,
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
    });
    this.transferConversations(source.windowId, null);
    main.window.webContents.send(WINDOW_SURFACES_CHANNEL.command, {
      type: "navigate",
      route: migrated.targetRoute,
    } satisfies SurfaceMigrationCommand);
    for (const residence of migrated.residences) {
      this.publishResidence(residence, reason);
    }
    this.registry.focus(main.windowId);
    return migrated.primary;
  }

  private syncUseChat(context: TrustedRendererContext, rawInput: unknown) {
    /* 与 openInWindow 同门：退出编排（stopAdmission）与在途迁移期间不得写驻留账本，
       否则收回流程 export 等待中被撞 revision，优雅退出退化成 crash 丢草稿。 */
    this.assertAdmission();
    const input = rawInput as {
      appId?: unknown;
      previous?: { chatId?: unknown; incarnationId?: unknown };
      next?: { chatId?: unknown; incarnationId?: unknown };
    } | null;
    const appId = assertAppId(input?.appId);
    this.assertAppStudioMutation(context, appId);
    const previous = input?.previous
      ? this.validatedChatSurface(input.previous.chatId, input.previous.incarnationId)
      : null;
    const next = input?.next
      ? this.validatedChatSurface(input.next.chatId, input.next.incarnationId)
      : null;
    for (const surface of [appStudioSurface(appId), previous, next]) {
      if (surface && this.migration.isMigrating(surface)) {
        throw new Error("Surface migration in progress; use-chat sync rejected");
      }
    }
    if (previous === next) return next ? this.residence.get(next) : null;
    if (previous) this.assertIntentResidence(context, this.residence.get(previous));
    const nextResidence = next ? this.residence.get(next) : null;
    if (nextResidence && !this.canClaimUseChat(context, appId, input?.next, nextResidence)) {
      if (nextResidence.windowId) this.registry.focus(nextResidence.windowId);
      throw new Error("Use chat is resident in another window");
    }
    const targetWindowId = context.role === "main" ? null : context.windowId;
    const moves = [
      ...(previous
        ? [{
            surface: previous,
            expectedRevision: this.residence.get(previous).claimRevision,
            windowId: null,
          }]
        : []),
      ...(next && nextResidence?.windowId !== targetWindowId
        ? [{
            surface: next,
            expectedRevision: nextResidence!.claimRevision,
            windowId: targetWindowId,
          }]
        : []),
    ];
    if (!moves.length) return null;
    const changed = this.residence.moveMany(moves);
    if (previous) this.conversationOwners.set(input!.previous!.chatId as string, null);
    if (next) {
      this.conversationOwners.set(
        input!.next!.chatId as string,
        context.role === "main" ? null : context.windowId
      );
    }
    for (const residence of changed) this.publishResidence(residence, "intent");
    return next ? this.residence.get(next) : null;
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
      return reply.capsule;
    });
  }

  private request(
    windowId: string,
    command: SurfaceMigrationCommand,
    expectedOutcome: SurfaceMigrationReply["outcome"]
  ) {
    const record = this.registry.get(windowId);
    if (!record) return Promise.reject(new Error("Migration window is unavailable"));
    const transactionId = "transactionId" in command ? command.transactionId : "";
    return new Promise<SurfaceMigrationReply>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(transactionId);
        reject(new Error(`Surface migration timed out: ${expectedOutcome}`));
      }, 4_000);
      this.pending.set(transactionId, {
        expectedWindowId: windowId,
        expectedOutcome,
        resolve,
        reject,
        timer,
      });
      record.window.webContents.send(WINDOW_SURFACES_CHANNEL.command, command);
    });
  }

  private acceptReply(context: TrustedRendererContext, rawReply: unknown) {
    if (!rawReply || typeof rawReply !== "object") return;
    const reply = rawReply as SurfaceMigrationReply;
    if (typeof reply.transactionId !== "string") return;
    const pending = this.pending.get(reply.transactionId);
    if (!pending || pending.expectedWindowId !== context.windowId) return;
    this.pending.delete(reply.transactionId);
    clearTimeout(pending.timer);
    if (reply.outcome !== pending.expectedOutcome) {
      pending.reject(new Error(reply.message || "Renderer migration failed"));
      return;
    }
    pending.resolve(reply);
  }

  private onRegistryEvent(event: WindowRegistryEvent) {
    if (event.record.role !== "app-window") return;
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
    for (const [transactionId, pending] of this.pending) {
      if (pending.expectedWindowId !== record.windowId) continue;
      this.pending.delete(transactionId);
      clearTimeout(pending.timer);
      pending.reject(new Error(`Migration window lost (${reason})`));
    }
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

  private showInput(value: unknown): ShowSurfaceInput {
    const input = value as Partial<ShowSurfaceInput> | null;
    return {
      surface: assertSurfaceKey(input?.surface),
      route: typeof input?.route === "string" ? input.route : "",
    };
  }

  private openInput(value: unknown): OpenSurfaceInWindowInput {
    const input = value as Partial<OpenSurfaceInWindowInput> | null;
    return {
      ...this.showInput(value),
      appId: assertAppId(input?.appId),
      ...(input?.expectedRevision === undefined
        ? {}
        : { expectedRevision: this.revision(input.expectedRevision) }),
      ...(input?.useChat
        ? {
            useChat: {
              chatId: this.chatPart(input.useChat.chatId),
              incarnationId: this.chatPart(input.useChat.incarnationId),
            },
          }
        : {}),
    };
  }

  private reclaimInput(value: unknown): ReclaimSurfaceInput {
    const input = value as Partial<ReclaimSurfaceInput> | null;
    return {
      ...this.showInput(value),
      ...(input?.expectedRevision === undefined
        ? {}
        : { expectedRevision: this.revision(input.expectedRevision) }),
    };
  }

  private revision(value: unknown) {
    if (!Number.isInteger(value) || (value as number) < 0) {
      throw new Error("Invalid residence revision");
    }
    return value as number;
  }

  private chatPart(value: unknown) {
    if (typeof value !== "string") throw new Error("Invalid chat surface identity");
    chatSurface(value, value);
    return value;
  }

  private validatedChatSurface(rawChatId: unknown, rawIncarnation: unknown) {
    const chatId = this.chatPart(rawChatId);
    const incarnation = this.chatPart(rawIncarnation);
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
    const chatId = this.chatPart(chat.chatId);
    const identity = this.resolveChatIdentity?.(chatId);
    return identity?.appId === appId && identity.appRole === "use";
  }

  private appIdForStudio(surface: SurfaceKey) {
    return assertAppId(appIdFromStudioSurface(surface));
  }

  private assertStudioIntent(
    context: TrustedRendererContext,
    appId: string,
    surface: SurfaceKey,
    residence = this.residence.get(surface)
  ) {
    if (surface !== appStudioSurface(appId)) {
      throw new Error("Window intent App Studio identity mismatch");
    }
    if (context.role === "main") return;
    if (context.appId !== appId || !this.isResident(context, residence)) {
      throw new Error("Window intent rejected from nonresident App window");
    }
  }

  private assertIntentResidence(
    context: TrustedRendererContext,
    residence: SurfaceResidence
  ) {
    if (!this.isResident(context, residence)) {
      throw new Error("Window intent rejected for a surface resident elsewhere");
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
