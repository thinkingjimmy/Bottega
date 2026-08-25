/**
 * [INPUT]: Depends on Electron BrowserWindow, rendererIpc, manual payload/envelope fail-closed
 * [OUTPUT]: Provides staging/perpetuation of the full manual turn weighing registerCoordinator Ipc, and log-link action/snapshot/event
 * [POS]: The renderer of sections/coordinator is IPC thin film; Only test parameters and project action events, no status
 */

import type { BrowserWindow } from "electron";
import {
  SECTIONS_CHANNEL,
  type RelayActionInput,
} from "../../../../shared/sections-ipc";
import {
  submissionAckSchema,
} from "../../../../shared/submission";
import { rendererIpc } from "../../ipc-registrar";
import { validateManualTurnSubmission } from "../../agent-payload-validation";
import type { ConversationCoordinator } from "./conversation-coordinator";

export function registerCoordinatorIpc(
  window: BrowserWindow,
  rendererUrl: string,
  coordinator: ConversationCoordinator
) {
  rendererIpc(window, rendererUrl, "拒绝非主窗口的 Section 动作")
    .handle(SECTIONS_CHANNEL.submitManualTurn, async (input) => {
      try {
        const receipt = await coordinator.submitManualTurn(
          assertManualTurnSubmission(input)
        );
        return { kind: "accepted" as const, receipt };
      } catch (cause) {
        return {
          kind: "rejectedBeforeAdmission" as const,
          reason: cause instanceof Error ? cause.message : String(cause),
        };
      }
    })
    .handle(SECTIONS_CHANNEL.ackManualIntents, (intentIds) => {
      if (
        !Array.isArray(intentIds) ||
        intentIds.some((id) => typeof id !== "string")
      ) {
        throw new Error("人工 intent ack 格式无效");
      }
      return coordinator.ackManualIntents(intentIds);
    })
    .handle(SECTIONS_CHANNEL.ackSubmission, (input) =>
      coordinator.ackSubmission(submissionAckSchema.parse(input))
    )
    .handle(SECTIONS_CHANNEL.submissionOutcome, (intentId) => {
      if (typeof intentId !== "string") {
        throw new Error("submission outcome intentId 无效");
      }
      return coordinator.submissionOutcome(intentId);
    })
    .handle(SECTIONS_CHANNEL.cancelManualTurn, (requestId) => {
      if (typeof requestId !== "string") {
        throw new Error("人工 turn requestId 无效");
      }
      return coordinator.cancelManualTurn(requestId);
    })
    .handle(SECTIONS_CHANNEL.stopRelayChain, (requestId) => {
      if (typeof requestId !== "string") {
        throw new Error("Section 链 requestId 无效");
      }
      return coordinator.stopRelayChain(requestId);
    })
    .handle(SECTIONS_CHANNEL.continueRelay, (input) => {
      const value = assertActionInput(input, "继续");
      return coordinator.continueRelay(
        value.actionId,
        value.expectedPauseEpoch
      );
    })
    .handle(SECTIONS_CHANNEL.discardRelay, (input) => {
      const value = assertActionInput(input, "弃件");
      return coordinator.discardRelay(
        value.actionId,
        value.expectedPauseEpoch
      );
    })
    .handle(SECTIONS_CHANNEL.actionsSnapshot, () =>
      coordinator.actionsSnapshot()
    );
  const unsubscribe = coordinator.onActionsChanged((snapshot) => {
    if (!window.isDestroyed()) {
      window.webContents.send(SECTIONS_CHANNEL.actionsEvent, snapshot);
    }
  });
  const unsubscribeOutcome = coordinator.onSubmissionOutcome((outcome) => {
    if (!window.isDestroyed()) {
      window.webContents.send(
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
