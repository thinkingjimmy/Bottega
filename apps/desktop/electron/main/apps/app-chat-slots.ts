/**
 * [INPUT]: Depends on AppStore, ChatStore, ProjectStore, lifecycle AdmissionGate/IntentStore, and the ChatsService canonical App-chat creation port
 * [OUTPUT]: Provides AppChatSlots; edit may retain a durable draft, while use is materialized as a canonical ChatRecord before the slot transaction settles
 * [POS]: App module's single-writer session-slot saga; it never exposes a use conversation id without a durable incarnation
 */

import { customAlphabet } from "nanoid";
import {
  type AppChatSlot,
  type EnsureAppChatSlotInput,
} from "../../../shared/apps-ipc";
import type { AppChatRole } from "../../../shared/chats-ipc";
import type { ChatStore } from "../chats/chat-store";
import type { AdmissionGate, SagaResult } from "../lifecycle/admission-gate";
import type { LifecycleIntent } from "../lifecycle/intent-types";
import type { ProjectStore } from "../projects/project-store";
import type { AppStore } from "./app-store";

const createConversationId = customAlphabet(
  "abcdefghijklmnopqrstuvwxyz0123456789",
  12
);

type Dependencies = {
  apps: AppStore;
  chats: ChatStore;
  projects: ProjectStore;
  gate: AdmissionGate;
  canonicalizeUse(input: {
    intentId: string;
    id: string;
    appId: string;
    projectId: string;
    title: string;
  }): Promise<{ id: string; incarnationId: string }>;
  createId?: () => string;
};

const slotKey = (role: AppChatRole) =>
  role === "edit" ? "editChatSlot" : "activeUseChatSlot";

const sameSlot = (left: AppChatSlot | null, right: AppChatSlot | null) =>
  left?.id === right?.id && left?.state === right?.state;

export class AppChatSlots {
  private readonly createId: () => string;

  constructor(private readonly dependencies: Dependencies) {
    this.createId =
      dependencies.createId ?? (() => `c${createConversationId()}`);
  }

  async ensure(input: EnsureAppChatSlotInput): Promise<AppChatSlot> {
    const mode = input.mode ?? "reuse";
    const outcome = await this.dependencies.gate.admitAndRun(
      {
        kind: "chat-slot",
        requestId: input.requestId,
        input: { appId: input.appId, role: input.role, mode },
        allocate: () => ({
          chatId: this.proposedChatId(input.appId, input.role, mode),
        }),
      },
      (intent) => this.run(intent)
    );
    if (outcome.state === "settled" && outcome.status === "rolled-back") {
      throw new Error(outcome.error?.message ?? "App chat 槽位请求被拒绝");
    }
    if (
      outcome.state === "executed" &&
      outcome.result.status === "business-rejected"
    ) {
      throw new Error(outcome.result.error.message);
    }
    const receipt =
      outcome.state === "settled"
        ? outcome.receipt
        : outcome.result.status === "done"
          ? outcome.result.receipt
          : undefined;
    const id = receipt?.id;
    const state = receipt?.state;
    if (
      typeof id !== "string" ||
      (state !== "draft" && state !== "canonical")
    ) {
      throw new Error("App chat 槽位事务未返回有效 receipt");
    }
    return { id, state };
  }

  recover(intent: LifecycleIntent): Promise<SagaResult> {
    return this.run(intent);
  }

  async markCanonical(
    appId: string,
    role: AppChatRole,
    chatId: string
  ): Promise<void> {
    const record = this.dependencies.apps.get(appId);
    if (!record) return;
    const key = slotKey(role);
    if (record[key]?.id !== chatId || record[key]?.state === "canonical") {
      return;
    }
    await this.dependencies.apps.update(appId, (current) => ({
      ...current,
      [key]: { id: chatId, state: "canonical" },
    }));
  }

  roleOf(chatId: string) {
    return this.dependencies.chats.getAppRole(chatId);
  }

