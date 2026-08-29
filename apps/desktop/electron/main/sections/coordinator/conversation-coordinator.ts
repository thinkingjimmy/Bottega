/**
 * [INPUT]: Depends on relay/state ledgers, Chat and Settings services, Agent main bridge, memory/bootstrap ports, manual-turn helpers, and the canonical residence index
 * [OUTPUT]: Provides durable manual/relay FIFO admission, per-conversation scheduling, delivery, transition/active-turn probes, and queue wake-up operations
 * [POS]: Sections coordinator arbiter; renderer and MCP callers submit intents while this module alone advances Chat commits and Agent claims
 */

import type {
  SteerAdmission,
  SteerDecision,
  SteerIpcReceipt,
  SteerOutboxProjection,
  TurnPersistOutcome,
} from "../../../../shared/agent-ipc";
import type { ChatMessage } from "../../../../shared/chats-ipc";
import type { ManualTurnReceipt, TrustedManualTurnSubmission as ManualTurnSubmission, RelayActionsSnapshot } from "../../../../shared/sections-ipc";
import { ConversationQueue } from "./scheduler/conversation-queue";
import {
  blockedReceiptFor,
  isRunnableDeliverable,
  nextDeliverable,
} from "./scheduler/deliverable";
import type { BuiltinToolContext } from "../../tools/registry";
import { coordinatorResidenceIndex, relayExpectation } from "./coordinator-values";
import {
  runManualTurn,
} from "./manual-turns";
import { submitManualAdmission } from "./manual-admission";
import { reconcileCoordinator } from "./coordinator-reconcile";
import { SectionNoticeOutbox } from "./notice-outbox";
import { type RelayRecord } from "./relay-ledger";
import { deliverRelaySaga } from "./sagas/relay-delivery";
import { SteerOutbox } from "./admission/steer-outbox";
import {
  SectionToolAdmission,
  type RelayToolStatus,
} from "./admission/section-tool-admission";
import {
  cleanupManualCreation,
  conversationAvailability,
  failArchivedConversation,
  finishAnsweredRelay,
  hasPendingProjectCreation,
  manualIntentProjectId,
  pendingProjectConversationIds,
  type CoordinatorDependencies,
} from "./coordinator-runtime";
import {
  prepareTurnResult,
  skillTruncationNoticeId,
  type TurnPreparationEvent,
} from "./turn-preparation";
import type { PreparedManualTurn } from "./admission/prepared-manual-turn";
export type { RelayToolStatus } from "./admission/section-tool-admission";

export class ConversationCoordinator {
  private readonly running = new Set<string>();
  private readonly conversations = new ConversationQueue();
  private readonly chains = new ConversationQueue();
  private readonly notices: SectionNoticeOutbox;
  private readonly steerOutbox: SteerOutbox;
  private readonly sectionTools: SectionToolAdmission;
  private accepting = false;

  constructor(private readonly dependencies: CoordinatorDependencies) {
    this.notices = new SectionNoticeOutbox(
      dependencies.ledger,
      dependencies.chats
    );
    this.steerOutbox = new SteerOutbox({
      ledger: dependencies.ledger,
      chats: dependencies.chats,
      prepareManual: dependencies.prepareManual,
      assertGallery: dependencies.assertGallery,
      registerSteerOperation: dependencies.registerSteerOperation,
      steerTurn: dependencies.steerTurn,
      withWorkspaceLifecycle: dependencies.withWorkspaceLifecycle,
      getProjectWorkspaceSnapshot: dependencies.getProjectWorkspaceSnapshot,
      kick: (conversationId) => this.kick(conversationId),
    });
    this.sectionTools = new SectionToolAdmission({
      ledger: dependencies.ledger,
      chats: dependencies.chats,
      settings: dependencies.settings,
      notices: this.notices,
      accepting: () => this.accepting,
      isConversationAvailable: dependencies.isConversationAvailable,
      isExternalProject: dependencies.isExternalProject,
      withWorkspaceLifecycle: dependencies.withWorkspaceLifecycle,
      hasActivity: dependencies.hasActivity,
      kick: (conversationId) => this.kick(conversationId),
    });
  }

