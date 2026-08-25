/**
 * [INPUT]: Depends on Agent/Chat/Settings/Relay ledger Narrow ports, Notice outbox and stable ID/expectation pure function
 * [OUTPUT]: Provides CoordinatorDependencies ((commanded universal Workspace lifecycle gate, Workspace snapshot with canonical manual, synchronized void after unloading, derivative loop)
 * [POS]: the running time of sections/coordinator; Remove the main arbitrator from the combination root port and the derivative side effects of the response relay
 */

import type { AgentSendPayload } from "../../../../shared/agent-ipc";
import type { SubmissionContentV1 } from "../../../../shared/submission";
import type {
  TrustedManualTurnSubmission as ManualTurnSubmission,
} from "../../../../shared/sections-ipc";
import type { TurnOrigin } from "../../agent/bridge-types";
import type { ResolvedAgentInput } from "../../backends/types";
import type { ChatsService } from "../../chats/chats-service";
import type { SettingsStore } from "../../settings-store";
import {
  releasePreparedStaging,
  type PreparedManualLease,
  type PreparedManualTurn,
} from "./admission/prepared-manual-turn";
import { relayExpectation, stableId } from "./coordinator-values";
import type { SectionNoticeOutbox } from "./notice-outbox";
import type {
  ManualTurnIntent,
  RelayLedger,
  RelayRecord,
} from "./relay-ledger";
import type { ProjectWorkspaceSnapshot } from "./admission/workspace-precondition";
import { steerDerivedIntentId } from "./admission/steer-projection";

type ConversationAvailability = "open" | "blocked" | "archived";

export type CoordinatorDependencies = {
  ledger: RelayLedger;
  chats: ChatsService;
  settings: SettingsStore;
  /** canonical user 成功落盘后的同步 void 幂等派生；失败不得回滚已持久消息。 */
  onManualPersisted?: (input: {
    chatId: string;
    incarnationId: string;
    messageId: string;
    content: SubmissionContentV1;
  }) => void;
  /**
   * S2(lifecycle spike):conversation 过渡 fence——该 chat 存在 pending 的
   * save-as-app intent 时为 true(durable 真相源就是 lifecycle journal,不设第二份状态)。
   * 缺省视为 false;fence 期间公开 manual 投递被拒、runNext 不推进(已排队者滞留),
   * saga 经 submitTransitionTurn 落队、settle 解 fence 后 kickConversation 恰好执行一次。
   */
  isConversationTransitioning?: (conversationId: string) => Promise<boolean>;
  /**
   * admissionHeld:调用方已持有 project lifecycle gate(= projects 排他队列)。
   * agent-bridge 的 withConversationAdmission 复用同一把锁,不透传这个事实
   * 就是自锁死——锁的持有状态只能由持有者下传,不允许在深处按条件重演推断。
   */
  startTurn(
    payload: AgentSendPayload,
    assistantMessageId: string,
    origin: TurnOrigin,
    resolvedInput?: ResolvedAgentInput,
    assistantSeq?: number,
    admissionHeld?: boolean
  ): Promise<void>;
  cancelTurn(requestId: string): void;
  hasActivity(conversationIds: Iterable<string>): boolean;
  reconcileMemory?: (ledger: RelayLedger) => Promise<void>;
  prepareManual?: (
    submission: ManualTurnSubmission
  ) => Promise<PreparedManualLease>;
  assertGallery?: (
    content: SubmissionContentV1,
    context: {
      conversationId: string;
      backend: AgentSendPayload["turnOptions"]["backend"];
    }
  ) => Promise<void>;
  reconcileStaging?: (liveOwners: ReadonlySet<string>) => Promise<void>;
  isConversationAvailable?: (conversationId: string) => boolean;
  getConversationAvailability?: (
    conversationId: string,
    projectId?: string | null
  ) => ConversationAvailability;
  withWorkspaceLifecycle: <T>(task: () => Promise<T>) => Promise<T>;
  getProjectWorkspaceSnapshot?: (
    projectId: string
  ) => ProjectWorkspaceSnapshot | undefined;
  isExternalProject?: (projectId: string) => boolean;
  registerSteerOperation?(requestId: string): {
    epoch: number;
    signal: AbortSignal;
    conversationId: string;
    payload: AgentSendPayload;
    assertCurrent(): void;
    finish(): void;
  };
  steerTurn?(
    requestId: string,
    input: ResolvedAgentInput["input"]
  ): Promise<import("../../backends/types").AdapterSteerOutcome>;
};

