/**
 * [INPUT]: Depends on Electron BrowserWindow, TrustedRendererContext IPC, conversation residence, and fail-closed manual payload validation
 * [OUTPUT]: Provides residence-gated manual turn admission plus role/App-scoped action & submission event projection
 * [POS]: Sections coordinator renderer boundary; composer writes are accepted only from the resident conversation window, and cross-conversation action/outcome state never fans out to App windows
 */

import type { BrowserWindow } from "electron";
import {
  SECTIONS_CHANNEL,
  type RelayActionInput,
  type RelayActionsSnapshot,
} from "../../../../shared/sections-ipc";
import {
  submissionAckSchema,
} from "../../../../shared/submission";
import { ProductFailureError } from "../../../../shared/product-failure";
import { rendererIpc } from "../../ipc-registrar";
import { validateManualTurnSubmission } from "../../agent-payload-validation";
import type { ConversationCoordinator } from "./conversation-coordinator";
import { surfaceWindowController } from "../../window/surfaces/surface-window-controller";
import { rendererEventBus } from "../../window/surfaces/renderer-event-bus";
import type { TrustedRendererContext } from "../../window/surfaces/trusted-renderer-context";

export function registerCoordinatorIpc(
  window: BrowserWindow,
  rendererUrl: string,
  coordinator: ConversationCoordinator
) {
  const assertConversation = (
    context: TrustedRendererContext,
    conversationId: string | undefined
  ) => {
    if (!conversationId) throw new Error("会话动作已过期或不存在");
    surfaceWindowController.assertConversationMutation(context, conversationId);
  };
  const assertAction = (context: TrustedRendererContext, actionId: string) => {
    const conversations = coordinator.residenceIndex().action(actionId);
    if (!conversations.length) throw new Error("Section action 已过期或不存在");
    const accepted = conversations.some((conversationId) => {
      try {
        assertConversation(context, conversationId);
        return true;
      } catch {
        return false;
      }
    });
    if (!accepted) throw new Error("Section action 来自非驻留窗口");
  };
  rendererIpc(window, rendererUrl, "拒绝非主窗口的 Section 动作")
    .roles("main", "app-window")
    .handleWithContext(SECTIONS_CHANNEL.submitManualTurn, async (context, input) => {
      try {
        const submission = assertManualTurnSubmission(input);
        surfaceWindowController.assertConversationMutation(
          context,
          submission.turn.scope.conversationId
        );
        const receipt = await coordinator.submitManualTurn(submission);
        return { kind: "accepted" as const, receipt };
      } catch (cause) {
        /* 结构化失败随行：`ProductFailureError.message` 是给日志看的裸码
           （skills-runtime/ref-invalid），人话在 renderer 用 failure 组句。 */
        return {
          kind: "rejectedBeforeAdmission" as const,
          reason: cause instanceof Error ? cause.message : String(cause),
          ...(cause instanceof ProductFailureError ? { failure: cause.failure } : {}),
        };
      }
    })
    .handleWithContext(SECTIONS_CHANNEL.ackManualIntents, (context, intentIds) => {
      if (
        !Array.isArray(intentIds) ||
        intentIds.some((id) => typeof id !== "string")
      ) {
        throw new Error("人工 intent ack 格式无效");
      }
      for (const intentId of intentIds) {
        assertConversation(context, coordinator.residenceIndex().intent(intentId));
      }
      return coordinator.ackManualIntents(intentIds);
    })
    .handleWithContext(SECTIONS_CHANNEL.ackSubmission, (context, input) => {
      const ack = submissionAckSchema.parse(input);
      assertConversation(context, coordinator.residenceIndex().intent(ack.intentId));
      return coordinator.ackSubmission(ack);
    })
    .handleWithContext(SECTIONS_CHANNEL.submissionOutcome, (context, intentId) => {
      if (typeof intentId !== "string") {
        throw new Error("submission outcome intentId 无效");
      }
      assertConversation(context, coordinator.residenceIndex().intent(intentId));
      return coordinator.submissionOutcome(intentId);
    })
    .handleWithContext(SECTIONS_CHANNEL.cancelManualTurn, (context, requestId) => {
      if (typeof requestId !== "string") {
        throw new Error("人工 turn requestId 无效");
      }
      assertConversation(
        context,
        coordinator.residenceIndex().manualRequest(requestId)
      );
      return coordinator.cancelManualTurn(requestId);
    })
    .handleWithContext(SECTIONS_CHANNEL.stopRelayChain, (context, requestId) => {
      if (typeof requestId !== "string") {
        throw new Error("Section 链 requestId 无效");
      }
      assertConversation(
        context,
        coordinator.residenceIndex().relayRequest(requestId)
      );
      return coordinator.stopRelayChain(requestId);
    })
    .handleWithContext(SECTIONS_CHANNEL.continueRelay, (context, input) => {
      const value = assertActionInput(input, "继续");
      assertAction(context, value.actionId);
      return coordinator.continueRelay(
        value.actionId,
        value.expectedPauseEpoch
      );
    })
    .handleWithContext(SECTIONS_CHANNEL.discardRelay, (context, input) => {
      const value = assertActionInput(input, "弃件");
      assertAction(context, value.actionId);
      return coordinator.discardRelay(
        value.actionId,
        value.expectedPauseEpoch
      );
    })
    /* 全局快照是主窗独有的口径:App 窗没有跨会话总览的正当需求,拉取直接
       拒到门外(client 侧对 reject 降级为空快照,靠后续 actionsEvent 补投)。 */
    .roles("main")
    .handle(SECTIONS_CHANNEL.actionsSnapshot, () =>
      coordinator.actionsSnapshot()
    );
  const unsubscribe = coordinator.onActionsChanged((snapshot) => {
    rendererEventBus.toRole("main", SECTIONS_CHANNEL.actionsEvent, snapshot);
    fanOutActionsToApps(coordinator, snapshot);
  });
  const unsubscribeOutcome = coordinator.onSubmissionOutcome((outcome) => {
    rendererEventBus.toRole(
      "main",
      SECTIONS_CHANNEL.submissionOutcomeEvent,
      outcome
    );
    /* 结果 capsule 只回它所属会话所驻留的 App 窗——App 窗 composer 靠这条事件
       落定乐观态;跨会话的 intentId/phase 绝不外泄给别的 App 窗。 */
    const conversationId = coordinator.residenceIndex().intent(outcome.intentId);
    const appId = conversationId
      ? surfaceWindowController.appIdForActiveUseChat(conversationId)
      : null;
    if (appId) {
      rendererEventBus.toApp(
        appId,
        SECTIONS_CHANNEL.submissionOutcomeEvent,
        outcome
      );
    }
  });
  window.once("closed", () => {
    unsubscribe();
    unsubscribeOutcome();
  });
}

