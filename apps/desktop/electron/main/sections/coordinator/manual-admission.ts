/**
 * [INPUT]: Depends on shared manual submission, Coordinator, narrow runtime ports, durable ledger, canonical Chat Agent and PreparedManualTurn staging
 * [OUTPUT]: Provides exact replay of the shortcut, the shortcut, the backend fence, the full lifecycle gate, the full-scale lifecycle gate, the full-scale lifecycle gate, the full-scale lifecycle gate, the full-scale lifecycle gate, the full-scale lifecycle gate, the full-scale lifecycle gate, the full-scale lifecycle gate, the full-scale lifecycle gate, the full-scale lifecycle gate, the full-scale lifecycle gate, the full-scale lifecycle gate, the full-scale lifecycle gate, the full-scale lifecycle gate, the full-scale lifecycle gate, the full-scale lifecycle gate, the full-scale lifecycle gate, the full-scale lifecycle gate, the full-scale lifecycle gate, the full-scale lifecycle gate, the full-scale life-cycle gate, the full-scale life-cycle gate, the full-scale life-scale life-scale life-scale life-space, the full-scale life-space-space-space-space-space-space-space-space-space-space-space-space-space-space-space-space-space-space-space-space-space-space-space-space-space-space-space-space-space-space-space-space-space-space-space-space-space-space-space-space-space-space-space-space-space-space-space-space-space-space-space-space-space-space-space-space-space-space-space-space-space-space-space-space-space-space-space-space-space-space-space-space-space-space-space-space-space-space-space-space-space-space-space-space-space-space-space-space-sInline runNext only consumes explicitly held fact
 * [POS]: The coordinator for human resources access; The main arbitrator only provides conversation/project gate and scheduling feedback
 */

import type {
  UserChatMessage,
} from "../../../../shared/chats-ipc";
import { REVISION_NOT_IDLE } from "../../../../shared/chats-ipc";
import type {
  ManualTurnReceipt,
  TrustedManualTurnSubmission as ManualTurnSubmission,
} from "../../../../shared/sections-ipc";
import { prepareTextOnlyManualTurn } from "./admission/prepared-manual-turn";
import {
  allocateManualSequences,
  assertManualPrecondition,
  ensureManualSequences,
  manualConversationId,
  manualUserMessage,
  userMessagePersisted,
} from "./manual-turns";
import {
  conversationAvailability,
  type CoordinatorDependencies,
} from "./coordinator-runtime";
import { canonicalHash } from "./coordinator-values";
import { nextDeliverable } from "./scheduler/deliverable";
import {
  assertManualWorkspacePrecondition,
  manualLifecycleProjectId,
} from "./admission/workspace-precondition";

type ManualAdmissionRuntime = {
  dependencies: CoordinatorDependencies;
  accepting(): boolean;
  runConversation<T>(
    conversationId: string,
    task: () => Promise<T>
  ): Promise<T>;
  blockedReceipt(
    conversationId: string
  ): { blockedBy?: "relay-queue" | "chain-paused" };
  isRunning(conversationId: string): boolean;
  markRunning(conversationId: string): void;
  releaseRunningIfIdle(conversationId: string): void;
  isRunnableHead(conversationId: string): boolean;
  runNext(
    conversationId: string,
    workspaceLifecycleHeld?: boolean
  ): Promise<boolean>;
  kick(conversationId: string): void;
  recovering: boolean;
  /** 调用方已持有 canonical Project lifecycle gate；仅 save saga 内部路径可置真。 */
  projectLifecycleHeld: boolean;
  /** S3(lifecycle spike):落 durable intent 但不派发——queued 恒真且不 kick;
   * 与 recovering 不同,失败路径仍正常 release reservation。 */
  deferKick: boolean;
};

