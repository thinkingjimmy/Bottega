/**
 * [INPUT]: Depends on App/Chat/Project stores, AppChatSlots, canonical placement predicates, and optional residence effect ports
 * [OUTPUT]: Provides main-owned App Use history/open/switch residence saga, issuance gate, Editor activation/hide/open, and typed destinations
 * [POS]: Apps navigation authority; renderer may request intent but cannot forge context, incarnation, Editor facts, or switch phases
 */

import { createHash, randomUUID } from "node:crypto";
import type {
  AppChatSlot,
  AppUseHistoryPage,
  ListAppUseHistoryInput,
  OpenAppEditorChatInput,
  OpenAppEditorInput,
  OpenAppUseChatInput,
} from "../../../shared/apps-ipc";
import { appEditorProjectionOf } from "../../../shared/apps-ipc";
import type {
  AppEditorDestination,
  AppUseChatDestination,
  AppUseSurfaceFence,
  AppUseSwitchIntent,
  AppUseSwitchReceipt,
} from "../../../shared/placement/facts";
import { hasCanonicalChatPlacement } from "../../../shared/placement/facts";
import { appearsInHistory, compareHistoryChats } from "../../../shared/placement/history";
import type { ChatStore } from "../chats/chat-store";
import type { ChatRecord, ChatSummary } from "../../../shared/chats-ipc";
import type { ProjectStore } from "../projects/store/project-store";
import type { AppChatSlots } from "./app-chat-slots";
import type { AppStore } from "./app-store";
import {
  AppUseHistorySnapshotStore,
  type AppUseHistorySnapshot,
} from "./app-use-history-snapshots";

const HISTORY_PAGE_MAX = 50;
const HISTORY_TTL_MS = 5 * 60_000;

type Dependencies = Readonly<{
  apps: AppStore;
  chats: ChatStore;
  projects: ProjectStore;
  slots: AppChatSlots;
  now?: () => number;
  historyLimits?: Readonly<{ maxSnapshots?: number; maxItems?: number }>;
  runExclusive?<T>(appId: string, operation: () => Promise<T>): Promise<T>;
  revokeOld?(intent: AppUseSwitchIntent): Promise<void>;
  drainOld?(intent: AppUseSwitchIntent): Promise<void>;
  claimTarget?(intent: AppUseSwitchIntent): Promise<void>;
  openIssuance?(intent: AppUseSwitchIntent): Promise<void>;
  captureSurfaceFence?(
    appId: string,
    source: AppChatSlot | null,
    target: AppChatSlot
  ): AppUseSurfaceFence;
  validateSurfaceFence?(intent: AppUseSwitchIntent): void;
  focusMain?(
    destination: AppUseChatDestination | AppEditorDestination,
    intent?: AppUseSwitchIntent
  ): Promise<void> | void;
}>;

export class AppNavigationService {
  private readonly now: () => number;
  private readonly history: AppUseHistorySnapshotStore;

  constructor(private readonly dependencies: Dependencies) {
    this.now = dependencies.now ?? Date.now;
    this.history = new AppUseHistorySnapshotStore(
      this.now,
      HISTORY_TTL_MS,
      dependencies.historyLimits
    );
  }

  async listAppUseHistory(input: ListAppUseHistoryInput): Promise<AppUseHistoryPage> {
    const pageSize = Math.max(1, Math.min(input.pageSize ?? 20, HISTORY_PAGE_MAX));
    let snapshot: AppUseHistorySnapshot;
    let offset = 0;
    if (input.cursor) {
      ({ snapshot, offset } = this.history.resolve(input.appId, input.cursor));
    } else {
      snapshot = this.createHistorySnapshot(input.appId);
    }
    if (
      input.expectedSnapshotRevision &&
      input.expectedSnapshotRevision !== snapshot.revision
    ) {
      throw Object.assign(new Error("APP_USE_HISTORY_SNAPSHOT_CHANGED"), {
        status: 409,
      });
    }
    const items = snapshot.items.slice(offset, offset + pageSize);
    const nextOffset = offset + items.length;
    let nextCursor: string | null = null;
    if (nextOffset < snapshot.items.length) {
      const anchor = items.at(-1)!;
      nextCursor = this.history.cursor(snapshot, anchor);
    }
    return {
      snapshotId: snapshot.id,
      snapshotRevision: snapshot.revision,
      latestSnapshotRevision: this.currentHistoryRevision(input.appId),
      items: structuredClone(items),
      nextCursor,
      expiresAt: snapshot.expiresAt,
    };
  }

