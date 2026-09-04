/**
 * [INPUT]: Depends on App/Chat/Project stores, AppChatSlots, canonical placement predicates, and optional residence effect ports
 * [OUTPUT]: Provides main-owned App Use history keyset paging, single-commit switch residence, issuance gate, Editor activation/hide/open, and typed destinations
 * [POS]: Apps navigation authority; renderer may request intent but cannot forge context, incarnation, Editor facts, or active residence
 */

import { createHash, randomUUID } from "node:crypto";
import type {
  AppChatSlot,
  AppUseHistoryItem,
  AppUseHistoryPage,
  ListAppUseHistoryInput,
  OpenAppEditorChatInput,
  OpenAppEditorInput,
  OpenAppUseChatInput,
} from "../../../../shared/apps-ipc";
import { appEditorProjectionOf } from "../../../../shared/apps-ipc";
import type {
  AppEditorDestination,
  AppUseChatDestination,
  AppUseSurfaceFence,
  AppUseSwitchIntent,
  AppUseSwitchReceipt,
} from "../../../../shared/placement/facts";
import { hasCanonicalChatPlacement } from "../../../../shared/placement/facts";
import { appearsInHistory, compareHistoryChats } from "../../../../shared/placement/history";
import type { ChatStore } from "../../chats/chat-store";
import type { ChatRecord, ChatSummary } from "../../../../shared/chats-ipc";
import type { ProjectStore } from "../../projects/store/project-store";
import type { AppChatSlots } from "./app-chat-slots";
import type { AppStore } from "../store/app-store";
import { errorMessage } from "../../errors";

const HISTORY_PAGE_MAX = 50;

/** 游标即排序键：本地 chats.list() 是全序，接续位置不需要第二份真相。 */
type HistoryCursor = Readonly<{
  updatedAt: number;
  createdAt: number;
  chatId: string;
}>;