  async reconcile(): Promise<void> {
    for (const app of this.dependencies.apps.list()) {
      const project = this.dependencies.projects.findByAppId(app.id);
      if (!project) continue;
      const chats = this.dependencies.chats
        .list()
        .filter((chat) => chat.projectId === project.id);
      const editChatSlot = this.reconciledSlot(
        app.editChatSlot,
        chats.filter((chat) => chat.appRole === "edit")
      );
      const activeUseChatSlot = this.reconciledSlot(
        app.activeUseChatSlot,
        chats.filter((chat) => chat.appRole === "use")
      );
      if (
        sameSlot(editChatSlot, app.editChatSlot) &&
        sameSlot(activeUseChatSlot, app.activeUseChatSlot)
      ) {
        continue;
      }
      await this.dependencies.apps.update(app.id, (current) => ({
        ...current,
        editChatSlot,
        activeUseChatSlot,
      }));
    }
  }

  private async run(intent: LifecycleIntent): Promise<SagaResult> {
    const input = intent.input as {
      appId: string;
      role: AppChatRole;
      mode: "reuse" | "new";
    };
    const record = this.dependencies.apps.get(input.appId);
    if (!record || record.state === "delete-failed") {
      return {
        status: "business-rejected",
        error: { code: "APP_UNAVAILABLE", message: "App 不可用" },
      };
    }
    if (input.role === "use" && record.manifest?.kind !== "base") {
      return {
        status: "business-rejected",
        error: {
          code: "USE_CHAT_UNSUPPORTED",
          message: "只有 Base App 提供使用 chat",
        },
      };
    }
    if (input.role === "edit" && input.mode === "new") {
      return {
        status: "business-rejected",
        error: {
          code: "EDIT_SLOT_SINGLETON",
          message: "编辑 chat 收敛为唯一会话，不支持强制新建",
        },
      };
    }
    const key = slotKey(input.role);
    const current = record[key];
    const reusable =
      input.mode === "reuse" && current
        ? this.refreshState(current, input.role)
        : null;
    const allocatedChatId = intent.allocated.chatId;
    if (!reusable && typeof allocatedChatId !== "string") {
      throw new Error("App chat 槽位 intent 缺少冻结 chatId");
    }
    let slot = reusable ?? {
      id: allocatedChatId as string,
      state: "draft" as const,
    };
    if (input.role === "use" && slot.state === "draft") {
      const project = this.dependencies.projects.findByAppId(input.appId);
      if (!project) {
        return {
          status: "business-rejected",
          error: {
            code: "APP_PROJECT_MISSING",
            message: "App 使用 chat 缺少绑定 Project",
          },
        };
      }
      const chat = await this.dependencies.canonicalizeUse({
        intentId: intent.intentId,
        id: slot.id,
        appId: input.appId,
        projectId: project.id,
        title: record.displayName,
      });
      if (chat.id !== slot.id || !chat.incarnationId) {
        throw new Error("App use chat canonical identity 与槽位不一致");
      }
      slot = { id: chat.id, state: "canonical" };
    }
    if (sameSlot(slot, current)) return { status: "done", receipt: slot };
    await this.dependencies.apps.update(input.appId, (value) => ({
      ...value,
      [key]: slot,
    }));
    return { status: "done", receipt: slot };
  }

  private refreshState(
    slot: AppChatSlot,
    role: AppChatRole
  ): AppChatSlot | null {
    const actual = this.dependencies.chats.getAppRole(slot.id);
    if (actual === undefined) return slot.state === "draft" ? slot : null;
    return actual === role ? { id: slot.id, state: "canonical" } : null;
  }

  private proposedChatId(
    appId: string,
    role: AppChatRole,
    mode: "reuse" | "new"
  ) {
    const current = this.dependencies.apps.get(appId)?.[slotKey(role)] ?? null;
    const reusable = mode === "reuse" && current
      ? this.refreshState(current, role)
      : null;
    return reusable?.id ?? this.createId();
  }

  private reconciledSlot(
    current: AppChatSlot | null,
    canonical: Array<{ id: string }>
  ): AppChatSlot | null {
    if (current?.state === "draft") {
      return canonical.some((chat) => chat.id === current.id)
        ? { id: current.id, state: "canonical" }
        : current;
    }
    if (
      current?.state === "canonical" &&
      canonical.some((chat) => chat.id === current.id)
    ) {
      return current;
    }
    const latest = canonical[0];
    return latest ? { id: latest.id, state: "canonical" } : null;
  }
}