/* 按驻留会话把 action 快照裁给每个 App 窗:只暴露该窗当前 use-chat 相关的
   action(chain id / section ref / pause epoch),主窗另发全量。App use-chat
   通常不入 relay 链,故这里多数情形是空转——正是期望的「零泄漏」形态。 */
function fanOutActionsToApps(
  coordinator: ConversationCoordinator,
  snapshot: RelayActionsSnapshot
) {
  const entries = Object.entries(snapshot.actions);
  if (!entries.length) return;
  const index = coordinator.residenceIndex();
  const perApp = new Map<string, RelayActionsSnapshot["actions"]>();
  for (const [actionId, action] of entries) {
    for (const conversationId of index.action(actionId)) {
      const appId =
        surfaceWindowController.appIdForActiveUseChat(conversationId);
      if (!appId) continue;
      const bucket = perApp.get(appId) ?? {};
      bucket[actionId] = action;
      perApp.set(appId, bucket);
    }
  }
  for (const [appId, actions] of perApp) {
    rendererEventBus.toApp(appId, SECTIONS_CHANNEL.actionsEvent, {
      revision: snapshot.revision,
      actions,
    });
  }
}

function assertManualTurnSubmission(input: unknown) {
  return validateManualTurnSubmission(input);
}

function assertActionInput(input: unknown, label: string) {
  const value = input as Partial<RelayActionInput> | null;
  if (
    !value ||
    typeof value !== "object" ||
    typeof value.actionId !== "string" ||
    typeof value.expectedPauseEpoch !== "number"
  ) {
    throw new Error(`Section ${label}参数无效`);
  }
  return value as RelayActionInput;
}
