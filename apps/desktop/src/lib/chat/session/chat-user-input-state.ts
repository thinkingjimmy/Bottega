/**
 * [INPUT]: Depends on shared AgentUserInputRequest contract and chat-ui's ApprovalFailure line names
 * [OUTPUT]: Provides pending requestUserInput projection, typed copy-key errors, queue identity retention, and answered-request clearing
 * [POS]: apps/desktop/src/lib/chat/session; requestUserInput pure state boundary for attach projection and session response competitive consumption
 */

import type { AgentUserInputRequest } from "../../../../shared/ipc/agent/agent-ipc";
import type { ApprovalFailure } from "@ai-chat/chat-ui/interactions/model";

export type PendingUserInputState = {
  request: AgentUserInputRequest;
  index: number;
  answers: Record<string, { answers: string[] }>;
  expiresAt?: number;
  busy: boolean;
  error:
    | string
    | {
        // A failed answer shares the approval card's failure lines.
        copyKey: "chat.userInput.expired" | "chat.userInput.answerRequired" | `chat.composer.approval.failed.${ApprovalFailure}`;
      };
  queue: AgentUserInputRequest[];
};

export function projectPendingUserInput(
  current: PendingUserInputState | null,
  requests: readonly AgentUserInputRequest[]
): PendingUserInputState | null {
  const request = requests[0];
  if (!request) return null;
  if (current?.request.userInputId === request.userInputId) {
    const sameQueue =
      current.request === request &&
      current.queue.length === requests.length &&
      current.queue.every((item, index) => item === requests[index]);
    if (sameQueue) return current;
    const queue = [...requests];
    return { ...current, request, queue };
  }
  const queue = [...requests];
  return {
    request,
    index: 0,
    answers: {},
    ...(request.expiresAt ? { expiresAt: request.expiresAt } : {}),
    busy: false,
    error: "",
    queue,
  };
}

export function clearAnsweredUserInput(
  current: PendingUserInputState | null,
  answeredUserInputId: string
) {
  return current?.request.userInputId === answeredUserInputId ? null : current;
}