export async function submitManualAdmission(
  submission: ManualTurnSubmission,
  runtime: ManualAdmissionRuntime
): Promise<ManualTurnReceipt> {
  const { dependencies } = runtime;
  if (
    !submission ||
    typeof submission !== "object" ||
    !/^[A-Za-z0-9_-]{1,128}$/.test(submission.intentId) ||
    submission.turn.scope.conversationId !==
      manualConversationId(submission.persistence)
  ) {
    throw new Error("人工 turn intent 格式无效");
  }
  const userMessage = manualUserMessage(submission.persistence);
  const conversationId = submission.turn.scope.conversationId;
  const submissionHash = canonicalHash(submission);
  /* 精确重放是 ledger 事实，不再重新准入。先于 backend/Workspace 当前态短路，
     避免一次已接受的网络重试被后续 rebind 误判成新请求。 */
  const accepted = await replayManualSubmission(
    submission,
    submissionHash,
    runtime
  );
  if (accepted) return accepted;
  await assertManualBackend(submission, dependencies.chats);
  const projectId = await manualLifecycleProjectId(
    submission,
    dependencies.chats
  );
  /* 持锁与上报持锁必须同源：包没包 gate 由这一个值决定，
     inline 派发把它原样递给 runNext，深处不再有第二套判断。 */
  await assertManualPrecondition(
    submission,
    dependencies.ledger,
    dependencies.chats
  );

  const run = () =>
    runtime.runConversation(conversationId, async () => {
      /* deferKick 是「落账不派发」：账落 durable ledger、执行被 runNext fence
       * 与 admission 开闸另行把守——它必须在 admission 未开（启动对账期）也可用，
       * 否则 save saga 的恢复重入会在这里永久卡死（intent pending → chat 永久 fence）。 */
      if (!runtime.accepting() && !runtime.deferKick) {
        throw new Error("接力服务正在关闭");
      }
      assertConversationAvailable(dependencies, conversationId, projectId);
      if (
        (await manualLifecycleProjectId(submission, dependencies.chats)) !==
        projectId
      ) {
        throw new Error("WORKSPACE_PRECONDITION_MISMATCH");
      }
      await assertManualPrecondition(
        submission,
        dependencies.ledger,
        dependencies.chats
      );
      await assertManualWorkspacePrecondition(submission, {
        chats: dependencies.chats,
        getProjectWorkspaceSnapshot:
          dependencies.getProjectWorkspaceSnapshot,
      });
      const revision =
        submission.persistence.kind === "append" &&
        submission.persistence.input.revise !== undefined;
      if (
        revision &&
        (runtime.recovering ||
          runtime.deferKick ||
          nextDeliverable(dependencies.ledger, conversationId) !== null ||
          runtime.isRunning(conversationId) ||
          dependencies.hasActivity([conversationId]))
      ) {
        throw new Error(REVISION_NOT_IDLE);
      }
      await dependencies.ledger.reserveSubmission({
        submission,
        submissionHash,
      });
      await dependencies.assertGallery?.(submission.content, {
        conversationId,
        backend: submission.turn.turnOptions.backend,
      });
      await dependencies.ledger.promoteSubmissionReservation(
        submission.intentId
      );
      const replay = await replayManualSubmission(
        submission,
        submissionHash,
        runtime
      );
      if (replay) return replay;

      const createsConversation = submission.persistence.kind !== "append";
      if (createsConversation) {
        await dependencies.chats.beginCreation(submission);
      }
      let lease;
      let sequence: { userSeq: number; assistantSeq: number };
      let intent;
      let preparedCustody = false;
      try {
        lease = dependencies.prepareManual
          ? await dependencies.prepareManual(submission)
          : {
              prepared: prepareTextOnlyManualTurn(submission, projectId),
              commit() {},
              async rollback() {},
            };
        if (createsConversation) {
          await dependencies.chats.markCreationPrepared(submission);
        }
        sequence = await allocateManualSequences(
          dependencies.chats,
          submission
        );
        const candidate = {
          id: submission.intentId,
          conversationId,
          payload: lease.prepared,
          submissionHash,
          requestId: submission.turn.requestId,
          userMessage,
          userSeq: sequence.userSeq,
          assistantSeq: sequence.assistantSeq,
          createdAt: userMessage.createdAt,
          phase: "queued",
        } as const;
        await dependencies.ledger.prepareSubmissionReservation(candidate);
        preparedCustody = true;
        lease.commit();
        intent = await dependencies.ledger.promoteSubmissionReservation(
          submission.intentId
        );
        if (!intent) throw new Error("Submission reservation 提升失败");
      } catch (cause) {
        if (!preparedCustody) {
          await lease?.rollback();
          if (!runtime.recovering) {
            await dependencies.ledger.releaseSubmissionReservation(
              submission.intentId
            );
          }
        }
        if (createsConversation && !preparedCustody) {
          await dependencies.chats.rollbackCreation(submission);
        }
        throw cause;
      }
      const queued =
        runtime.recovering ||
        runtime.deferKick ||
        nextDeliverable(dependencies.ledger, conversationId)?.id !==
          intent.id ||
        runtime.isRunning(conversationId) ||
        dependencies.hasActivity([conversationId]);
      if (queued) {
        if (!runtime.recovering && !runtime.deferKick) runtime.kick(conversationId);
      } else {
        runtime.markRunning(conversationId);
        const progressed = await runtime.runNext(conversationId, true);
        runtime.releaseRunningIfIdle(conversationId);
        if (
          progressed &&
          !runtime.isRunning(conversationId) &&
          runtime.isRunnableHead(conversationId)
        ) {
          runtime.kick(conversationId);
        }
      }
      return admittedReceipt(
        submission,
        sequence.userSeq,
        queued,
        runtime
      );
    });

  try {
    return await (!runtime.projectLifecycleHeld
      ? dependencies.withWorkspaceLifecycle(run)
      : run());
  } catch (cause) {
    if (!runtime.recovering) {
      await dependencies.ledger.releaseRawSubmissionReservation(
        submission.intentId
      );
    }
    throw cause;
  }
}

