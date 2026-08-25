/**
 * [INPUT]: Depends on lifecycle Gate/Intent, App/Project/Chat/Base stores, save-as-app-support Pure rules, durable child promotion, sharing skill Product judgement, conversation Thresholds/availability and transition turn ports that must be clearly held by Project-gate
 * [OUTPUT]: Provides SaveAsAppService/saveAsApp/recover with structured business rejection, including archived source chat, D17 with App licensing, execution of requestId, etc
 * [POS]: The Save as App Business Arrangement layer of the apps module; attachment fence encloses the entire Store queue, parent restores to the already-linked intent as true, child rolled-back through four durable rollback phases, clutching, source chat disappears and compensation fail-forward still clutches
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { customAlphabet, nanoid } from "nanoid";
import type { SessionRef } from "../../../shared/agent-ipc";
import {
  type AppRecord,
  type SaveAsAppInput,
} from "../../../shared/apps-ipc";
import type { ChatRecord } from "../../../shared/chats-ipc";
import type { BasePromotionService } from "../bases/base-promotion-service";
import type { BaseStore } from "../bases/base-store";
import type { ChatStore } from "../chats/chat-store";
import type {
  AdmissionGate,
  SagaResult,
} from "../lifecycle/admission-gate";
import type { LifecycleIntentStore } from "../lifecycle/intent-store";
import type { LifecycleIntent } from "../lifecycle/intent-types";
import type { ProjectsService } from "../projects/projects-service";
import type { ConversationCoordinator } from "../sections/coordinator/conversation-coordinator";
import type { AppStore } from "./app-store";
import type { AppAttachmentFence } from "./attachments/attachment-fence";
import { hasGeneratedSkill } from "./app-skill-status";
import {
  allocatedIdentity,
  appSlug,
  errorText,
  isRollbackPhase,
  needsRollback,
  normalizeInput,
  reached,
  recoverySession,
  recoveryStringOrNull,
  rejected,
  rollbackError,
  type SaveIdentity,
} from "./save-as-app-support";
import {
  baseAppManifest,
  baseAppScaffold,
  createAppSkillPrompt,
} from "./templates";

const createAppId = customAlphabet("abcdefghijklmnopqrstuvwxyz0123456789", 10);

export class SaveAsAppRejectedError extends Error {
  readonly status = 409;

  constructor(
    readonly code: string,
    message: string
  ) {
    super(message);
  }
}

export type SaveAsAppDependencies = {
  store: AppStore;
  projects: ProjectsService;
  chats: ChatStore;
  bases: BaseStore;
  promotion: BasePromotionService;
  intents: LifecycleIntentStore;
  gate: AdmissionGate;
  /** D17 转换准入与 D26 锁序的唯一 owner；与 grant 侧共用同一实例。 */
  fence: AppAttachmentFence;
  coordinator: ConversationCoordinator;
  hasActiveTurn(chatId: string): boolean;
  isChatAvailable(chatId: string): boolean;
  rotateSession(chat: ChatRecord): Promise<void>;
  restoreSession(
    chat: ChatRecord,
    session: SessionRef | null
  ): Promise<void>;
  removeShell(record: AppRecord): Promise<void>;
  enqueueSkillTurnHeld(input: {
    chat: ChatRecord;
    turnIntentId: string;
    prompt: string;
    projectLifecycleHeld: true;
  }): Promise<void>;
  onStatus(record: AppRecord): void;
  now?: () => number;
  allocate?: () => SaveIdentity;
};

export class SaveAsAppService {
  private readonly now: () => number;

  constructor(private readonly dependencies: SaveAsAppDependencies) {
    this.now = dependencies.now ?? Date.now;
  }

