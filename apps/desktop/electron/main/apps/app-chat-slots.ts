/**
 * [INPUT]: Depends on AppStore, ChatStore, ProjectStore, lifecycle AdmissionGate/IntentStore, and the ChatsService canonical App-chat creation port
 * [OUTPUT]: Provides revisioned Edit slots and canonical App Use candidates; force-new Use materializes identity without publishing active residence
 * [POS]: App module identity allocator; only AppNavigationService may commit a force-new Use candidate as the active slot
 */

import { randomUUID } from "node:crypto";
import { customAlphabet } from "nanoid";
import {
  appEditorProjectionOf,
  type AppChatSlot,
  type EnsureAppChatSlotInput,
} from "../../../shared/apps-ipc";
import type { AppChatRole } from "../../../shared/chats-ipc";
import { hasCanonicalChatPlacement } from "../../../shared/placement/facts";
import type { ChatStore } from "../chats/chat-store";
import type { AdmissionGate, SagaResult } from "../lifecycle/admission-gate";
import type { LifecycleIntent } from "../lifecycle/intent-types";
import type { ProjectStore } from "../projects/store/project-store";
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
  left?.id === right?.id &&
  left?.incarnationId === right?.incarnationId &&
  left?.state === right?.state &&
  left?.revision === right?.revision;

export class AppChatSlots {
  private readonly createId: () => string;
  private readonly reuseFlights = new Map<string, Promise<AppChatSlot>>();

  constructor(private readonly dependencies: Dependencies) {
    this.createId =
      dependencies.createId ?? (() => `c${createConversationId()}`);
  }

  ensure(input: EnsureAppChatSlotInput): Promise<AppChatSlot> {
    const mode = input.mode ?? "reuse";
    if (mode === "new") return this.ensureOnce(input, mode);
    const key = `${input.appId}\0${input.role}`;
    const running = this.reuseFlights.get(key);
    if (running) return running;
    const flight = this.ensureOnce(input, mode).finally(() => {
      if (this.reuseFlights.get(key) === flight) {
        this.reuseFlights.delete(key);
      }
    });
    this.reuseFlights.set(key, flight);
    return flight;
  }

  private async ensureOnce(
    input: EnsureAppChatSlotInput,
    mode: "reuse" | "new"
  ): Promise<AppChatSlot> {
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
    const incarnationId = receipt?.incarnationId;
    const revision = receipt?.revision;
    if (
      typeof id !== "string" ||
      typeof incarnationId !== "string" ||
      typeof revision !== "number" ||
      (state !== "draft" && state !== "canonical")
    ) {
      throw new Error("App chat 槽位事务未返回有效 receipt");
    }
    return { id, incarnationId, state, revision };
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
      [key]: {
        id: chatId,
        incarnationId:
          this.dependencies.chats.getIncarnationId(chatId) ?? record[key]!.incarnationId,
        state: "canonical",
        revision: record[key]!.revision + 1,
      },
    }));
  }

  roleOf(chatId: string) {
    return this.dependencies.chats.getAppRole(chatId);
  }

  editAppIdOf(chatId: string) {
    const chat = this.dependencies.chats.list().find((item) => item.id === chatId);
    return chat?.context?.kind === "app-edit" ? chat.context.appId : undefined;
  }

  async reconcile(): Promise<void> {
    for (const app of this.dependencies.apps.list()) {
      const project = this.dependencies.projects.findByAppId(app.id);
      if (!project) continue;
      const chats = this.dependencies.chats
        .list()
        .filter((chat) => chat.projectId === project.id)
        .filter(hasCanonicalChatPlacement);
      const editChats = chats.filter(
        (chat) =>
          chat.context.kind === "app-edit" &&
          chat.context.appId === app.id &&
          !chat.readOnlyReason
      );
      const editChatSlot = app.editableSource
        ? this.reconciledSlot(app.editChatSlot, editChats)
        : null;
      const activeUseChatSlot = this.reconciledSlot(
        app.activeUseChatSlot,
        chats.filter(
          (chat) =>
            chat.context.kind === "app-use" && chat.context.appId === app.id
        )
      );
      const shouldActivateEditor = Boolean(app.editableSource && editChatSlot);
      const currentEditor = appEditorProjectionOf(app);
      const editor =
        shouldActivateEditor && currentEditor.editorActivatedAt === null
          ? {
              editorActivatedAt:
                chats
                  .filter((chat) => chat.context.kind === "app-edit")
                  .reduce(
                    (earliest, chat) => Math.min(earliest, chat.createdAt),
                    app.addedAt
                  ),
              editorHiddenAt: currentEditor.editorHiddenAt,
              editorRevision: currentEditor.editorRevision + 1,
            }
          : currentEditor;
      if (
        sameSlot(editChatSlot, app.editChatSlot) &&
        sameSlot(activeUseChatSlot, app.activeUseChatSlot) &&
        JSON.stringify(editor) === JSON.stringify(currentEditor)
      ) {
        continue;
      }
      await this.dependencies.apps.update(app.id, (current) => ({
        ...current,
        editChatSlot,
        activeUseChatSlot,
        editor,
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
    if (
      !record ||
      record.state !== "ready" ||
      (input.role === "edit" && !record.editableSource)
    ) {
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
      incarnationId: randomUUID().replaceAll("-", ""),
      state: "draft" as const,
      revision: (current?.revision ?? 0) + 1,
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
      slot = {
        id: chat.id,
        incarnationId: chat.incarnationId,
        state: "canonical",
        revision: slot.revision,
      };
    }
    if (sameSlot(slot, current)) return { status: "done", receipt: slot };
    if (input.role === "use" && input.mode === "new") {
      return { status: "done", receipt: slot };
    }
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
    return actual === role
      ? {
          ...slot,
          incarnationId:
            this.dependencies.chats.getIncarnationId(slot.id) ?? slot.incarnationId,
          state: "canonical",
        }
      : null;
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
    canonical: Array<{ id: string; incarnationId: string }>
  ): AppChatSlot | null {
    if (current?.state === "draft") {
      return canonical.some((chat) => chat.id === current.id)
        ? {
            id: current.id,
            incarnationId:
              canonical.find((chat) => chat.id === current.id)!.incarnationId,
            state: "canonical",
            revision: current.revision + 1,
          }
        : current;
    }
    if (
      current?.state === "canonical" &&
      canonical.some((chat) => chat.id === current.id)
    ) {
      const exact = canonical.find((chat) => chat.id === current.id)!;
      return exact.incarnationId === current.incarnationId
        ? current
        : {
            ...current,
            incarnationId: exact.incarnationId,
            revision: current.revision + 1,
          };
    }
    const latest = canonical[0];
    return latest
      ? {
          id: latest.id,
          incarnationId: latest.incarnationId,
          state: "canonical",
          revision: (current?.revision ?? 0) + 1,
        }
      : null;
  }
}
