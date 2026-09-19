/**
 * [INPUT]: Depends on original Agent runtime handlers, trusted renderer residency, exact interaction stamps and durable control receipts.
 * [OUTPUT]: Provides local/remote first-writer approval, user-input and cancel handlers plus original Steer routing.
 * [POS]: Agent IPC and main control adapter; backend behavior remains owned by the original runtime.
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
import { surfaceWindowController } from "../window/surfaces/surface-window-controller";
import type { TrustedRendererContext } from "../window/surfaces/trusted-renderer-context";
import { runAgentControl, agentControlGeneration, agentControlUnresolved, assertAgentControlOrigin, type TrustedControl, type ControlResult } from "./controls/decisions";

export type AgentBridgeIpcHandlers = {
  attach(
    conversationId: string,
    attachmentId: string,
    window: BrowserWindow
  ): unknown;
  abandonFatalTurn(conversationId: string): void;
  acknowledgeCleanupFailure(conversationId: string): void;
  listActivity(): ChatActivitySnapshot[];
  conversationForRequest(requestId: string): string | undefined;
  conversationForOutboxRef(outboxRef: string): string | undefined;
  abandonResumeFailure(requestId: string, retryToken: string, trusted?: TrustedControl): Promise<void>;
  retryWithoutSession(requestId: string, retryToken: string, trusted?: TrustedControl): Promise<void>;
  retrySameSession(requestId: string, retryToken: string, trusted?: TrustedControl): Promise<void>;
  respondApproval(response: AgentApprovalResponse, trusted?: TrustedControl): Promise<ControlResult>;
  pendingUserInputQuestionIds(
    requestId: string,
    userInputId: string
  ): string[] | undefined;
  respondUserInput(response: AgentUserInputResponse, trusted?: TrustedControl): Promise<ControlResult>;
  detach(conversationId: string, attachmentId: string, window: BrowserWindow): void;
  cancel(requestId: string, trusted?: TrustedControl): Promise<ControlResult>;
  removeSubscriber(window: BrowserWindow): void;
  steer(input: SteerAdmission, trusted?: TrustedControl): Promise<SteerIpcReceipt>;
  decideSteer(input: SteerDecision): Promise<SteerIpcReceipt>;
  ackSteerIntents(outboxRefs: string[]): Promise<void>;
};

type AgentBridgeIpcRuntime = {
  turns: TurnRegistry<AgentTurn>;
  attachSnapshot(conversationId: string): ReturnType<TurnRegistry<AgentTurn>["attachSnapshot"]>;
  subscriptions: TokenizedSubscriptionBroker<BrowserWindow>;
  listActivity(): ChatActivitySnapshot[];
  publishState(entry: TurnEntry<AgentTurn>): void;
  clearSafetyLock(backend: TurnEntry<AgentTurn>["backend"]): void;
  retryWithoutSession(requestId: string, retryToken: string, trusted?: TrustedControl): Promise<void>;
  retrySameSession(requestId: string, retryToken: string, trusted?: TrustedControl): Promise<void>;
  cancel(requestId: string): void;
  steer(input: SteerAdmission): Promise<SteerIpcReceipt>;
  decideSteer(input: SteerDecision): Promise<SteerIpcReceipt>;
  ackSteerIntents(outboxRefs: string[]): Promise<void>;
  steerSnapshot(
    conversationId: string
  ):
    | Promise<import("../../../shared/agent-ipc").SteerOutboxProjection[]>
    | import("../../../shared/agent-ipc").SteerOutboxProjection[];
  conversationForOutboxRef(outboxRef: string): string | undefined;
};

export function createAgentBridgeIpcHandlers(
  runtime: AgentBridgeIpcRuntime
): AgentBridgeIpcHandlers {
  const retry = async (mode: "retrySameSession" | "retryWithoutSession" | "abandonResumeFailure", requestId: string, retryToken: string, trusted?: TrustedControl) => {
    const entry = runtime.turns.byRequest(requestId); if (!entry) throw new Error("request-not-active");
    const key = `recovery:${retryToken}`, generation = trusted?.generation ?? agentControlGeneration(entry, key);
    await runAgentControl({ entry, generation, trusted, key, payload: { requestId, retryToken, mode },
      verify: () => { if (runtime.turns.byRequest(requestId) !== entry || entry.phase !== "resume-failed" || entry.resumeRetryToken !== retryToken || entry.sourceTerminal) throw new Error("interaction-expired"); },
      apply: () => mode === "abandonResumeFailure" ? runtime.cancel(requestId) : runtime[mode](requestId, retryToken, trusted) });
  };
  return {
    attach: async (conversationId, attachmentId, window) => {
      runtime.subscriptions.attach(conversationId, attachmentId, window);
      return redactImageDetails({
        ...runtime.attachSnapshot(conversationId),
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
    conversationForRequest: (requestId) =>
      runtime.turns.byRequest(requestId)?.conversationId,
    conversationForOutboxRef: runtime.conversationForOutboxRef,
    abandonResumeFailure: (requestId, token, trusted) => retry("abandonResumeFailure", requestId, token, trusted),
    retryWithoutSession: (requestId, token, trusted) => retry("retryWithoutSession", requestId, token, trusted),
    retrySameSession: (requestId, token, trusted) => retry("retrySameSession", requestId, token, trusted),
    respondApproval: async (response, trusted) => {
      const entry = runtime.turns.byRequest(response.requestId);
      if (!entry?.turn) throw new Error("审批请求已结束");
      /* plan-review 的决策同时改写本轮语义：批准退出 Plan 后，终态
         正文应是实施结果而非计划——settle 前必须让 planRequested 与
         用户的选择一致，否则已实施的 turn 会被误判回 plan 消息。
         approval 副本要在 respond 前取：回执会同步清掉 stamp 表。 */
      return runAgentControl({ entry, trusted, key: `approval:${response.approvalId}`, payload: response,
        verify: () => {
          const approval = entry.approvals.get(response.approvalId);
          if (runtime.turns.byRequest(response.requestId) !== entry || entry.fenceClosed || entry.sourceTerminal || trusted && !approval) throw new Error("interaction-expired");
          if (trusted && approval && (response.decision === "accept-for-session" && !approval.canAcceptForSession ||
            (approval.choices?.length || response.decision.startsWith("choice:")) && !approval.choices?.some(choice => choice.decision === response.decision))) throw new Error("interaction-expired");
        }, apply: async () => {
          const approval = entry.approvals.get(response.approvalId);
          await entry.turn!.respondApproval(response.approvalId, response.decision);
          const planRequested = approval ? planModeAfterPlanReview(approval, response.decision) : undefined;
          if (planRequested !== undefined) entry.planRequested = planRequested;
        } });
    },
    pendingUserInputQuestionIds: (requestId, userInputId) => {
      const turn = runtime.turns.byRequest(requestId)?.turn;
      if (!turn?.pendingUserInput || !turn.respondUserInput) return undefined;
      return turn
        .pendingUserInput(userInputId)
        ?.questions.map((question) => question.id);
    },
    respondUserInput: async (response, trusted) => {
      const entry = runtime.turns.byRequest(response.requestId);
      if (!entry?.turn?.respondUserInput) throw new Error("interaction-expired");
      return runAgentControl({ entry, trusted, key: `input:${response.userInputId}`, payload: response,
        verify: () => {
          const pending = entry.turn?.pendingUserInput?.(response.userInputId);
          const expiresAt = entry.userInputs.get(response.userInputId)?.expiresAt;
          if (runtime.turns.byRequest(response.requestId) !== entry || entry.fenceClosed || entry.sourceTerminal || !pending ||
            expiresAt !== undefined && Date.now() >= expiresAt || trusted && pending.questions.some(question => question.isSecret)) throw new Error("interaction-expired");
          validateUserInputResponse(response, pending.questions.map(question => question.id));
        }, apply: () => entry.turn!.respondUserInput!(response.userInputId, response.answers) });
    },
    detach: (conversationId, attachmentId, window) =>
      runtime.subscriptions.detach(conversationId, attachmentId, window),
    cancel: async (requestId, trusted) => {
      const entry = runtime.turns.byRequest(requestId); if (!entry) throw new Error("request-not-active");
      /* Stop shares the recovery interaction so a remote abandon cannot be applied twice, but a
         recovery whose winner is settled non-applied would make Stop permanently `outcome-unknown`. */
      const recovery = entry.resumeRetryToken ? `recovery:${entry.resumeRetryToken}` : undefined;
      const key = recovery && !agentControlUnresolved(entry, recovery, agentControlGeneration(entry, recovery)) ? recovery : "cancel";
      return runAgentControl({ entry, trusted, generation: trusted?.generation ?? agentControlGeneration(entry, key), key, payload: { requestId },
        verify: () => { if (runtime.turns.byRequest(requestId) !== entry || entry.sourceTerminal) throw new Error("request-not-active"); },
        apply: () => runtime.cancel(requestId) });
    },
    removeSubscriber: (window) =>
      runtime.subscriptions.removeSubscriber(window),
    steer: (input, trusted) => { assertAgentControlOrigin(input.outboxRef, trusted); return runtime.steer(input); },
    decideSteer: runtime.decideSteer,
    ackSteerIntents: runtime.ackSteerIntents,
  };
}