  async saveAsApp(input: SaveAsAppInput): Promise<AppRecord> {
    const normalized = normalizeInput(input);
    const outcome = await this.dependencies.gate.admitAndRun(
      {
        kind: "save-as-app",
        requestId: normalized.requestId,
        input: {
          chatId: normalized.chatId,
          name: normalized.name,
          icon: normalized.icon,
        },
        allocate: () =>
          this.dependencies.allocate?.() ?? {
            appId: this.freshAppId(),
            projectId: nanoid(),
            turnIntentId: `save-skill-${nanoid()}`,
            promotionRequestId: `save-promotion-${nanoid()}`,
          },
      },
      (intent) => this.runLocked(intent)
    );
    const appId = receiptAppId(outcome);
    const record = this.dependencies.store.get(appId);
    if (!record) throw new Error("Save as App 已完成但 AppRecord 缺失");
    if (
      outcome.state === "executed" &&
      outcome.result.status === "done"
    ) {
      this.dependencies.coordinator.kickConversation(normalized.chatId);
    }
    return record;
  }

  recover(intent: LifecycleIntent): Promise<SagaResult> {
    return this.runLocked(intent);
  }

  async retrySkill(appId: string) {
    const record = this.dependencies.store.get(appId);
    if (
      record?.state !== "ready" ||
      record.manifest?.kind !== "base" ||
      record.skillStatus?.state !== "failed"
    ) {
      throw new Error("当前 Base App 没有可重试的 skill");
    }
    const project = this.dependencies.projects.store.findByAppId(appId);
    if (!project) throw new Error("Base App 缺少专属 Project");
    const chatId = this.dependencies.chats
      .listByProject(project.id)
      .find((candidate) => candidate === record.editChatSlot?.id);
    if (!chatId) throw new Error("Base App 缺少编辑 chat");
    const turnIntentId = `save-skill-${nanoid()}`;
    const saved = await this.dependencies.projects.runExclusive(() =>
      this.dependencies.coordinator.runConversationExclusive(chatId, async () => {
        if (this.dependencies.hasActiveTurn(chatId)) {
          throw new Error("编辑 chat 仍有进行中的 turn");
        }
        const chat = await this.dependencies.chats.get(chatId);
        if (!chat) throw new Error("编辑 chat 不存在");
        const pending = await this.dependencies.store.update(
          appId,
          (current) => ({
            ...current,
            skillStatus: { state: "pending", turnIntentId },
          })
        );
        try {
          await this.dependencies.enqueueSkillTurnHeld({
            chat,
            turnIntentId,
            prompt: createAppSkillPrompt(
              record.displayName,
              appSlug(record.displayName)
            ),
            projectLifecycleHeld: true,
          });
        } catch (cause) {
          await this.dependencies.store.update(appId, (current) => ({
            ...current,
            skillStatus: { state: "failed", turnIntentId },
          }));
          throw cause;
        }
        return pending;
      })
    );
    this.dependencies.onStatus(saved);
    this.dependencies.coordinator.kickConversation(chatId);
    return saved;
  }

  async recoverPendingSkills() {
    for (const record of this.dependencies.store.list()) {
      if (
        record.state !== "ready" ||
        record.manifest?.kind !== "base" ||
        record.skillStatus?.state !== "pending"
      ) {
        continue;
      }
      if (await hasGeneratedSkill(record)) {
        const done = await this.dependencies.store.update(
          record.id,
          (current) => ({
            ...current,
            skillStatus: current.skillStatus
              ? { ...current.skillStatus, state: "done" }
              : null,
          })
        );
        this.dependencies.onStatus(done);
        continue;
      }
      const project = this.dependencies.projects.store.findByAppId(record.id);
      const chatId = project
        ? this.dependencies.chats
            .listByProject(project.id)
            .find((candidate) => candidate === record.editChatSlot?.id)
        : undefined;
      if (!chatId) {
        await this.markSkillFailed(record.id);
        continue;
      }
      const turnPhase = this.dependencies.coordinator.durableTurnPhase(
        chatId,
        record.skillStatus.turnIntentId
      );
      // 在途 turn 由完成回调结算——盲目重入队会换哈希撞死、且误标 failed 后
      // 真跑完的 turn 再也翻不回 done（结算只认 pending）。
      if (
        turnPhase === "queued" ||
        turnPhase === "appended" ||
        turnPhase === "claimed"
      ) {
        continue;
      }
      // turn 已终结却无产物（AGENTS.md 仍占位）= 真失败，如实开放重试面。
      if (turnPhase === "settled" || turnPhase === "failed") {
        await this.markSkillFailed(record.id);
        continue;
      }
      try {
        await this.dependencies.projects.runExclusive(() =>
          this.dependencies.coordinator.runConversationExclusive(chatId, async () => {
            const chat = await this.dependencies.chats.get(chatId);
            if (!chat) throw new Error("编辑 chat 不存在");
            await this.dependencies.enqueueSkillTurnHeld({
              chat,
              turnIntentId: record.skillStatus!.turnIntentId,
              prompt: createAppSkillPrompt(
                record.displayName,
                appSlug(record.displayName)
              ),
              projectLifecycleHeld: true,
            });
          })
        );
        this.dependencies.coordinator.kickConversation(chatId);
      } catch {
        await this.markSkillFailed(record.id);
      }
    }
  }

