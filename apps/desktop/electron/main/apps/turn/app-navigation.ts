/**
 * [INPUT]: Depends on App/Chat/Project stores, AppChatSlots, canonical placement predicates, and optional residence effect ports
 * [OUTPUT]: Provides main-owned App Use history keyset paging, single-commit switch residence, issuance gate, Editor activation/hide/open, typed destinations, and the remote opens (U06-b) that never take the window, with editor availability telling an App in transition (`app-transitioning`) from one that cannot be edited (U06-c) U06-d: rebuildAvailability (retry only a failed after-edit build; one running or landed converges; never Repair) and currentEditChatId (whatever the App's state). rebuildDecision is the pure rule behind rebuildAvailability. Refuses disabled Use, Edit and Rebuild entries locally and remotely.
 * [POS]: Apps navigation authority; renderer may request intent but cannot forge context, incarnation, Editor facts, or active residence
 */

import { assertAppEnabled, isAppEnabled } from "../service/availability/guard";
import { createHash, randomUUID } from "node:crypto";
import type {
  AppChatSlot,
  AppRecord,
  AppUseHistoryItem,
  AppUseHistoryPage,
  ListAppUseHistoryInput,
  OpenAppEditorChatInput,
  OpenAppEditorInput,
  OpenAppUseChatInput,
} from "../../../../shared/ipc/apps/apps-ipc";
import { appEditorProjectionOf } from "../../../../shared/ipc/apps/apps-ipc";
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
import type { ChatRecord, ChatSummary } from "../../../../shared/ipc/content/chats-ipc";
import type { ProjectStore } from "../../projects/store/project-store";
import type { AppChatSlots } from "./app-chat-slots";
import type { AppStore } from "../store/app-store";
import { errorMessage, statusError } from "../../ipc/errors";

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
  /** Whether a Chat has a turn running; a remote `new` refuses rather than cancel it. */
  isBusy?(chatId: string): boolean;
}>;

/** App states that pass on their own (U06-c): a remote Edit is asked to wait, not told the App cannot be edited. */
const TRANSITIONING = new Set<AppRecord["state"]>(["creating", "installing", "updating", "deleting"]);