export function manualIntentProjectId(
  intent: Pick<ManualTurnIntent, "payload">
) {
  if (intent.payload === undefined) return undefined;
  const projectId = (intent.payload as PreparedManualTurn).lifecycleProjectId;
  if (projectId === null) return null;
  if (/^[A-Za-z0-9_-]{1,128}$/.test(projectId)) return projectId;
  throw new Error("PreparedManualTurn 缺少合法 lifecycle Project 身份");
}

export function pendingProjectConversationIds(
  dependencies: CoordinatorDependencies,
  projectId: string
) {
  return dependencies.ledger.read((state) => [
    ...Object.values(state.manualIntents)
      .filter((intent) => manualIntentProjectId(intent) === projectId)
      .map((intent) => intent.conversationId),
    ...Object.values(state.createIntents)
      .filter(
        (intent) =>
          intent.projectId === projectId &&
          !["done", "failed"].includes(intent.sagaPhase)
      )
      .map((intent) => intent.sectionId),
  ]);
}

export function hasPendingProjectCreation(
  dependencies: CoordinatorDependencies,
  projectId: string
) {
  return dependencies.ledger.read((state) =>
    Object.values(state.createIntents).some(
      (intent) =>
        intent.projectId === projectId &&
        !["done", "failed"].includes(intent.sagaPhase)
    )
  );
}

export function conversationAvailability(
  dependencies: CoordinatorDependencies,
  conversationId: string,
  projectId?: string | null
): ConversationAvailability {
  if (dependencies.getConversationAvailability) {
    return dependencies.getConversationAvailability(conversationId, projectId);
  }
  return dependencies.isConversationAvailable?.(conversationId) === false
    ? "archived"
    : "open";
}

export async function cleanupManualCreation(
  dependencies: CoordinatorDependencies,
  intent: Pick<ManualTurnIntent, "id" | "conversationId" | "payload">
) {
  if (intent.payload === undefined) return;
  const prepared = intent.payload as PreparedManualTurn;
  /* transferred Steer 在 renderer 安装 derived outcome 前仍是 recovery owner。
     derived manual 失败不能先删共享 staging，否则 reload 只剩一个空身份。 */
  const retainedBySteer = dependencies.ledger.read((state) =>
    Object.values(state.steerIntents).some(
      (steer) =>
        steer.phase === "transferred" &&
        steer.ackedAt === undefined &&
        steerDerivedIntentId(steer.outboxRef) === intent.id
    )
  );
  if (!retainedBySteer) await releasePreparedStaging(prepared);
  if (prepared.persistence.kind !== "append") {
    await dependencies.chats.rollbackCreationById(intent.conversationId);
  }
}

export async function failArchivedConversation(
  dependencies: CoordinatorDependencies,
  conversationId: string
) {
  const pending = dependencies.ledger.read((state) =>
    Object.values(state.manualIntents).filter(
      (intent) =>
        intent.conversationId === conversationId &&
        ["queued", "appended"].includes(intent.phase)
    )
  );
  await dependencies.ledger.failArchived(conversationId);
  for (const intent of pending) {
    await cleanupManualCreation(dependencies, intent).catch((cause) => {
      dependencies.chats.store.pushWarning(
        `归档后 Chat Home ${conversationId} 补偿待重试：${String(cause)}`
      );
    });
  }
}

export async function finishAnsweredRelay(
  dependencies: CoordinatorDependencies,
  notices: SectionNoticeOutbox,
  relay: RelayRecord,
  content: string,
  kick: (conversationId: string) => void
) {
  const replyId = stableId("relay", `reply:${relay.id}`);
  const result = await dependencies.ledger.completeAnsweredRelay(
    relay.id,
    relayExpectation(relay, "answered"),
    relay.expectReply
      ? {
          id: replyId,
          rootChainId: relay.rootChainId,
          source: relay.target,
          target: relay.source,
          message: content,
          expectReply: false,
          createdAt: Date.now(),
          requestId: stableId("request", replyId),
          userMessageId: stableId("user", replyId),
          assistantMessageId: stableId("assistant", replyId),
          limit: dependencies.settings.get().autoRelayLimit,
        }
      : undefined
  );
  if (result.status === "stale" || !result.reply) return;
  if (result.reply.reservationState === "waiting") {
    await notices.appendPause(result.reply);
  } else {
    kick(result.reply.target.chatId);
  }
}