  private async runLocked(intent: LifecycleIntent): Promise<SagaResult> {
    const input = intent.input as {
      chatId: string;
      name: string;
      icon: string;
    };
    const identity = allocatedIdentity(intent);
    const run = async (): Promise<SagaResult> => {
      try {
        const result = await this.execute(intent, input, identity);
        return this.compensateRejected(intent, input, identity, result);
      } catch (cause) {
        if ((cause as { status?: number }).status === 409) {
          return this.compensateRejected(intent, input, identity, {
            status: "business-rejected",
            error: {
              code:
                (cause as { code?: string }).code ?? "SAVE_AS_APP_CONFLICT",
              message: errorText(cause),
            },
          });
        }
        throw cause;
      }
    };
    /* D26：attachment gate 必须包住整条 Store queue（gate 只能在 queue 之外取）。
       grant 侧取同一把 key，于是「先 grant 再转换」与「先转换再 grant」只可能有
       一个赢家。 */
    return this.dependencies.fence.runConversion(
      { kind: "chat", chatId: input.chatId },
      () =>
        this.dependencies.projects.runExclusive(() =>
          this.dependencies.coordinator.runConversationExclusive(
            input.chatId,
            run
          )
        )
    );
  }

  private async execute(
    initial: LifecycleIntent,
    input: { chatId: string; name: string; icon: string },
    identity: SaveIdentity
  ): Promise<SagaResult> {
    let intent = initial;
    if (isRollbackPhase(intent.phase)) {
      return this.rollback(
        intent,
        input,
        identity,
        rollbackError(intent)
      );
    }
    const manifest = baseAppManifest(input.name, input.icon);
    const dir = join(this.dependencies.store.appsRoot, identity.appId);
    intent = await this.reconcilePromotionLink(intent, input, identity);

    /* promotion 是不可回头的分水岭：child done 即源 Base 已消费，此后只前进。
     * 前置校验与全部依赖源 chat 的 phase 都收在分水岭之内——过线后源 chat
     * 缺失走 fail-forward（跳过 skill turn 仍推进到 ready），在线复检只会产出
     * 「谎报 rolled-back 却零补偿」的终态（AppRecord 卡 creating、壳全数残留）。 */
    if (!reached(intent, "promoted")) {
      const chat = await this.dependencies.chats.get(input.chatId);
      if (!chat) return rejected("CHAT_NOT_FOUND", "聊天不存在");
      if (!this.dependencies.isChatAvailable(input.chatId)) {
        return rejected("CHAT_UNAVAILABLE", "聊天已归档，不能保存为 App");
      }
      if (this.dependencies.hasActiveTurn(input.chatId)) {
        return rejected("ACTIVE_TURN", "当前聊天仍有进行中的 turn");
      }
      const originalProjectId = recoveryStringOrNull(
        intent,
        "originalProjectId",
        chat.projectId
      );
      if (
        chat.projectId !== originalProjectId &&
        chat.projectId !== identity.projectId
      ) {
        return rejected("PROJECT_CHANGED", "聊天的 Project 归属已变化");
      }
      if (
        chat.projectId &&
        chat.projectId !== identity.projectId &&
        this.dependencies.projects.store.get(chat.projectId)?.workspaceBinding
          .kind === "app"
      ) {
        return rejected("ALREADY_APP_CHAT", "当前聊天已经属于另一个 App");
      }
      /* D17：authoring workspace 只能挂自己那一个 App。既有授权与在途 reference
         必须由用户自己撤销/等待——静默清权会让他毫不知情地失去授权，而「转换后
         再补救」时残迹已经落盘。 */
      const conflict = await this.dependencies.fence.conversionConflict({
        kind: "chat",
        chatId: input.chatId,
      });
      if (conflict) return rejected(conflict.code, conflict.message);
      const promotionStarted =
        typeof intent.recoveryState.promotionIntentId === "string";
      if (
        !promotionStarted &&
        !this.dependencies.bases.get(
          `chat:${input.chatId}`,
          chat.incarnationId
        )
      ) {
        return rejected("BASE_NOT_OWNED", "当前聊天没有可保存的自有 Base");
      }
      intent = await this.runPrePromotionPhases(
        intent,
        input,
        identity,
        chat,
        originalProjectId,
        manifest,
        dir
      );
    }

    if (!reached(intent, "skill-turn-enqueued")) {
      const chat = await this.dependencies.chats.get(input.chatId);
      // 分水岭后源 chat 消失：fail-forward——跳过 skill turn 仍推进到 ready，
      // skillStatus 在下方按账本证据如实落 failed
      if (chat) {
        await this.dependencies.enqueueSkillTurnHeld({
          chat,
          turnIntentId: identity.turnIntentId,
          prompt: createAppSkillPrompt(input.name, appSlug(input.name)),
          projectLifecycleHeld: true,
        });
      }
      intent = await this.dependencies.intents.advance(
        intent.intentId,
        "skill-turn-enqueued"
      );
    }

    // skill turn 的真相在 durable ledger：账本无此 turn 且源 chat 已不在 =
    // 永远不会有人生成产物，pending 会撒谎（无回调可结算），failed 才开放重试面
    const skillAbandoned =
      !this.dependencies.coordinator.durableTurnPhase(
        input.chatId,
        identity.turnIntentId
      ) && !(await this.dependencies.chats.get(input.chatId));
    const ready = await this.dependencies.store.update(
      identity.appId,
      (record) => ({
        ...record,
        displayName: input.name,
        manifest,
        state: "ready",
        lastError: null,
        skillStatus: {
          state: skillAbandoned ? "failed" : "pending",
          turnIntentId: identity.turnIntentId,
        },
      })
    );
    this.dependencies.onStatus(ready);
    return {
      status: "done",
      receipt: { appId: identity.appId },
      value: ready,
    };
  }