  async initialize(openAdmission = true) {
    const initialization = await this.dependencies.ledger.initialize();
    if (initialization.recovered) {
      this.dependencies.chats.store.pushWarning(initialization.warning);
    }
    await this.dependencies.reconcileMemory?.(this.dependencies.ledger);
    await this.dependencies.reconcileStaging?.(
      this.dependencies.ledger.liveStagingOwners()
    );
    await this.steerOutbox.initialize();
    await reconcileCoordinator({
      ledger: this.dependencies.ledger,
      chats: this.dependencies.chats,
      notices: this.notices,
      finishAnswered: (relay, content) =>
        this.finishAnsweredRelay(relay, content),
      resumeCreate: (intentId) => this.resumeCreateSection(intentId),
      resumeSubmission: (submission) =>
        this.admitManual(submission, () => true, true),
    });
    this.accepting = openAdmission;
    if (openAdmission) this.wakePending();
  }

  stopAdmission() { this.accepting = false; }

  reopenAdmission() {
    this.accepting = true;
    this.wakePending();
  }

  actionsSnapshot(): RelayActionsSnapshot { return this.dependencies.ledger.actionsSnapshot(); }

  onActionsChanged(listener: (snapshot: RelayActionsSnapshot) => void) {
    return this.dependencies.ledger.onActionsChanged(listener);
  }

  async submitManualTurn(
    submission: ManualTurnSubmission
  ): Promise<ManualTurnReceipt> {
    /* Chat 生命周期守卫由 ChatsService 单点判定。 */
    this.dependencies.chats.assertOrdinaryTurnAllowed(
      submission.turn.scope.conversationId
    );
    /* S2 fence:App 过渡期(save-as-app pending)拒绝新的公开 manual 投递——
     * 用户消息未落盘,failed + userPersisted:false 是如实的拒绝形态。 */
    if (await this.isTransitioning(submission.turn.scope.conversationId)) {
      return {
        phase: "failed",
        requestId: submission.turn.requestId,
        userPersisted: false,
      };
    }
    return this.admitManual(submission, () => this.accepting);
  }

  /**
   * S3(lifecycle spike):App 过渡期的 saga 内部投递——绕过 fence 入口检查
   * 落 durable manual intent,但执行被 runNext 的 fence 挡住,天然构成
   * durablePutWithoutKick;requestId 幂等由 admission 既有 existing 分支承接。
   * fence 解除(save intent settle)后由 saga 调 kickConversation 恰好执行一次。
   */
  async submitTransitionTurn(submission: ManualTurnSubmission): Promise<ManualTurnReceipt> {
    return this.admitManual(submission, () => this.accepting, false, true);
  }

  /** 调用方已经持有本 conversation 门闩；禁止再进 ConversationQueue 自锁。 */
  async submitTransitionTurnHeld(
    submission: ManualTurnSubmission, projectLifecycleHeld = false
  ): Promise<ManualTurnReceipt> {
    return this.admitManual(
      submission,
      () => this.accepting,
      false,
      true,
      true,
      projectLifecycleHeld
    );
  }

  /** S3:fence 解除后的显式唤醒(settle → 解 fence → kick 的最后一步)。 */
  kickConversation(conversationId: string) {
    this.kick(conversationId);
  }

  /**
   * App saga 的入队幂等探针：durable manual intent 按 id 应答 phase。
   * saga 派生的 turnIntentId 全局唯一——存在即「已是我们那笔」，重建提交
   * 必然换哈希（createdAt/options/skill ref 都不冻结），按 id 判重才不误炸。
   */
  durableTurnPhase(conversationId: string, intentId: string) {
    const intent = this.dependencies.ledger.read(
      (state) => state.manualIntents[intentId]
    );
    return intent && intent.conversationId === conversationId
      ? intent.phase
      : null;
  }

  /** S2 fence 只读探针:Archive 面对过渡中 conversation 的显式拒绝复用同一真相源。 */
  isTransitioning(conversationId: string): Promise<boolean> {
    return (
      this.dependencies.isConversationTransitioning?.(conversationId) ??
      Promise.resolve(false)
    );
  }

  private admitManual(
    submission: ManualTurnSubmission,
    accepting: () => boolean,
    recovering = false,
    deferKick = false,
    conversationHeld = false,
    projectLifecycleHeld = false
  ): Promise<ManualTurnReceipt> {
    return submitManualAdmission(submission, {
      dependencies: this.dependencies,
      accepting,
      runConversation: (conversationId, task) =>
        conversationHeld
          ? task()
          : this.conversations.run(conversationId, task),
      blockedReceipt: (conversationId) =>
        blockedReceiptFor(this.dependencies.ledger, conversationId),
      isRunning: (conversationId) => this.running.has(conversationId),
      markRunning: (conversationId) => this.running.add(conversationId),
      releaseRunningIfIdle: (conversationId) =>
        this.releaseRunningIfIdle(conversationId),
      isRunnableHead: (conversationId) =>
        this.isRunnableHead(conversationId),
      runNext: (conversationId, workspaceLifecycleHeld) =>
        this.runNext(conversationId, workspaceLifecycleHeld),
      kick: (conversationId) => this.kick(conversationId),
      recovering,
      deferKick,
      projectLifecycleHeld,
    });
  }

