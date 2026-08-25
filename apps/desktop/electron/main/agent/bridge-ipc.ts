/**
 * [INPUT]: Depends on Electron BrowserWindow, Agent IPC DTO/approval decision wording, shared plan-review decision to be made, payload/user-input testing and renderer IPc
 * [OUTPUT]: Provides registerAgentBridgeIpc, which assigns the renderer to the main-owned turn handler after the channel is validated; attach snapshot first unify root/live-sub-bagent image detail and then renderer
 * [POS]: The renderer of the agent sub-module is thin; No turn status, no involvement in coordinator/Agent execution
 */

import type { BrowserWindow } from "electron";
import {
  AGENT_CHANNEL,
  isAgentApprovalDecision,
  type AgentApprovalResponse,
  type ChatActivitySnapshot,
  type SteerAdmission,
  type SteerDecision,
  type SteerIpcReceipt,
  type AgentUserInputResponse,
} from "../../../shared/agent-ipc";
import { planModeAfterPlanReview } from "../../../shared/chat-plan-kind";
import {
  ATTACHMENT_PATTERN,
  assertConversationId,
  validateUserInputResponse,
  validateSteerInput,
} from "../agent-payload-validation";
import { rendererIpc } from "../ipc-registrar";
import type { AgentTurn } from "../backends/types";
import { redactImageDetails } from "../gallery/agent-image-projection";
import type { TokenizedSubscriptionBroker } from "../subscription-broker";
import type {
  TurnEntry,
  TurnRegistry,
} from "../turn-registry";

export type AgentBridgeIpcHandlers = {
  attach(
    conversationId: string,
    attachmentId: string,
    window: BrowserWindow
  ): unknown;
  abandonFatalTurn(conversationId: string): void;
  acknowledgeCleanupFailure(conversationId: string): void;
  listActivity(): ChatActivitySnapshot[];
  send(payload: unknown): Promise<void>;
  retryWithoutSession(requestId: string, retryToken: string): Promise<void>;
  respondApproval(response: AgentApprovalResponse): Promise<void>;
  pendingUserInputQuestionIds(
    requestId: string,
    userInputId: string
  ): string[] | undefined;
  respondUserInput(response: AgentUserInputResponse): void;
  detach(conversationId: string, attachmentId: string, window: BrowserWindow): void;
  cancel(requestId: string): void;
  removeSubscriber(window: BrowserWindow): void;
  steer(input: SteerAdmission): Promise<SteerIpcReceipt>;
  decideSteer(input: SteerDecision): Promise<SteerIpcReceipt>;
  ackSteerIntents(outboxRefs: string[]): Promise<void>;
};

type AgentBridgeIpcRuntime = {
  turns: TurnRegistry<AgentTurn>;
  subscriptions: TokenizedSubscriptionBroker<BrowserWindow>;
  listActivity(): ChatActivitySnapshot[];
  publishState(entry: TurnEntry<AgentTurn>): void;
  clearSafetyLock(backend: TurnEntry<AgentTurn>["backend"]): void;
  send(payload: unknown): Promise<void>;
  retryWithoutSession(requestId: string, retryToken: string): Promise<void>;
  cancel(requestId: string): void;
  steer(input: SteerAdmission): Promise<SteerIpcReceipt>;
  decideSteer(input: SteerDecision): Promise<SteerIpcReceipt>;
  ackSteerIntents(outboxRefs: string[]): Promise<void>;
  steerSnapshot(
    conversationId: string
  ):
    | Promise<import("../../../shared/agent-ipc").SteerOutboxProjection[]>
    | import("../../../shared/agent-ipc").SteerOutboxProjection[];
};

export function createAgentBridgeIpcHandlers(
  runtime: AgentBridgeIpcRuntime
): AgentBridgeIpcHandlers {
  return {
    attach: async (conversationId, attachmentId, window) => {
      runtime.subscriptions.attach(conversationId, attachmentId, window);
      return redactImageDetails({
        ...runtime.turns.attachSnapshot(conversationId),
        steerIntents: await runtime.steerSnapshot(conversationId),
      });
    },
    abandonFatalTurn: (conversationId) => {
      runtime.publishState(runtime.turns.abandonFatalTurn(conversationId));
    },
    acknowledgeCleanupFailure: (conversationId) => {
      const entry = runtime.turns.acknowledgeCleanupFailure(conversationId);
      if (!runtime.turns.hasCleanupFailure(entry.backend)) {
        runtime.clearSafetyLock(entry.backend);
      }
      runtime.publishState(entry);
    },
    listActivity: runtime.listActivity,
    send: runtime.send,
    retryWithoutSession: runtime.retryWithoutSession,
    respondApproval: async (response) => {
      const entry = runtime.turns.byRequest(response.requestId);
      if (!entry?.turn) throw new Error("审批请求已结束");
      /* plan-review 的决策同时改写本轮语义：批准退出 Plan 后，终态
         正文应是实施结果而非计划——settle 前必须让 planRequested 与
         用户的选择一致，否则已实施的 turn 会被误判回 plan 消息。
         approval 副本要在 respond 前取：回执会同步清掉 stamp 表。 */
      const approval = entry.approvals.get(response.approvalId);
      await entry.turn.respondApproval(response.approvalId, response.decision);
      const planRequested = approval
        ? planModeAfterPlanReview(approval, response.decision)
        : undefined;
      if (planRequested !== undefined) entry.planRequested = planRequested;
    },
    pendingUserInputQuestionIds: (requestId, userInputId) => {
      const turn = runtime.turns.byRequest(requestId)?.turn;
      if (!turn?.pendingUserInput || !turn.respondUserInput) return undefined;
      return turn
        .pendingUserInput(userInputId)
        ?.questions.map((question) => question.id);
    },
    respondUserInput: (response) => {
      runtime.turns
        .byRequest(response.requestId)
        ?.turn?.respondUserInput?.(response.userInputId, response.answers);
    },
    detach: (conversationId, attachmentId, window) =>
      runtime.subscriptions.detach(conversationId, attachmentId, window),
    cancel: runtime.cancel,
    removeSubscriber: (window) =>
      runtime.subscriptions.removeSubscriber(window),
    steer: runtime.steer,
    decideSteer: runtime.decideSteer,
    ackSteerIntents: runtime.ackSteerIntents,
  };
}