export type RebuildAvailability = { code: "app-not-found" | "app-not-editable" | "app-transitioning" | "app-disabled" } | { code: null; action: "retry" | "none" };
/** U06-d's rule for a remote rebuild, on the App and its Project as the stores hold them (see AppNavigationService.rebuildAvailability). */
export function rebuildDecision(app: Pick<AppRecord, "state" | "editableSource"> & { id?: string; enabled?: boolean } | null | undefined, project: { role: string } | null | undefined): RebuildAvailability {
  if (!app) return { code: "app-not-found" };
  if (!isAppEnabled(app)) return { code: "app-disabled" };
  if (!app.editableSource || !project || project.role === "base-custody") return { code: "app-not-editable" };
  if (app.state === "update-failed") return { code: null, action: "retry" };
  if (app.state === "updating" || app.state === "ready") return { code: null, action: "none" };
  return TRANSITIONING.has(app.state) ? { code: "app-transitioning" } : { code: "app-not-editable" };
}

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
    replaceActive: boolean,
    focus = true
  ) {
    const app = this.dependencies.apps.get(appId);
    assertAppEnabled(app);
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
      if (focus) await this.dependencies.focusMain?.(target);
      return { status: "completed" as const, intentId: requestId, target };
    }
    const slot = await this.dependencies.slots.ensure({
      appId,
      role: "use",
      requestId: `${requestId}:slot`,
      mode: "new",
    });
    return this.switchAppUseChat(appId, this.destination(appId, slot), requestId, focus);
  }

  /**
   * U06-b: a phone or Web opens this App's Use Chat. It never takes the computer's window; `current` keeps a live Use Chat,
   * and `new` refuses (`app-busy`) rather than cancel a turn running in it. The command id is the request id.
   */
  async openUseChatRemotely(appId: string, mode: "current" | "new", requestId: string) {
    return this.runExclusive(appId, async () => {
      const app = this.dependencies.apps.get(appId);
      assertAppEnabled(app);
      if (!app || app.state !== "ready") throw new Error("app-not-found");
      const live = app.activeUseChatSlot ? this.liveUseChat(appId, app.activeUseChatSlot) : null;
      if (live && mode === "current") return { chatId: live.id };
      if (live && this.dependencies.isBusy?.(live.id)) throw new Error("app-busy");
      const receipt = await this.newAppUseChatExclusive(appId, requestId, false, false);
      if (receipt.status === "precommit-rejected") throw new Error("app-not-found");
      return { chatId: receipt.target.chatId };
    });
  }

  /**
   * Whether a remote sender may edit this App (U06): null, or the closed code the phone shows. An App being installed, updated or removed
   * is a pause (`app-transitioning`); one with no editable source, a failed or quarantined one, or a base-custody one is not (U06-c).
   */
  editorAvailability(appId: string) {
    const app = this.dependencies.apps.get(appId);
    if (!app) return { code: "app-not-found" as const };
    if (!isAppEnabled(app)) return { code: "app-disabled" as const };
    const project = this.dependencies.projects.findByAppId(appId);
    if (!app.editableSource || !project || project.role === "base-custody") return { code: "app-not-editable" as const };
    if (TRANSITIONING.has(app.state)) return { code: "app-transitioning" as const };
    if (app.state !== "ready") return { code: "app-not-editable" as const };
    return { code: null, projectId: project.id };
  }

  /**
   * U06-d: what a remote rebuild does. Only a failed after-edit build is retried; one running or already landed is the build asked for
   * (two devices' retries converge on one); an App in another transition waits; one that cannot be edited is refused. Never Repair.
   */
  rebuildAvailability(appId: string): RebuildAvailability {
    const app = this.dependencies.apps.get(appId);
    return rebuildDecision(app, app ? this.dependencies.projects.findByAppId(appId) : null);
  }

  /** U06-d: the App's current Edit Chat whatever the App's state (a build is running while its notice is written); null without one. */
  currentEditChatId(appId: string): string | null {
    const project = this.dependencies.projects.findByAppId(appId);
    return project ? this.latestEditChat(appId, project.id)?.id ?? null : null;
  }

  /** U06-b: the latest Edit Chat for a remote sender, read only — the Editor's open/hidden state stays the computer's own. */
  async latestEditorChat(appId: string): Promise<{ chatId: string | null }> {
    const available = this.editorAvailability(appId);
    if (available.code) throw new Error(available.code);
    return { chatId: this.latestEditChat(appId, available.projectId)?.id ?? null };
  }

  private liveUseChat(appId: string, slot: AppChatSlot) {
    const chat = this.dependencies.chats.getMetadata(slot.id);
    return chat && chat.incarnationId === slot.incarnationId && !chat.archivedAt &&
      chat.context.kind === "app-use" && chat.context.appId === appId ? chat : null;
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
      const latest = this.latestEditChat(input.appId, input.projectId, input.exclude);
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

  private latestEditChat(appId: string, projectId: string, exclude?: { id: string; incarnationId: string }) {
    return this.dependencies.chats
      .list()
      .filter(hasCanonicalChatPlacement)
      .filter(
        (chat) =>
          !chat.archivedAt &&
          !chat.readOnlyReason &&
          chat.context.kind === "app-edit" &&
          chat.context.appId === appId &&
          chat.projectId === projectId &&
          (chat.id !== exclude?.id || chat.incarnationId !== exclude.incarnationId)
      )
      .sort((left, right) => right.updatedAt - left.updatedAt || left.id.localeCompare(right.id))[0];
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
      throw statusError(409, "App Edit Project 不存在或已变化");
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
      throw statusError(409, "App Editor destination 已失效");
    }
    return chat;
  }

  private assertEditorApp<T extends { id?: string; enabled?: boolean; state: string; editableSource?: boolean }>(
    app: T | undefined
  ): T {
    assertAppEnabled(app);
    if (!app || !app.editableSource || app.state !== "ready") {
      throw statusError(409, "App 没有可编辑源码");
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
    requestId: string,
    focus = true
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
      if (focus) await this.dependencies.focusMain?.(target);
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
    const settled = await this.runSwitchEffects(intent, focus);
    await this.clearSwitch(appId);
    return settled
      ? { status: "completed", intentId: requestId, target }
      : { status: "recovering", intentId: requestId, target };
  }

  /** 效果全在内存：失败不回滚已落盘的 target，只把回执降级成 recovering。 */
  private async runSwitchEffects(intent: AppUseSwitchIntent, focus = true) {
    try {
      await this.dependencies.revokeOld?.(intent);
      await this.dependencies.drainOld?.(intent);
      await this.dependencies.claimTarget?.(intent);
      if (focus) await this.dependencies.focusMain?.(this.destination(intent.appId, intent.target), intent);
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
    assertAppEnabled(app);
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
      throw statusError(409, "App Use destination 已失效");
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
    throw statusError(409, "APP_USE_HISTORY_CURSOR_INVALID");
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