  async cancelManualTurn(requestId: string) {
    const intent = this.dependencies.ledger.read((state) =>
      Object.values(state.manualIntents).find(
        (candidate) => candidate.requestId === requestId
      )
    );
    if (!intent || ["settled", "failed"].includes(intent.phase)) return;
    await this.conversations.run(intent.conversationId, async () => {
      const current = this.dependencies.ledger.read(
        (state) => state.manualIntents[intent.id]
      );
      if (!current || ["settled", "failed"].includes(current.phase)) return;
      if (current.phase === "claimed") {
        if (this.running.has(current.conversationId)) {
          this.dependencies.cancelTurn(current.requestId);
          return;
        }
        // 重启后的僵尸 attempt（dispatched/unknown）没有活体 turn 可
        // 取消：终结为 retry-agent-turn capsule，解锁该会话队列。
        const terminated = await this.dependencies.ledger.transitionManual(
          current.id,
          "claimed",
          "failed"
        );
        if (terminated) this.kick(current.conversationId);
        return;
      }
      const failed = await this.dependencies.ledger.transitionManual(
        current.id,
        ["queued", "appended"],
        "failed"
      );
      if (!failed) return;
      await cleanupManualCreation(this.dependencies, current);
      this.running.delete(current.conversationId);
      this.kick(current.conversationId);
    });
  }

  preparedSkillSelections() {
    return Object.values(
      this.dependencies.ledger.snapshot().manualIntents
    ).flatMap((intent) => {
      if (["settled", "failed"].includes(intent.phase) || !intent.payload) {
        return [];
      }
      const prepared = intent.payload as PreparedManualTurn;
      return [{
        requestId: intent.requestId,
        receipt: prepared.skillSelection,
      }];
    });
  }

  residenceIndex() { return coordinatorResidenceIndex(this.dependencies.ledger.snapshot()); }

  async ackManualIntents(intentIds: readonly string[]) {
    await this.dependencies.ledger.ackManualIntents(intentIds);
  }

  ackSubmission(
    ack: import("../../../../shared/submission").SubmissionAck
  ) {
    return this.dependencies.ledger.ackSubmission(ack);
  }

  submissionOutcome(intentId: string) {
    return this.dependencies.ledger.submissionOutcome(intentId);
  }

  onSubmissionOutcome(
    listener: (
      outcome: import("../../../../shared/submission").SubmissionOutcome
    ) => void
  ) {
    return this.dependencies.ledger.onSubmissionOutcome(listener);
  }

  async steerSnapshot(
    conversationId: string
  ): Promise<SteerOutboxProjection[]> {
    return this.steerOutbox.snapshot(conversationId);
  }

  async steer(input: SteerAdmission): Promise<SteerIpcReceipt> {
    return this.steerOutbox.admit(input);
  }

  async decideSteer(input: SteerDecision): Promise<SteerIpcReceipt> {
    return this.steerOutbox.decide(input);
  }

  async ackSteerIntents(outboxRefs: readonly string[]) {
    await this.steerOutbox.ack(outboxRefs);
  }

  async finalizeSteerFenceTimeout(
    requestId: string,
    opEpochs: readonly number[]
  ) {
    await this.steerOutbox.finalizeFenceTimeout(requestId, opEpochs);
  }

  async stopRelayChain(requestId: string) {
    const snapshot = this.dependencies.ledger.snapshot();
    const relay = Object.values(snapshot.relays).find(
      (candidate) => candidate.requestId === requestId
    );
    if (!relay) return "not-relay" as const;
    const chain = snapshot.chains[relay.rootChainId];
    if (!chain) return "stale" as const;
    return (await this.discardRootChain(
      relay.rootChainId,
      chain.pauseEpoch
    )) === "discarded"
      ? "stopped" as const
      : "stale" as const;
  }