  /** 分水岭前的五个 durable phase；源 chat 在此恒存在（调用方已校验）。 */
  private async runPrePromotionPhases(
    initial: LifecycleIntent,
    input: { chatId: string; name: string; icon: string },
    identity: SaveIdentity,
    sourceChat: ChatRecord,
    originalProjectId: string | null,
    manifest: ReturnType<typeof baseAppManifest>,
    dir: string
  ): Promise<LifecycleIntent> {
    let intent = initial;
    let chat = sourceChat;

    if (!reached(intent, "record-created")) {
      if (!this.dependencies.store.hasRetiredId(identity.appId)) {
        await this.dependencies.store.reserveId(identity.appId);
      }
      const existing = this.dependencies.store.get(identity.appId);
      if (!existing) {
        /* generation v2 必须先 seal bytes 再写 AppStore；scaffold phase 之后只做
           幂等确认，不能再让一个 manifest-only record 抢先成为 active。 */
        await mkdir(join(dir, ".agents", "skills"), {
          recursive: true,
          mode: 0o700,
        });
        const stagedFiles = baseAppScaffold(manifest);
        await Promise.all(
          Object.entries(stagedFiles).map(([name, content]) =>
            writeFile(join(dir, name), content, { mode: 0o600 })
          )
        );
        const record: AppRecord = {
          id: identity.appId,
          sourceRepoUrl: null,
          publishedRepoUrl: null,
          origin: "local",
          displayName: input.name,
          dir,
          state: "creating",
          lastError: null,
          agentWarning: null,
          agent: chat.agent,
          maintenanceAgent: chat.agent,
          headlessConsent: null,
          bindingRevision: 0,
          lifecycleRevision: 0,
          domainIdentity: null,
          generations: [],
          generationBinding: {
            bindingRevision: 0,
            active: null,
            drainingGenerationIds: [],
          },
          manifest,
          editChatSlot: { id: input.chatId, state: "canonical" },
          activeUseChatSlot: null,
          skillStatus: {
            state: "pending",
            turnIntentId: identity.turnIntentId,
          },
          addedAt: this.now(),
        };
        this.dependencies.onStatus(await this.dependencies.store.set(record));
      }
      intent = await this.dependencies.intents.advance(
        intent.intentId,
        "record-created"
      );
    }

    if (!reached(intent, "scaffolded")) {
      await mkdir(join(dir, ".agents", "skills"), {
        recursive: true,
        mode: 0o700,
      });
      const files = baseAppScaffold(manifest);
      await Promise.all(
        Object.entries(files).map(([name, content]) =>
          writeFile(join(dir, name), content, { mode: 0o600 })
        )
      );
      intent = await this.dependencies.intents.advance(
        intent.intentId,
        "scaffolded"
      );
    }

    if (!reached(intent, "project-ensured")) {
      await this.dependencies.projects.ensureForAppHeld(
        identity.appId,
        identity.projectId
      );
      intent = await this.dependencies.intents.advance(
        intent.intentId,
        "project-ensured",
        {
          originalProjectId,
          originalSessionRef: chat.session,
        }
      );
    }

    if (!reached(intent, "chat-migrated")) {
      if (chat.projectId !== identity.projectId) {
        await this.dependencies.projects.moveChatProjectHeld(
          input.chatId,
          originalProjectId,
          identity.projectId,
          "edit"
        );
      }
      chat = (await this.dependencies.chats.get(input.chatId))!;
      await this.dependencies.rotateSession(chat);
      intent = await this.dependencies.intents.advance(
        intent.intentId,
        "chat-migrated"
      );
    }

    await this.dependencies.promotion.promoteChild({
      parent: intent,
      chatId: input.chatId,
      projectId: identity.projectId,
      requestId: identity.promotionRequestId,
    });
    return this.dependencies.intents.advance(intent.intentId, "promoted");
  }