  async openAppUseChat(input: OpenAppUseChatInput) {
    return this.runExclusive(input.appId, async () => {
      const target = await this.requireUseTarget(input);
      return this.switchAppUseChat(input.appId, target, input.requestId);
    });
  }

  async newAppUseChat(
    appId: string,
    requestId: string,
    replaceActive = false
  ) {
    return this.runExclusive(appId, () =>
      this.newAppUseChatExclusive(appId, requestId, replaceActive)
    );
  }

  private async newAppUseChatExclusive(
    appId: string,
    requestId: string,
    replaceActive: boolean
  ) {
    const app = this.dependencies.apps.get(appId);
    if (!app || app.state !== "ready") {
      return {
        status: "precommit-rejected" as const,
        active: app?.activeUseChatSlot ?? null,
        reason: "APP_UNAVAILABLE",
      };
    }
    const active = app.activeUseChatSlot;
    const activeChat = active
      ? this.dependencies.chats.getMetadata(active.id)
      : null;
    if (
      !replaceActive &&
      active &&
      activeChat &&
      activeChat.incarnationId === active.incarnationId &&
      !activeChat.archivedAt &&
      activeChat.startState.kind === "unstarted" &&
      activeChat.context.kind === "app-use" &&
      activeChat.context.appId === appId
    ) {
      const target = this.destination(appId, active);
      await this.dependencies.focusMain?.(target);
      return { status: "completed" as const, intentId: requestId, target };
    }
    const slot = await this.dependencies.slots.ensure({
      appId,
      role: "use",
      requestId: `${requestId}:slot`,
      mode: "new",
    });
    return this.switchAppUseChat(appId, this.destination(appId, slot), requestId);
  }

  async openAppEditor(input: OpenAppEditorInput): Promise<AppEditorDestination> {
    return this.runExclusive(input.appId, async () => {
      const project = this.requireEditorProject(input.appId);
      await this.activateEditor(input.appId);
      const destination = await this.resolveEditorDestination({
        appId: input.appId,
        projectId: project.id,
        requestId: input.requestId,
        mode: input.mode ?? "resume",
      });
      await this.dependencies.focusMain?.(destination);
      return destination;
    });
  }

  async openAppEditorChat(
    input: OpenAppEditorChatInput
  ): Promise<AppEditorDestination> {
    return this.runExclusive(input.appId, async () => {
      const project = this.requireEditorProject(input.appId, input.projectId);
      const chat = await this.requireEditorChat(input, project.id);
      await this.dependencies.apps.update(input.appId, (current) => ({
        ...this.assertEditorApp(current),
        editor: activatedEditor(current, this.now()),
        editChatSlot: canonicalEditorSlot(current.editChatSlot, chat),
      }));
      await this.requireEditorChat(input, project.id);
      const destination = {
        kind: "app-editor-chat" as const,
        appId: input.appId,
        projectId: project.id,
        chatId: chat.id,
        incarnationId: chat.incarnationId,
      };
      await this.dependencies.focusMain?.(destination);
      return destination;
    });
  }

  async hideAppEditor(appId: string) {
    const now = this.now();
    return this.dependencies.apps.update(appId, (current) => ({
      ...current,
      editor: {
        ...appEditorProjectionOf(current),
        editorHiddenAt: now,
        editorRevision: appEditorProjectionOf(current).editorRevision + 1,
      },
    }));
  }

