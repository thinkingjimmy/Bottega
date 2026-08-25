/**
 * [INPUT]: Depends on the AppStore, ChatStore, ProjectStore and the lifecycle AdmissionGate/IntentStore
 * [OUTPUT]: Provides AppChatSlots, distributes durable edit/use draft as requested by the ID box, and canonical closes slots after creating or initiating a check
 * [POS]: The app module is a single-writer session slot; Just assign conversation ID, without creating canonical chat in advance
 */

import { customAlphabet } from "nanoid";
import {
  type AppChatSlot,
  type AppRecord,
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
  publish(record: AppRecord): void;
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
    const saved = await this.dependencies.apps.update(appId, (current) => ({
      ...current,
      [key]: { id: chatId, state: "canonical" },
    }));
    this.dependencies.publish(saved);
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
      const saved = await this.dependencies.apps.update(app.id, (current) => ({
        ...current,
        editChatSlot,
        activeUseChatSlot,
      }));
      this.dependencies.publish(saved);
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
    const slot = reusable ?? { id: this.createId(), state: "draft" as const };
    if (sameSlot(slot, current)) return { status: "done", receipt: slot };
    const saved = await this.dependencies.apps.update(input.appId, (value) => ({
      ...value,
      [key]: slot,
    }));
    this.dependencies.publish(saved);
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