  async sendToSection(
    input: { sectionId: string; message: string; expectReply: boolean },
    context: BuiltinToolContext
  ): Promise<RelayToolStatus> {
    return this.conversations.run(input.sectionId, () =>
      this.sectionTools.send(input, context)
    );
  }

  async createSection(
    input: {
      firstMessage: string;
      title?: string;
      agent?: string;
      inheritProject?: boolean;
      contextSectionIds: string[];
    },
    context: BuiltinToolContext
  ): Promise<{
    section_id: string;
    first_turn: "started" | "paused" | "rejected" | "idle";
    detail?: string;
  }> {
    return this.sectionTools.create(input, context);
  }

  async promoteResult(
    input: Parameters<SectionToolAdmission["promote"]>[0],
    context: BuiltinToolContext
  ) {
    return this.sectionTools.promote(input, context);
  }

  private resumeCreateSection(intentId: string) {
    return this.sectionTools.resume(intentId);
  }

  async onTurnSettled(event: {
    conversationId: string;
    requestId: string;
    terminal: "done" | "cancelled" | "error";
    outcome: TurnPersistOutcome;
    assistantMessage?: ChatMessage;
  }) {
    return this.conversations.run(event.conversationId, async () => {
      try {
        await this.steerOutbox.markTurnTerminal(event.requestId);
        await this.notices.settleDependent(
          skillTruncationNoticeId(event.conversationId, event.requestId),
          event.outcome === "stored"
        );
        const manual = this.dependencies.ledger.read((state) =>
          Object.values(state.manualIntents).find(
            (candidate) =>
              candidate.requestId === event.requestId &&
              candidate.phase === "claimed"
          )
        );
        if (manual) {
          const persisted = ["stored", "empty", "missing"].includes(
            event.outcome
          );
          await this.dependencies.ledger.persistManualResult(
            manual.id,
            persisted
          );
          return persisted && event.outcome === "stored";
        }
        const relay = this.dependencies.ledger.read((state) => {
          const found = Object.values(state.relays).find(
            (candidate) =>
              candidate.requestId === event.requestId &&
              candidate.deliveryPhase === "claimed"
          );
          return found
            ? (structuredClone(found) as RelayRecord)
            : undefined;
        });
        if (!relay) return false;
        if (
          event.terminal === "done" &&
          event.outcome === "stored" &&
          event.assistantMessage?.role === "assistant"
        ) {
          const answered = await this.dependencies.ledger.transition(
            relay.id,
            relayExpectation(relay, "claimed"),
            {
              deliveryPhase: "answered",
              terminalOutcome: "done",
              assistantOutbox: {
                terminal: "done",
                message: event.assistantMessage,
                state: "appended",
              },
            }
          );
          if (answered) {
            await this.finishAnsweredRelay(
              answered,
              event.assistantMessage.content
            );
          }
        } else {
          const settled = await this.dependencies.ledger.transition(
            relay.id,
            relayExpectation(relay, "claimed"),
            {
              deliveryPhase: "settled",
              terminalOutcome:
                event.terminal === "cancelled" ? "cancelled" : "failed",
              replyDisposition: "suppressed",
            }
          );
          if (settled) await this.notices.failure(settled);
        }
        return false;
      } finally {
        this.running.delete(event.conversationId);
        this.kick(event.conversationId);
      }
    });
  }

  async onTurnPrepared(event: TurnPreparationEvent) {
    await this.conversations.run(event.conversationId, async () => {
      await prepareTurnResult(this.dependencies, event);
    });
  }

  async continueRelay(
    actionId: string,
    expectedPauseEpoch: number
  ) {
    const rootChainIdValue = this.resolveAction(actionId, expectedPauseEpoch);
    if (!rootChainIdValue) return "stale" as const;
    const result = await this.chains.run(rootChainIdValue, () =>
      this.dependencies.ledger.continueChain(
        rootChainIdValue,
        expectedPauseEpoch
      )
    );
    if (result === "continued") {
      const snapshot = this.dependencies.ledger.snapshot();
      const chain = snapshot.chains[rootChainIdValue];
      const nextWaiting = Object.values(snapshot.relays)
        .filter(
          (relay) =>
            relay.rootChainId === rootChainIdValue &&
            relay.reservationState === "waiting" &&
            relay.pauseEpoch === chain?.pauseEpoch
        )
        .sort(
          (left, right) =>
            left.sequence - right.sequence ||
            left.id.localeCompare(right.id)
        )[0];
      if (nextWaiting) await this.notices.appendPause(nextWaiting);
      for (const relay of Object.values(snapshot.relays)) {
        if (
          relay.rootChainId === rootChainIdValue &&
          relay.deliveryPhase === "queued"
        ) {
          this.kick(relay.target.chatId);
        }
      }
    }
    return result;
  }