  async prepareChatDeactivation(
    chat: Pick<ChatRecord, "id" | "incarnationId" | "context">,
    action: "archive" | "delete"
  ) {
    if (chat.context.kind === "ordinary") return;
    const app = this.dependencies.apps.get(chat.context.appId);
    if (!app) return;
    if (
      chat.context.kind === "app-use" &&
      app.activeUseChatSlot?.id === chat.id &&
      app.activeUseChatSlot.incarnationId === chat.incarnationId
    ) {
      const receipt = await this.newAppUseChat(
        chat.context.appId,
        `${action}:${chat.id}:${randomUUID()}`,
        true
      );
      if (receipt.status !== "completed") {
        throw new Error("App Use conversation switch is still recovering");
      }
      return;
    }
    if (
      chat.context.kind === "app-edit" &&
      app.editChatSlot?.id === chat.id &&
      app.editChatSlot.incarnationId === chat.incarnationId
    ) {
      const project = this.dependencies.projects.findByAppId(chat.context.appId);
      if (!project || project.role === "base-custody") {
        throw new Error("App Edit Project 不存在");
      }
      const destination = await this.resolveEditorDestination({
        appId: chat.context.appId,
        projectId: project.id,
        requestId: `${action}:${chat.id}:${randomUUID()}`,
        mode: "resume",
        exclude: { id: chat.id, incarnationId: chat.incarnationId },
      });
      await this.dependencies.focusMain?.(destination);
    }
  }

  private async resolveEditorDestination(input: {
    appId: string;
    projectId: string;
    requestId: string;
    mode: "resume" | "new";
    exclude?: { id: string; incarnationId: string };
  }): Promise<AppEditorDestination> {
    if (input.mode === "resume") {
      const latest = this.dependencies.chats
        .list()
        .filter(hasCanonicalChatPlacement)
        .filter(
          (chat) =>
            !chat.archivedAt &&
            !chat.readOnlyReason &&
            chat.context.kind === "app-edit" &&
            chat.context.appId === input.appId &&
            chat.projectId === input.projectId &&
            (chat.id !== input.exclude?.id ||
              chat.incarnationId !== input.exclude.incarnationId)
        )
        .sort(
          (left, right) =>
            right.updatedAt - left.updatedAt || left.id.localeCompare(right.id)
        )[0];
      if (latest) {
        await this.rememberEditorChat(input.appId, latest);
        return {
          kind: "app-editor-chat",
          appId: input.appId,
          projectId: input.projectId,
          chatId: latest.id,
          incarnationId: latest.incarnationId,
        };
      }
      const draft = this.dependencies.apps.get(input.appId)?.editChatSlot;
      if (draft?.state === "draft" && draft.id !== input.exclude?.id) {
        return {
          kind: "app-editor-draft",
          appId: input.appId,
          projectId: input.projectId,
          intentId: draft.id,
        };
      }
    }
    const slot = await this.dependencies.slots.ensure({
      appId: input.appId,
      role: "edit",
      requestId: `${input.requestId}:slot`,
      mode: "new",
    });
    return {
      kind: "app-editor-draft",
      appId: input.appId,
      projectId: input.projectId,
      intentId: slot.id,
    };
  }

  private async rememberEditorChat(appId: string, chat: ChatRecord | ChatSummary) {
    const incarnationId = chat.incarnationId;
    if (!incarnationId) throw new Error("App Edit destination incarnation is missing");
    await this.dependencies.apps.update(appId, (current) => {
      const pointer = current.editChatSlot;
      if (
        pointer?.id === chat.id &&
        pointer.incarnationId === incarnationId &&
        pointer.state === "canonical"
      ) {
        return current;
      }
      return {
        ...current,
        editChatSlot: {
          id: chat.id,
          incarnationId,
          state: "canonical",
          revision: (pointer?.revision ?? 0) + 1,
        },
      };
    });
  }