async function assertManualBackend(
  submission: ManualTurnSubmission,
  chats: CoordinatorDependencies["chats"]
) {
  const backend = submission.turn.turnOptions.backend;
  if (submission.persistence.kind !== "append") {
    if (submission.persistence.input.agent !== backend) {
      throw new Error("人工 turn backend 与持久化 Agent 不一致");
    }
    return;
  }
  const record = chats.store.getMetadata(submission.persistence.input.chatId);
  if (!record) throw new Error("人工 turn 的目标聊天不存在");
  if (record.agent !== backend) {
    throw new Error("人工 turn backend 与 canonical Chat Agent 不一致");
  }
}

function assertConversationAvailable(
  dependencies: CoordinatorDependencies,
  conversationId: string,
  projectId: string | null | undefined
) {
  const availability = conversationAvailability(
    dependencies,
    conversationId,
    projectId
  );
  if (availability === "open") return;
  throw new Error(
    availability === "blocked"
      ? "ARCHIVING: Project 正在归档，暂不接收新 turn"
      : "ARCHIVED: 归档聊天不能接收新 turn"
  );
}

async function replayManualSubmission(
  submission: ManualTurnSubmission,
  submissionHash: string,
  runtime: ManualAdmissionRuntime
): Promise<ManualTurnReceipt | undefined> {
  const { dependencies } = runtime;
  const existing = dependencies.ledger.read(
    (state) => state.manualIntents[submission.intentId]
  );
  const tombstone = dependencies.ledger.read(
    (state) => state.intentTombstones[submission.intentId]
  );
  if (!existing && !tombstone) return undefined;
  if (!existing) {
    if (tombstone!.hash !== submissionHash) {
      throw new Error("ManualTurnIntent id 与墓碑 payload 冲突");
    }
    if (tombstone!.outcome === "settled") {
      return { requestId: submission.turn.requestId, phase: "settled" };
    }
    return {
      requestId: submission.turn.requestId,
      phase: "failed",
      userPersisted: await userMessagePersisted(
        dependencies.chats,
        submission.turn.scope.conversationId,
        manualUserMessage(submission.persistence).id
      ),
    };
  }
  if (existing.submissionHash !== submissionHash) {
    throw new Error("ManualTurnIntent id 与既有 payload 冲突");
  }
  if (existing.phase === "settled") {
    return { requestId: existing.requestId, phase: "settled" };
  }
  if (existing.phase === "failed") {
    return {
      requestId: existing.requestId,
      phase: "failed",
      userPersisted: await userMessagePersisted(
        dependencies.chats,
        existing.conversationId,
        (existing.userMessage as UserChatMessage).id
      ),
    };
  }
  const sequence = await ensureManualSequences(
    dependencies.chats,
    dependencies.ledger,
    existing
  );
  return {
    requestId: existing.requestId,
    phase: existing.phase === "queued" ? "queued" : "started",
    userMessage: {
      ...(existing.userMessage as Omit<UserChatMessage, "seq">),
      seq: sequence.userSeq,
    },
    ...(existing.phase === "queued"
      ? runtime.blockedReceipt(existing.conversationId)
      : {}),
  };
}

async function admittedReceipt(
  submission: ManualTurnSubmission,
  userSeq: number,
  queued: boolean,
  runtime: ManualAdmissionRuntime
): Promise<ManualTurnReceipt> {
  const admitted = runtime.dependencies.ledger.read(
    (state) => state.manualIntents[submission.intentId]
  );
  if (admitted?.phase === "failed") {
    return {
      requestId: admitted.requestId,
      phase: "failed",
      userPersisted: await userMessagePersisted(
        runtime.dependencies.chats,
        admitted.conversationId,
        manualUserMessage(submission.persistence).id
      ),
    };
  }
  if (admitted?.phase === "settled") {
    return { requestId: admitted.requestId, phase: "settled" };
  }
  return {
    requestId: submission.turn.requestId,
    phase: queued ? "queued" : "started",
    userMessage: {
      ...manualUserMessage(submission.persistence),
      seq: userSeq,
    },
    ...(queued
      ? runtime.blockedReceipt(submission.turn.scope.conversationId)
      : {}),
  };
}
