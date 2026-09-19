/**
 * [INPUT]: Depends on React, locale, native CommandSink, Plan decisions, Section relay and current request refs.
 * [OUTPUT]: Provides stable approval, question, Plan, stop, retry, and explicit authentication-retry actions through canonical submission.
 * [POS]: The owner of the chat/runtime/session interaction status; Keep Plan Failed re-roll, relay Second confirmation and request-local cancel timing
 */

import { assertNoPendingAgent } from "@/lib/chat-agent-draft/submission";
import {
  useCallback,
  useMemo,
  useState,
  type MutableRefObject,
} from "react";
import type {
  PromptInputMessage,
} from "@ai-chat/ui/components/ai-elements/prompt-input";
import type {
  AgentApprovalDecision,
  AgentApprovalRequest,
} from "../../../../../shared/agent-ipc";
import type {
  ChatMessage,
  UserChatMessage,
} from "../../../../../shared/chats-ipc";
import {
  type AgentRequest,
} from "@/lib/agent-client";
import { nativeChatCommands } from "@/lib/cloud/chat/platform/commands";
import { clearAnsweredUserInput } from "@/lib/chat-user-input-state";
import { planModeAfterPlanReview } from "../../../../../shared/chat-plan-kind";
import { planDecisionInput, type PlanDecision } from "@/lib/chat-plan";
import { errorMessage } from "@ai-chat/ui/lib/errors";
import { stopRelayChain } from "@/lib/sections-client";
import {
  advanceUserInput,
  type PendingPlanDecisionState,
  type PendingUserInputState,
} from "../chat-session-model";
import type { RelayStopResult } from "../../../../../shared/sections-ipc";
import { useAppTranslation } from "@/components/providers/i18n-provider";

export type SessionSubmit = (
  message: PromptInputMessage,
  options?: { planIntent?: boolean; signal?: AbortSignal; authenticationRetry?: import("../../../../../shared/agent-availability/types").AuthenticationRetryIntent }
) => Promise<void>;

type SessionInteractionsInput = {
  chatId?: string;
  activeRequestId: string | null;
  messages: ChatMessage[];
  requestRef: MutableRefObject<AgentRequest | null>;
  submitRef: MutableRefObject<SessionSubmit | null>;
  setPlanMode: (enabled: boolean) => void;
  reportStopError: (cause: unknown) => void;
};

export async function stopSessionRequest(input: {
  requestId: string;
  relay: boolean;
  stopRelay: (requestId: string) => Promise<RelayStopResult>;
  cancel: () => void;
}) {
  if (input.relay) {
    try {
      const result = await input.stopRelay(input.requestId);
      if (result === "stopped") return "stopped" as const;
    } catch (cause) {
      input.cancel();
      throw cause;
    }
  }
  input.cancel();
  return "stopped" as const;
}

export function lastRelayUserMessage(
  messages: readonly ChatMessage[]
): UserChatMessage | undefined {
  const lastUser = messages.findLast(
    (message): message is UserChatMessage => message.role === "user"
  );
  return lastUser?.relay ? lastUser : undefined;
}

export async function respondApprovalWithPlanMode(
  approval: AgentApprovalRequest,
  decision: AgentApprovalDecision,
  respond: () => Promise<void | import("../../../../../shared/agent-ipc").ControlResult>,
  setPlanMode: (enabled: boolean) => void
) {
  const result = await respond();
  if (result === "already-resolved") return result;
  const nextPlanMode = planModeAfterPlanReview(approval, decision);
  if (nextPlanMode !== undefined) setPlanMode(nextPlanMode);
}

