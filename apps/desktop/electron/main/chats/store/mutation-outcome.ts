/**
 * [INPUT]: Depends on canonical Chat message/record contracts
 * [OUTPUT]: Provides ChatMessageMutation and the explicit unknown-durable-outcome error predicate
 * [POS]: Shared mutation result vocabulary used by ChatStore, event publication, lifecycle recovery, and tests
 */

import type { ChatMessage, ChatRecord } from "../../../../shared/chats-ipc";

export type ChatMessageMutation = {
  record: ChatRecord;
  revision: number;
  appended: ChatMessage[];
  storedMessage?: ChatMessage;
  mode?: "replace";
};

export class ChatMutationOutcomeUnknownError extends Error {
  override name = "ChatMutationOutcomeUnknownError";
  readonly status = "outcome_unknown" as const;

  constructor(
    readonly operationId: string,
    readonly reason: string
  ) {
    super(`Chat mutation outcome is unknown (${operationId}): ${reason}`);
  }
}

export const isChatMutationOutcomeUnknown = (
  cause: unknown
): cause is ChatMutationOutcomeUnknownError =>
  cause instanceof ChatMutationOutcomeUnknownError ||
  Boolean(
    cause &&
    typeof cause === "object" &&
    (cause as { status?: unknown }).status === "outcome_unknown" &&
    typeof (cause as { operationId?: unknown }).operationId === "string"
  );