  /**
   * child 已 done 时源 Chat Base 必然已删除；父 phase 落盘晚于 child settle，
   * 恢复必须以 durable child 为真相，不能回头重验已消费的源资源。
   * project-written child 仍交给 promoteChild.recover 向前收敛。
   */
  private async reconcilePromotionLink(
    intent: LifecycleIntent,
    input: { chatId: string },
    identity: SaveIdentity
  ) {
    if (reached(intent, "promoted")) return intent;
    const childId = intent.recoveryState.promotionIntentId;
    if (childId === undefined) return intent;
    if (typeof childId !== "string" || !childId) {
      throw new Error("save-as-app promotionIntentId 无效");
    }
    const child = await this.dependencies.intents.getById(childId);
    if (
      !child ||
      child.parentIntentId !== intent.intentId ||
      child.kind !== "base-promotion" ||
      child.requestId !== identity.promotionRequestId ||
      child.input.chatId !== input.chatId ||
      child.input.projectId !== identity.projectId
    ) {
      throw new Error("save-as-app 子升级链接失稳");
    }
    if (child.terminal?.status === "done") {
      return this.dependencies.intents.advance(intent.intentId, "promoted");
    }
    if (child.terminal?.status === "rolled-back") {
      throw Object.assign(
        new Error(
          child.terminal.error?.message ?? "Base 子升级已回滚"
        ),
        {
          status: 409,
          code:
            child.terminal.error?.code ?? "PROMOTION_ROLLED_BACK",
        }
      );
    }
    return intent;
  }