  async discardRelay(actionId: string, expectedPauseEpoch: number) {
    const rootChainIdValue = this.resolveAction(actionId, expectedPauseEpoch);
    if (!rootChainIdValue) return "stale" as const;
    return this.discardRootChain(
      rootChainIdValue,
      expectedPauseEpoch
    );
  }

  private async discardRootChain(
    rootChainIdValue: string,
    expectedPauseEpoch: number
  ) {
    return this.chains.run(rootChainIdValue, async () => {
      const relays = Object.values(
        this.dependencies.ledger.snapshot().relays
      ).filter((relay) => relay.rootChainId === rootChainIdValue);
      const result = await this.dependencies.ledger.discardChain(
        rootChainIdValue,
        expectedPauseEpoch
      );
      if (result !== "discarded") return result;
      for (const relay of relays) {
        if (relay.deliveryPhase === "claimed") {
          this.dependencies.cancelTurn(relay.requestId);
        }
        this.running.delete(relay.target.chatId);
        this.kick(relay.target.chatId);
      }
      return result;
    });
  }

  private resolveAction(actionId: string, pauseEpoch: number) {
    const action =
      this.dependencies.ledger.actionsSnapshot().actions[actionId];
    return action?.pauseEpoch === pauseEpoch && action.state === "active"
      ? action.rootChainId
      : undefined;
  }

  private wakePending() {
    for (const id of this.dependencies.ledger.pendingConversationIds()) {
      this.kick(id);
    }
  }

  private kick(conversationId: string) {
    if (!this.accepting) return;
    const head = nextDeliverable(this.dependencies.ledger, conversationId);
    /* 锁序法则 P→C：manual 派发必须在进会话锁之前持全局门。
       head 在排队期间可能换人；runNext 对「manual 是否已持门」严格
       对账，换成 relay 就让位重踢，不带着全局门跑长链。 */
    const workspaceLifecycleHeld = head?.kind === "manual";
    const run = () =>
      this.conversations.run(conversationId, async () => {
        if (
          !this.accepting ||
          this.running.has(conversationId) ||
          this.dependencies.hasActivity([conversationId])
        ) {
          return;
        }
        this.running.add(conversationId);
        const progressed = await this.runNext(
          conversationId,
          workspaceLifecycleHeld
        );
        this.releaseRunningIfIdle(conversationId);
        if (
          progressed &&
          !this.running.has(conversationId) &&
          this.isRunnableHead(conversationId)
        ) {
          this.kick(conversationId);
        }
      });
    void (workspaceLifecycleHeld
      ? this.dependencies.withWorkspaceLifecycle(run)
      : run()
    ).catch((cause) => {
      this.running.delete(conversationId);
      console.error(
        `[section-coordinator] conversation=${conversationId} 调度失败`,
        cause
      );
    });
  }

  private releaseRunningIfIdle(conversationId: string) {
    if (!this.ledgerHasLiveTurn(conversationId)) {
      this.running.delete(conversationId);
    }
  }

  private isRunnableHead(conversationId: string) {
    return isRunnableDeliverable(
      nextDeliverable(this.dependencies.ledger, conversationId)
    );
  }