export function useSessionInteractions({
  chatId,
  activeRequestId,
  messages,
  requestRef,
  submitRef,
  setPlanMode,
  reportStopError,
}: SessionInteractionsInput) {
  const { t } = useAppTranslation();
  const [approvals, setApprovals] = useState<AgentApprovalRequest[]>([]);
  const [approvalBusy, setApprovalBusy] = useState(false);
  const [approvalError, setApprovalError] = useState("");
  const [pendingUserInput, setPendingUserInput] =
    useState<PendingUserInputState | null>(null);
  const [pendingPlanDecision, setPendingPlanDecision] =
    useState<PendingPlanDecisionState | null>(null);
  const [cancelPending, setCancelPending] = useState(false);

  // Route retries through normal submission to preserve queue and persistence semantics.
  const submitPlain = useCallback(
    (displayText: string, options?: Parameters<SessionSubmit>[1]) => {
      try { if (chatId) assertNoPendingAgent(chatId); } catch (cause) { reportStopError(cause); return; }
      void submitRef.current?.({
        input: { kind: "plain", displayText },
        files: [],
      }, options).catch(() => {});
    },
    [submitRef, chatId, reportStopError]
  );
  const retryTurn = useCallback(() => submitPlain(t("common.retry")), [submitPlain, t]);
  const retryAuthentication = useCallback(() => submitPlain(t("agentAvailability.retrySending"), {
    authenticationRetry: { kind: "retry-authentication" },
  }), [submitPlain, t]);

  const respondApproval = useCallback(
    async (decision: AgentApprovalDecision) => {
      const approval = approvals[0];
      if (!approval || !activeRequestId || approvalBusy) return;
      setApprovalBusy(true);
      setApprovalError("");
      try {
        await respondApprovalWithPlanMode(
          approval,
          decision,
          () =>
            nativeChatCommands.respond({ kind: "approval", requestId: activeRequestId, interactionId: approval.approvalId, decision }),
          setPlanMode
        );
        setApprovals((current) =>
          current.filter((item) => item.approvalId !== approval.approvalId)
        );
      } catch (cause) {
        setApprovalError(errorMessage(cause));
      } finally {
        setApprovalBusy(false);
      }
    },
    [activeRequestId, approvalBusy, approvals, setPlanMode]
  );

  const respondUserInput = useCallback(
    async (answers: string[]) => {
      const pending = pendingUserInput;
      if (!pending || !activeRequestId || pending.busy) return;
      const advance = advanceUserInput(pending, answers);
      setPendingUserInput(advance.state);
      if (advance.kind !== "submit") return;
      try {
        await nativeChatCommands.respond({ kind: "input", requestId: activeRequestId, interactionId: pending.request.userInputId, answers: advance.answers });
        setPendingUserInput((current) =>
          clearAnsweredUserInput(current, pending.request.userInputId)
        );
      } catch (cause) {
        setPendingUserInput((current) =>
          current?.request.userInputId === pending.request.userInputId
            ? {
                ...current,
                busy: false,
                error: `问题已失效：${errorMessage(cause)}`,
              }
            : current
        );
      }
    },
    [activeRequestId, pendingUserInput]
  );

  const respondPlanDecision = useCallback(
    async (decision: PlanDecision) => {
      const pending = pendingPlanDecision;
      if (!pending || pending.busy) return;
      if (decision.kind === "skip") {
        setPendingPlanDecision(null);
        return;
      }
      const followup = planDecisionInput(decision);
      if (!followup) {
        setPendingPlanDecision({ ...pending, error: "请先填写调整意见。" });
        return;
      }
      setPendingPlanDecision({ ...pending, busy: true, error: "" });
      setPlanMode(followup.planMode);
      try {
        await submitRef.current?.(
          {
            input: { kind: "plain", displayText: followup.displayText },
            files: [],
          },
          { planIntent: followup.planMode }
        );
        setPendingPlanDecision(null);
      } catch (cause) {
        setPendingPlanDecision({
          ...pending,
          busy: false,
          error: errorMessage(cause),
        });
        setPlanMode(true);
      }
    },
    [pendingPlanDecision, setPlanMode, submitRef]
  );

  const handleStop = useCallback(async () => {
    if (!activeRequestId || cancelPending) return "failed" as const;
    const relayMessage = lastRelayUserMessage(messages);
    if (relayMessage && !window.confirm(t("chat.relayStopConfirm"))) {
      return "declined" as const;
    }
    setCancelPending(true);
    try {
      return await stopSessionRequest({
        requestId: activeRequestId,
        relay: Boolean(relayMessage),
        stopRelay: stopRelayChain,
        cancel: () => {
          if (requestRef.current?.requestId === activeRequestId) {
            requestRef.current.cancel();
          } else {
            nativeChatCommands.cancel("agent", activeRequestId);
          }
        },
      });
    } catch (cause) {
      setCancelPending(false);
      reportStopError(cause);
      return "failed" as const;
    }
  }, [
    activeRequestId,
    cancelPending,
    messages,
    reportStopError,
    requestRef,
    t,
  ]);

  return useMemo(() => ({
    approvals,
    approvalBusy,
    approvalError,
    cancelPending,
    pendingPlanDecision,
    pendingUserInput,
    retryTurn,
    retryAuthentication,
    handleStop,
    respondApproval,
    respondPlanDecision,
    respondUserInput,
    setApprovals,
    setApprovalBusy,
    setApprovalError,
    setCancelPending,
    setPendingPlanDecision,
    setPendingUserInput,
  }), [
    approvalBusy,
    approvalError,
    approvals,
    cancelPending,
    handleStop,
    pendingPlanDecision,
    pendingUserInput,
    respondApproval,
    respondPlanDecision,
    respondUserInput,
    retryTurn,
    retryAuthentication,
  ]);
}