  private requireEditorProject(appId: string, expectedProjectId?: string) {
    const app = this.dependencies.apps.get(appId);
    this.assertEditorApp(app);
    const project = this.dependencies.projects.findByAppId(appId);
    if (
      !project ||
      project.role === "base-custody" ||
      (expectedProjectId !== undefined && project.id !== expectedProjectId)
    ) {
      throw Object.assign(new Error("App Edit Project 不存在或已变化"), {
        status: 409,
      });
    }
    return project;
  }

  private async requireEditorChat(
    input: OpenAppEditorChatInput,
    projectId: string
  ) {
    const chat = this.dependencies.chats.getMetadata(input.chatId);
    if (
      !chat ||
      chat.incarnationId !== input.incarnationId ||
      chat.archivedAt ||
      chat.readOnlyReason ||
      chat.projectId !== projectId ||
      chat.context.kind !== "app-edit" ||
      chat.context.appId !== input.appId ||
      chat.context.projectId !== projectId
    ) {
      throw Object.assign(new Error("App Editor destination 已失效"), {
        status: 409,
      });
    }
    return chat;
  }

  private assertEditorApp<T extends { state: string; editableSource?: boolean }>(
    app: T | undefined
  ): T {
    if (!app || !app.editableSource || app.state !== "ready") {
      throw Object.assign(new Error("App 没有可编辑源码"), { status: 409 });
    }
    return app;
  }

  private async activateEditor(appId: string) {
    await this.dependencies.apps.update(appId, (current) => ({
      ...this.assertEditorApp(current),
      editor: activatedEditor(current, this.now()),
    }));
  }

  isUseIssuanceAllowed(appId: string, chatId: string) {
    const app = this.dependencies.apps.get(appId);
    if (
      !app ||
      app.state !== "ready" ||
      app.activeUseChatSlot?.id !== chatId
    ) return false;
    const intent = app.activeUseSwitch;
    return (
      !intent ||
      intent.phase === "issuance-open" ||
      intent.phase === "completed"
    );
  }

  async recover() {
    for (const app of this.dependencies.apps.list()) {
      const intent = app.activeUseSwitch;
      if (!intent) continue;
      await this.runExclusive(app.id, async () => {
        const current = this.dependencies.apps.get(app.id)?.activeUseSwitch;
        if (!current) return;
        if (current.phase === "prepared") {
          await this.clearPrepared(current);
          return;
        }
        await this.rollForward(current);
      });
    }
  }

  private async switchAppUseChat(
    appId: string,
    target: AppUseChatDestination,
    requestId: string
  ): Promise<AppUseSwitchReceipt> {
    const app = this.dependencies.apps.get(appId);
    if (!app) {
      return { status: "precommit-rejected", active: null, reason: "APP_UNAVAILABLE" };
    }
    const existingIntent = app.activeUseSwitch;
    if (existingIntent?.intentId === requestId) {
      const existingTarget = this.destination(appId, existingIntent.target);
      if (existingIntent.phase === "prepared") {
        await this.clearPrepared(existingIntent);
      } else {
        try {
          await this.rollForward(existingIntent);
          return { status: "completed", intentId: requestId, target: existingTarget };
        } catch {
          return { status: "recovering", intentId: requestId, target: existingTarget };
        }
      }
    }
    if (
      app.activeUseChatSlot?.id === target.chatId &&
      app.activeUseChatSlot.incarnationId === target.incarnationId &&
      !app.activeUseSwitch
    ) {
      await this.dependencies.focusMain?.(target);
      return { status: "completed", intentId: requestId, target };
    }
    const targetSlot: AppChatSlot = {
      id: target.chatId,
      incarnationId: target.incarnationId,
      state: "canonical",
      revision: (app.activeUseChatSlot?.revision ?? 0) + 1,
    };
    const surfaceFence = this.dependencies.captureSurfaceFence?.(
      appId,
      app.activeUseChatSlot,
      targetSlot
    ) ?? {
      expectedSourceSurfaceRevision: 0,
      expectedTargetSurfaceRevision: 0,
      expectedStudioSurfaceRevision: 0,
    };
    const intent: AppUseSwitchIntent = {
      intentId: requestId,
      appId,
      source: app.activeUseChatSlot,
      target: targetSlot,
      expectedAppRevision: app.activeUseChatSlot?.revision ?? 0,
      expectedLifecycleRevision: app.lifecycleRevision,
      expectedGenerationBindingRevision: app.generationBinding.bindingRevision,
      expectedGenerationId: app.generationBinding.active?.generationId ?? null,
      ...surfaceFence,
      phase: "prepared",
      createdAt: this.now(),
    };
    try {
      await this.dependencies.apps.update(appId, (current) => ({
        ...this.assertSwitchPreconditions(current, intent),
        activeUseChatSlot: targetSlot,
        activeUseSwitch: { ...intent, phase: "committed" as const },
      }));
    } catch (cause) {
      const durable = this.dependencies.apps.get(appId)?.activeUseSwitch;
      if (durable?.intentId === requestId && durable.phase !== "prepared") {
        return { status: "recovering", intentId: requestId, target };
      }
      return {
        status: "precommit-rejected",
        active: app.activeUseChatSlot,
        reason: cause instanceof Error ? cause.message : String(cause),
      };
    }
    try {
      await this.rollForward({ ...intent, phase: "committed" });
      return { status: "completed", intentId: requestId, target };
    } catch {
      return { status: "recovering", intentId: requestId, target };
    }
  }