  private async compensateRejected(
    intent: LifecycleIntent,
    input: { chatId: string; name: string; icon: string },
    identity: SaveIdentity,
    result: SagaResult
  ) {
    if (result.status !== "business-rejected") return result;
    const current = await this.dependencies.intents.getById(intent.intentId);
    if (!current || current.terminal || !needsRollback(current.phase)) {
      return result;
    }
    return this.rollback(current, input, identity, result.error);
  }

  private async rollback(
    initial: LifecycleIntent,
    input: { chatId: string },
    identity: SaveIdentity,
    error: { code: string; message: string }
  ): Promise<SagaResult> {
    let intent = initial;
    if (!isRollbackPhase(intent.phase)) {
      intent = await this.dependencies.intents.advance(
        intent.intentId,
        "rollback-started",
        { rollbackError: error }
      );
    }
    const terminalError = rollbackError(intent, error);
    /* 源 chat 已被删除时无可恢复对象:跳过 chat 补偿但继续清理
     * Project/壳,补偿必须收敛而不是永久滞留 pending(fail-forward)。 */
    const chat = await this.dependencies.chats.get(input.chatId);

    if (!reached(intent,"rollback-chat-restored")) {
      if (chat) {
        const originalProjectId = recoveryStringOrNull(
          intent,
          "originalProjectId",
          chat.projectId
        );
        if (chat.projectId === identity.projectId) {
          await this.dependencies.projects.moveChatProjectHeld(
            chat.id,
            identity.projectId,
            originalProjectId,
            null
          );
        } else if (chat.projectId !== originalProjectId) {
          throw new Error("回滚 Save as App 时聊天 Project 归属已变化");
        }
        const restoredChat = await this.dependencies.chats.get(chat.id);
        if (!restoredChat) throw new Error("回滚后聊天不存在");
        const originalSession = recoverySession(intent);
        if (originalSession.recorded) {
          await this.dependencies.restoreSession(
            restoredChat,
            originalSession.value
          );
        }
      }
      intent = await this.dependencies.intents.advance(
        intent.intentId,
        "rollback-chat-restored"
      );
    }

    if (!reached(intent,"rollback-project-removed")) {
      await this.dependencies.projects.rollbackAppProjectHeld(
        identity.projectId,
        identity.appId
      );
      intent = await this.dependencies.intents.advance(
        intent.intentId,
        "rollback-project-removed"
      );
    }

    if (!reached(intent,"rollback-shell-removed")) {
      const record = this.dependencies.store.get(identity.appId);
      if (record) await this.dependencies.removeShell(record);
      await this.dependencies.intents.advance(
        intent.intentId,
        "rollback-shell-removed"
      );
    }
    return rejected(terminalError.code, terminalError.message);
  }

  private freshAppId() {
    let appId = createAppId();
    while (this.dependencies.store.hasRetiredId(appId)) appId = createAppId();
    return appId;
  }

  private async markSkillFailed(appId: string) {
    const failed = await this.dependencies.store.update(appId, (current) => ({
      ...current,
      skillStatus: current.skillStatus
        ? { ...current.skillStatus, state: "failed" }
        : null,
    }));
    this.dependencies.onStatus(failed);
  }
}

function receiptAppId(
  outcome: Awaited<ReturnType<AdmissionGate["admitAndRun"]>>
) {
  const receipt =
    outcome.state === "settled"
      ? outcome.receipt
      : outcome.result.status === "done"
        ? outcome.result.receipt
        : undefined;
  const appId = receipt?.appId;
  if (typeof appId === "string") return appId;
  if (outcome.state === "settled" && outcome.status === "rolled-back") {
    throw new SaveAsAppRejectedError(
      outcome.error?.code ?? "SAVE_AS_APP_REJECTED",
      outcome.error?.message ?? "Save as App 已拒绝"
    );
  }
  if (
    outcome.state === "executed" &&
    outcome.result.status === "business-rejected"
  ) {
    throw new SaveAsAppRejectedError(
      outcome.result.error.code,
      outcome.result.error.message
    );
  }
  throw new Error("Save as App 结果未知，将以同一 requestId 重试");
}