type Dependencies = Readonly<{
  apps: AppStore;
  chats: ChatStore;
  projects: ProjectStore;
  slots: AppChatSlots;
  now?: () => number;
  runExclusive?<T>(appId: string, operation: () => Promise<T>): Promise<T>;
  revokeOld?(intent: AppUseSwitchIntent): Promise<void>;
  drainOld?(intent: AppUseSwitchIntent): Promise<void>;
  claimTarget?(intent: AppUseSwitchIntent): Promise<void>;
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

  constructor(private readonly dependencies: Dependencies) {
    this.now = dependencies.now ?? Date.now;
  }

  async listAppUseHistory(input: ListAppUseHistoryInput): Promise<AppUseHistoryPage> {
    const pageSize = Math.max(1, Math.min(input.pageSize ?? 20, HISTORY_PAGE_MAX));
    const all = this.historyItems(input.appId);
    const revision = historyRevision(all);
    const cursor = input.cursor ? decodeHistoryCursor(input.cursor) : null;
    const remaining = cursor
      ? all.filter((item) => isAfterCursor(item, cursor))
      : all;
    const items = remaining.slice(0, pageSize);
    const last = items.length < remaining.length ? items.at(-1)! : null;
    return {
      /* 客户端说自己手里是哪一版就回哪一版：翻页不冻结清单，
         「你手里的 ≠ 现在的」由这两格自己说清楚。 */
      snapshotRevision: input.expectedSnapshotRevision ?? revision,
      latestSnapshotRevision: revision,
      items,
      nextCursor: last ? encodeHistoryCursor(last) : null,
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
    return Boolean(
      app &&
        app.state === "ready" &&
        app.activeUseChatSlot?.id === chatId &&
        !app.activeUseSwitch
    );
  }

  /**
   * 切换记号只覆盖「target 已落盘、内存效果未跑完」那一瞬。效果随进程蒸发，重启后
   * 没有任何东西可以重放——重放反而会撞上重置为 0 的 surface fence，把这台 App 的
   * Use 面永久判死。所以恢复只做一件事：抹掉残留记号；一台失败也不牵连其余。
   */
  async recover() {
    for (const app of this.dependencies.apps.list()) {
      if (!app.activeUseSwitch) continue;
      try {
        await this.runExclusive(app.id, () => this.clearSwitch(app.id));
      } catch (cause) {
        console.warn(
          `[apps] App ${app.id} 的 Use 切换记号清理失败：${errorMessage(cause)}`
        );
      }
    }
  }

  /**
   * 一次落盘定乾坤：target 与「正在切」记号同一次提交，随后跑纯内存效果，最后抹掉
   * 记号。中间那些 old-revoked/target-claimed 全是内存事实，落盘只是把不可重放的
   * 东西写成了看似可重放的样子——七次 fsync 买来一个假的恢复点。
   */
  private async switchAppUseChat(
    appId: string,
    target: AppUseChatDestination,
    requestId: string
  ): Promise<AppUseSwitchReceipt> {
    /* 持锁时看到的记号必然是崩溃残留：唯一的写者就是这里，且退出时必清。 */
    await this.clearSwitch(appId);
    const app = this.dependencies.apps.get(appId);
    if (!app) {
      return { status: "precommit-rejected", active: null, reason: "APP_UNAVAILABLE" };
    }
    if (
      app.activeUseChatSlot?.id === target.chatId &&
      app.activeUseChatSlot.incarnationId === target.incarnationId
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
      phase: "committed",
      createdAt: this.now(),
    };
    try {
      await this.dependencies.apps.update(appId, (current) => ({
        ...this.assertSwitchPreconditions(current, intent),
        activeUseChatSlot: targetSlot,
        activeUseSwitch: intent,
      }));
    } catch (cause) {
      return {
        status: "precommit-rejected",
        active: app.activeUseChatSlot,
        reason: cause instanceof Error ? cause.message : String(cause),
      };
    }
    const settled = await this.runSwitchEffects(intent);
    await this.clearSwitch(appId);
    return settled
      ? { status: "completed", intentId: requestId, target }
      : { status: "recovering", intentId: requestId, target };
  }

  /** 效果全在内存：失败不回滚已落盘的 target，只把回执降级成 recovering。 */
  private async runSwitchEffects(intent: AppUseSwitchIntent) {
    try {
      await this.dependencies.revokeOld?.(intent);
      await this.dependencies.drainOld?.(intent);
      await this.dependencies.claimTarget?.(intent);
      await this.dependencies.focusMain?.(
        this.destination(intent.appId, intent.target),
        intent
      );
      return true;
    } catch (cause) {
      console.warn(`[apps] App Use 切换效果未跑完：${errorMessage(cause)}`);
      return false;
    }
  }

  private async clearSwitch(appId: string) {
    if (!this.dependencies.apps.get(appId)?.activeUseSwitch) return;
    await this.dependencies.apps.update(appId, (current) => ({
      ...current,
      activeUseSwitch: null,
    }));
  }

  private assertSwitchPreconditions(
    current: NonNullable<ReturnType<AppStore["get"]>>,
    intent: AppUseSwitchIntent
  ) {
    if (current.activeUseSwitch) throw new Error("USE_SWITCH_BUSY");
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

}

function historyRevision(items: AppUseHistoryPage["items"]) {
  return createHash("sha256").update(JSON.stringify(items)).digest("hex");
}

function encodeHistoryCursor(item: AppUseHistoryItem) {
  return Buffer.from(
    JSON.stringify([item.updatedAt, item.createdAt, item.chatId])
  ).toString("base64url");
}

function decodeHistoryCursor(cursor: string): HistoryCursor {
  try {
    const [updatedAt, createdAt, chatId] = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8")
    ) as [number, number, string];
    if (
      typeof updatedAt !== "number" ||
      typeof createdAt !== "number" ||
      typeof chatId !== "string"
    ) {
      throw new Error("invalid");
    }
    return { updatedAt, createdAt, chatId };
  } catch {
    throw Object.assign(new Error("APP_USE_HISTORY_CURSOR_INVALID"), {
      status: 409,
    });
  }
}

/** 与 compareHistoryChats 同序：updatedAt/createdAt 降序，chatId 升序。 */
function isAfterCursor(item: AppUseHistoryItem, cursor: HistoryCursor) {
  if (item.updatedAt !== cursor.updatedAt) return item.updatedAt < cursor.updatedAt;
  if (item.createdAt !== cursor.createdAt) return item.createdAt < cursor.createdAt;
  return item.chatId > cursor.chatId;
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