  private async rollForward(initial: AppUseSwitchIntent) {
    let intent = initial;
    const step = async (
      from: AppUseSwitchIntent["phase"],
      to: AppUseSwitchIntent["phase"],
      effect?: (intent: AppUseSwitchIntent) => Promise<void>
    ) => {
      if (intent.phase !== from) return;
      const current = this.dependencies.apps.get(intent.appId);
      if (!current) throw new Error("USE_SWITCH_APP_MISSING");
      this.assertAppFence(current, intent);
      await effect?.(intent);
      const saved = await this.dependencies.apps.update(intent.appId, (current) => {
        if (current.activeUseSwitch?.intentId !== intent.intentId) {
          throw new Error("USE_SWITCH_INTENT_CHANGED");
        }
        this.assertAppFence(current, intent);
        return {
          ...current,
          activeUseSwitch: { ...current.activeUseSwitch, phase: to },
        };
      });
      intent = saved.activeUseSwitch!;
    };
    await step("committed", "old-revoked", this.dependencies.revokeOld);
    await step("old-revoked", "old-drained", this.dependencies.drainOld);
    await step("old-drained", "target-claimed", this.dependencies.claimTarget);
    await step("target-claimed", "issuance-open", this.dependencies.openIssuance);
    await step("issuance-open", "completed");
    await this.dependencies.focusMain?.(
      this.destination(intent.appId, intent.target),
      intent
    );
    await this.dependencies.apps.update(intent.appId, (current) => ({
      ...current,
      activeUseSwitch: null,
    }));
  }

  private assertSwitchPreconditions(
    current: NonNullable<ReturnType<AppStore["get"]>>,
    intent: AppUseSwitchIntent
  ) {
    if (
      current.activeUseSwitch &&
      current.activeUseSwitch.intentId !== intent.intentId
    ) {
      throw new Error("USE_SWITCH_BUSY");
    }
    if (
      (current.activeUseChatSlot?.revision ?? 0) !== intent.expectedAppRevision
    ) {
      throw new Error("USE_SWITCH_STALE");
    }
    this.assertAppFence(current, intent);
    this.dependencies.validateSurfaceFence?.(intent);
    return current;
  }

  private assertAppFence(
    current: NonNullable<ReturnType<AppStore["get"]>>,
    intent: AppUseSwitchIntent
  ) {
    if (
      current.state !== "ready" ||
      current.lifecycleRevision !== intent.expectedLifecycleRevision ||
      current.generationBinding.bindingRevision !==
        intent.expectedGenerationBindingRevision ||
      (current.generationBinding.active?.generationId ?? null) !==
        intent.expectedGenerationId
    ) {
      throw new Error("USE_SWITCH_APP_FENCE_STALE");
    }
  }