export function registerAgentBridgeIpc(
  window: BrowserWindow,
  rendererUrl: string,
  handlers: AgentBridgeIpcHandlers
) {
  rendererIpc(window, rendererUrl, "拒绝非主窗口的 Agent 请求")
    .handle(
      AGENT_CHANNEL.turnAttach,
      (rawConversationId, rawAttachmentId) => {
        const conversationId = assertConversationId(rawConversationId);
        if (
          typeof rawAttachmentId !== "string" ||
          !ATTACHMENT_PATTERN.test(rawAttachmentId)
        ) {
          throw new Error("attachmentId 格式无效");
        }
        return handlers.attach(conversationId, rawAttachmentId, window);
      }
    )
    .handle(AGENT_CHANNEL.abandonFatalTurn, (rawConversationId) =>
      handlers.abandonFatalTurn(assertConversationId(rawConversationId))
    )
    .handle(
      AGENT_CHANNEL.acknowledgeCleanupFailure,
      (rawConversationId) =>
        handlers.acknowledgeCleanupFailure(
          assertConversationId(rawConversationId)
        )
    )
    .handle(AGENT_CHANNEL.activityList, () => handlers.listActivity())
    .handle(AGENT_CHANNEL.send, (payload) => handlers.send(payload))
    .handle(AGENT_CHANNEL.steer, (input) => {
      validateSteerInput(input);
      return handlers.steer(input);
    })
    .handle(AGENT_CHANNEL.decideSteer, (input) => {
      const value = input as Partial<SteerDecision> | null;
      if (
        !value ||
        typeof value.outboxRef !== "string" ||
        (value.action !== "resend" && value.action !== "dismiss")
      ) {
        throw new Error("steer 裁决格式无效");
      }
      return handlers.decideSteer(value as SteerDecision);
    })
    .handle(AGENT_CHANNEL.ackSteerIntents, (outboxRefs) => {
      if (
        !Array.isArray(outboxRefs) ||
        outboxRefs.some((ref) => typeof ref !== "string")
      ) {
        throw new Error("steer ack 格式无效");
      }
      return handlers.ackSteerIntents(outboxRefs);
    })
    .handle(
      AGENT_CHANNEL.retryWithoutSession,
      (requestId, retryToken) => {
        if (typeof requestId !== "string" || typeof retryToken !== "string") {
          throw new Error("resume retry 请求格式无效");
        }
        return handlers.retryWithoutSession(requestId, retryToken);
      }
    )
    .handle(AGENT_CHANNEL.respondApproval, (value) => {
      const response = value as Partial<AgentApprovalResponse> | null;
      if (
        !response ||
        typeof response.requestId !== "string" ||
        typeof response.approvalId !== "string" ||
        !isAgentApprovalDecision(response.decision)
      ) {
        throw new Error("审批响应格式无效");
      }
      return handlers.respondApproval(response as AgentApprovalResponse);
    })
    .handle(AGENT_CHANNEL.respondUserInput, (value) => {
      const response = value as Partial<AgentUserInputResponse> | null;
      if (
        !response ||
        typeof response.requestId !== "string" ||
        typeof response.userInputId !== "string"
      ) {
        throw new Error("用户输入响应格式无效");
      }
      const questionIds = handlers.pendingUserInputQuestionIds(
        response.requestId,
        response.userInputId
      );
      if (!questionIds) throw new Error("用户输入请求已过期或不存在");
      validateUserInputResponse(value, questionIds);
      handlers.respondUserInput(value as AgentUserInputResponse);
    })
    .on(AGENT_CHANNEL.turnDetach, (conversationId, attachmentId) => {
      if (typeof conversationId === "string" && typeof attachmentId === "string") {
        handlers.detach(conversationId, attachmentId, window);
      }
    })
    .on(AGENT_CHANNEL.cancel, (requestId) => {
      if (typeof requestId === "string") handlers.cancel(requestId);
    });

  window.once("closed", () => handlers.removeSubscriber(window));
}