  private async runNext(
    conversationId: string,
    workspaceLifecycleHeld = false
  ) {
    if (this.dependencies.hasActivity([conversationId])) return false;
    /* S2 fence:过渡期一律不推进(manual/relay 已排队者滞留原位),
     * fence 解除后经 kickConversation 恢复;恢复路径(启动 kick)同受此检查。 */
    if (await this.isTransitioning(conversationId)) return false;
    const deliverable = nextDeliverable(
      this.dependencies.ledger,
      conversationId
    );
    if (!deliverable) return true;
    /* 持锁校验：manual 需要全局门，relay 不该带着它跑长链。
       head 换人就让位重踢；多持与少持都按同一个布尔事实拒绝。 */
    const requiresWorkspaceLifecycle = deliverable.kind === "manual";
    if (requiresWorkspaceLifecycle !== workspaceLifecycleHeld) {
      this.kick(conversationId);
      return false;
    }
    const projectId =
      deliverable.kind === "manual"
        ? manualIntentProjectId(deliverable.intent)
        : undefined;
    const availability = conversationAvailability(
      this.dependencies,
      conversationId,
      projectId
    );
    if (availability === "blocked") return false;
    if (availability === "archived") {
      await this.failArchived(conversationId);
      return true;
    }
    if (deliverable.kind === "manual") {
      if (!["queued", "appended"].includes(deliverable.intent.phase)) {
        return true;
      }
      await this.runManual(deliverable.intent, workspaceLifecycleHeld);
      return true;
    }
    await this.chains.run(deliverable.relay.rootChainId, async () => {
      await deliverRelaySaga(deliverable.relay.id, {
        ledger: this.dependencies.ledger,
        chats: this.dependencies.chats,
        settings: this.dependencies.settings,
        notices: this.notices,
        startTurn: (payload, assistantMessageId, origin, assistantSeq) =>
          this.dependencies.startTurn(
            payload,
            assistantMessageId,
            origin,
            undefined,
            assistantSeq
          ),
      });
    });
    return true;
  }

  runConversationExclusive<T>(conversationId: string, task: () => Promise<T>) {
    return this.conversations.run(conversationId, task);
  }
  pendingProjectConversationIds(projectId: string) {
    return pendingProjectConversationIds(this.dependencies, projectId);
  }
  hasPendingProjectCreation(projectId: string) {
    return hasPendingProjectCreation(this.dependencies, projectId);
  }
  /* ledger 侧活性的唯一口径——hasDurableActiveTurn 与 releaseRunningIfIdle
     共用，禁止再出现第二份「claimed 算不算活」的判断。
     只看 deliveryPhase 非终态：settled 保留 charged 记账（费用已花不退），
     用 reservationState 判活会把正常完成的终态误判成活动 turn。
     manual 的 claimed+unknown 是死亡证明（结果通道已断，无执行者能交付），
     不算活——否则它既占死 running 堵住队列，也永远挡住归档；
     由 failArchived 在归档时收敛为 failed 终态。 */
  private ledgerHasLiveTurn(conversationId: string) {
    return this.dependencies.ledger.readConversation(
      conversationId,
      ({ relays, manualIntents }) =>
        relays.some((relay) =>
          ["claimed", "answered", "replyEnqueued"].includes(
            relay.deliveryPhase
          )
        ) ||
        manualIntents.some(
          (intent) =>
            intent.phase === "claimed" &&
            intent.attempts.at(-1)?.phase !== "unknown"
        )
    );
  }

  hasDurableActiveTurn(conversationId: string) {
    return (
      this.running.has(conversationId) ||
      this.dependencies.hasActivity([conversationId]) ||
      this.ledgerHasLiveTurn(conversationId)
    );
  }

  async failArchived(conversationId: string) {
    await failArchivedConversation(this.dependencies, conversationId);
  }

  resumeConversations(conversationIds: Iterable<string>) {
    for (const conversationId of conversationIds) this.kick(conversationId);
  }

  private async finishAnsweredRelay(relay: RelayRecord, content: string) {
    await finishAnsweredRelay(
      this.dependencies,
      this.notices,
      relay,
      content,
      (conversationId) => this.kick(conversationId)
    );
  }

  /* projectLifecycleHeld 是调用方（runNext 持锁校验后）下传的事实，
     不在此处按 intent 条件重演推断——猜测在 head 换人时会撒谎。 */
  private async runManual(
    intent: Parameters<typeof runManualTurn>[0],
    projectLifecycleHeld: boolean
  ) {
    try {
      await runManualTurn(intent, this.dependencies, projectLifecycleHeld);
    } catch (cause) {
      const current = this.dependencies.ledger.read(
        (state) => state.manualIntents[intent.id]
      );
      if (
        current?.payload !== undefined &&
        ["queued", "appended"].includes(current.phase)
      ) {
        await cleanupManualCreation(this.dependencies, current).catch(
          (cleanupCause) => {
            this.dependencies.chats.store.pushWarning(
              `Manual ${current.id} 创建补偿待重试：${String(cleanupCause)}`
            );
          }
        );
        await this.dependencies.ledger.transitionManual(
          current.id,
          ["queued", "appended"],
          "failed"
        );
      }
      this.running.delete(intent.conversationId);
      this.kick(intent.conversationId);
      console.error(
        `[section-coordinator] manual=${intent.id} 调度失败`,
        cause
      );
    }
  }

}