  private async clearPrepared(intent: AppUseSwitchIntent) {
    await this.dependencies.apps.update(intent.appId, (current) => {
      if (current.activeUseSwitch?.intentId !== intent.intentId) return current;
      return { ...current, activeUseSwitch: null };
    });
  }

  private runExclusive<T>(appId: string, operation: () => Promise<T>) {
    return this.dependencies.runExclusive?.(appId, operation) ?? operation();
  }

  private async requireUseTarget(input: OpenAppUseChatInput) {
    const app = this.dependencies.apps.get(input.appId);
    const project = this.dependencies.projects.findByAppId(input.appId);
    const chat = this.dependencies.chats.getMetadata(input.chatId);
    if (
      !app ||
      app.state !== "ready" ||
      !project ||
      !chat ||
      chat.incarnationId !== input.incarnationId ||
      chat.archivedAt ||
      chat.projectId !== project.id ||
      chat.context.kind !== "app-use" ||
      chat.context.appId !== input.appId
    ) {
      throw Object.assign(new Error("App Use destination 已失效"), { status: 409 });
    }
    return this.destination(input.appId, {
      id: chat.id,
      incarnationId: chat.incarnationId,
      state: "canonical",
      revision: chat.chatRecordRevision,
    });
  }

  private destination(appId: string, slot: AppChatSlot): AppUseChatDestination {
    return {
      kind: "app-use-chat",
      appId,
      chatId: slot.id,
      incarnationId: slot.incarnationId,
    };
  }

  private createHistorySnapshot(appId: string): AppUseHistorySnapshot {
    const app = this.dependencies.apps.get(appId);
    if (!app) throw new Error("App 不存在");
    const items = this.historyItems(appId);
    return this.history.create(appId, historyRevision(items), items);
  }

  private historyItems(appId: string): AppUseHistoryPage["items"] {
    const app = this.dependencies.apps.get(appId);
    if (!app) throw new Error("App 不存在");
    return this.dependencies.chats
      .list()
      .filter(hasCanonicalChatPlacement)
      .filter(
        (chat) =>
          chat.context.kind === "app-use" &&
          chat.context.appId === appId &&
          appearsInHistory(chat)
      )
      .sort(compareHistoryChats)
      .map((chat) => ({
        chatId: chat.id,
        incarnationId: chat.incarnationId,
        title: chat.title,
        preview: chat.preview,
        updatedAt: chat.updatedAt,
        createdAt: chat.createdAt,
        startState: chat.startState,
        active:
          app.activeUseChatSlot?.id === chat.id &&
          app.activeUseChatSlot.incarnationId === chat.incarnationId,
      }));
  }

  private currentHistoryRevision(appId: string) {
    return historyRevision(this.historyItems(appId));
  }

}

function historyRevision(items: AppUseHistoryPage["items"]) {
  return createHash("sha256").update(JSON.stringify(items)).digest("hex");
}

function activatedEditor(
  record: Parameters<typeof appEditorProjectionOf>[0],
  now: number
) {
  const current = appEditorProjectionOf(record);
  if (current.editorActivatedAt !== null && current.editorHiddenAt === null) {
    return current;
  }
  return {
    editorActivatedAt: current.editorActivatedAt ?? now,
    editorHiddenAt: null,
    editorRevision: current.editorRevision + 1,
  };
}

function canonicalEditorSlot(
  current: AppChatSlot | null,
  chat: Pick<ChatRecord, "id" | "incarnationId">
): AppChatSlot {
  if (
    current?.state === "canonical" &&
    current.id === chat.id &&
    current.incarnationId === chat.incarnationId
  ) {
    return current;
  }
  return {
    id: chat.id,
    incarnationId: chat.incarnationId,
    state: "canonical",
    revision: (current?.revision ?? 0) + 1,
  };
}
