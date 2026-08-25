/**
 * [INPUT]: Depends on shared AgentUserInputRequest contract
 * [OUTPUT]: ProvIDes renderer and query queue projections, has answered ID conditions clear, equivalent reference early withdrawal with PendingUserInputState
 * [POS]: requestUserInput pure state boundary for attach projection and session response competitive consumption
 */

import type { AgentUserInputRequest } from "../../shared/agent-ipc";

export type PendingUserInputState = {
  request: AgentUserInputRequest;
  index: number;
  answers: Record<string, { answers: string[] }>;
  expiresAt?: number;
  busy: boolean;
  error: string;
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