export function registerAgentBridgeIpc(
  window: BrowserWindow,
  rendererUrl: string,
  handlers: AgentBridgeIpcHandlers
) {
  mainHandlers = handlers;
  const assertConversation = (
    context: TrustedRendererContext,
    conversationId: string
  ) => {
    surfaceWindowController.assertConversationMutation(context, conversationId);
    return conversationId;
  };
  const assertRequest = (context: TrustedRendererContext, requestId: unknown) => {
    if (typeof requestId !== "string") throw new Error("requestId 格式无效");
    const conversationId = handlers.conversationForRequest(requestId);
    if (!conversationId) throw new Error("请求已结束");
    assertConversation(context, conversationId);
    return requestId;
  };
  const assertOutbox = (context: TrustedRendererContext, outboxRef: string) => {
    const conversationId = handlers.conversationForOutboxRef(outboxRef);
    if (!conversationId) throw new Error("steer outbox 不存在");
    assertConversation(context, conversationId);
  };
  rendererIpc(rendererUrl, "拒绝非主窗口的 Agent 请求")
    .roles("main", "app-window")
    .handleWithContext(
      AGENT_CHANNEL.turnAttach,
      (context, rawConversationId, rawAttachmentId) => {
        const conversationId = assertConversationId(rawConversationId);
        if (
          typeof rawAttachmentId !== "string" ||
          !ATTACHMENT_PATTERN.test(rawAttachmentId)
        ) {
          throw new Error("attachmentId 格式无效");
        }
        surfaceWindowController.bindConversation(context, conversationId);
        return handlers.attach(
          conversationId,
          rawAttachmentId,
          context.window as BrowserWindow
        );
      }
    )
    .handleWithContext(AGENT_CHANNEL.abandonFatalTurn, (context, rawConversationId) =>
      handlers.abandonFatalTurn(
        assertConversation(context, assertConversationId(rawConversationId))
      )
    )
    .handleWithContext(
      AGENT_CHANNEL.acknowledgeCleanupFailure,
      (context, rawConversationId) =>
        handlers.acknowledgeCleanupFailure(
          assertConversation(context, assertConversationId(rawConversationId))
        )
    )
    .roles("main")
    .handle(AGENT_CHANNEL.activityList, () => handlers.listActivity())
    .roles("main", "app-window")
    .handleWithContext(AGENT_CHANNEL.steer, (context, input) => {
      validateSteerInput(input);
      assertRequest(context, input.requestId);
      return handlers.steer(input);
    })
    .handleWithContext(AGENT_CHANNEL.decideSteer, (context, input) => {
      const value = input as Partial<SteerDecision> | null;
      if (
        !value ||
        typeof value.outboxRef !== "string" ||
        (value.action !== "resend" && value.action !== "dismiss")
      ) {
        throw new Error("steer 裁决格式无效");
      }
      assertOutbox(context, value.outboxRef);
      return handlers.decideSteer(value as SteerDecision);
    })
    .handleWithContext(AGENT_CHANNEL.ackSteerIntents, (context, outboxRefs) => {
      if (
        !Array.isArray(outboxRefs) ||
        outboxRefs.some((ref) => typeof ref !== "string")
      ) {
        throw new Error("steer ack 格式无效");
      }
      for (const outboxRef of outboxRefs) assertOutbox(context, outboxRef);
      return handlers.ackSteerIntents(outboxRefs);
    })
    .handleWithContext(AGENT_CHANNEL.abandonResumeFailure, (context, requestId, retryToken) => {
      if (typeof requestId !== "string" || typeof retryToken !== "string" || !retryToken || retryToken.length > 256) throw new Error("Invalid recovery identity");
      assertRequest(context, requestId);
      return handlers.abandonResumeFailure(requestId, retryToken);
    })
    .handleWithContext(
      AGENT_CHANNEL.retryWithoutSession,
      (context, requestId, retryToken) => {
        if (typeof requestId !== "string" || typeof retryToken !== "string") {
          throw new Error("resume retry 请求格式无效");
        }
        assertRequest(context, requestId);
        return handlers.retryWithoutSession(requestId, retryToken);
      }
    )
    .handleWithContext(
      AGENT_CHANNEL.retrySameSession,
      (context, requestId, retryToken) => {
        if (typeof requestId !== "string" || typeof retryToken !== "string") {
          throw new Error("resume retry 请求格式无效");
        }
        assertRequest(context, requestId);
        return handlers.retrySameSession(requestId, retryToken);
      }
    )
    .handleWithContext(AGENT_CHANNEL.respondApproval, (context, value) => {
      const response = value as Partial<AgentApprovalResponse> | null;
      if (
        !response ||
        typeof response.requestId !== "string" ||
        typeof response.approvalId !== "string" ||
        !isAgentApprovalDecision(response.decision)
      ) {
        throw new Error("审批响应格式无效");
      }
      const conversationId = handlers.conversationForRequest(response.requestId);
      if (!conversationId) throw new Error("审批请求已结束");
      surfaceWindowController.assertConversationMutation(context, conversationId);
      return handlers.respondApproval(response as AgentApprovalResponse);
    })
    .handleWithContext(AGENT_CHANNEL.respondUserInput, (context, value) => {
      const response = value as Partial<AgentUserInputResponse> | null;
      if (
        !response ||
        typeof response.requestId !== "string" ||
        typeof response.userInputId !== "string"
      ) {
        throw new Error("用户输入响应格式无效");
      }
      const conversationId = handlers.conversationForRequest(response.requestId);
      if (!conversationId) throw new Error("用户输入请求已过期或不存在");
      surfaceWindowController.assertConversationMutation(context, conversationId);
      const questionIds = handlers.pendingUserInputQuestionIds(
        response.requestId,
        response.userInputId
      );
      if (!questionIds) throw new Error("用户输入请求已过期或不存在");
      validateUserInputResponse(value, questionIds);
      return handlers.respondUserInput(value as AgentUserInputResponse);
    })
    .onWithContext(AGENT_CHANNEL.turnDetach, (context, conversationId, attachmentId) => {
      if (typeof conversationId === "string" && typeof attachmentId === "string") {
        assertConversation(context, assertConversationId(conversationId));
        handlers.detach(
          conversationId,
          attachmentId,
          context.window as BrowserWindow
        );
      }
    })
    .onWithContext(AGENT_CHANNEL.cancel, (context, requestId) => {
      if (typeof requestId === "string") {
        assertRequest(context, requestId);
        void handlers.cancel(requestId).catch(() => {});
      }
    });

  window.once("closed", () => handlers.removeSubscriber(window));
}
let mainHandlers: AgentBridgeIpcHandlers | null = null;
export function currentAgentControlHandlers() {
  if (!mainHandlers) throw new Error("execution-not-ready");
  return mainHandlers;
}
