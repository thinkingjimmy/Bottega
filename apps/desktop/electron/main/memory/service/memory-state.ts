/**
 * [INPUT]: Depends on shared chats-ipc ChatMessage and agent bridge-types AgentContext/TurnOrigin
 * [OUTPUT]: Provides the MemoryTurnSettledEvent shape and shutdown grace constant SHUTDOWN_GRACE_MS
 * [POS]: The pure-value layer of main/memory/service; recall rendering itself lives in prompt-lane, this file only holds the cross-layer types both sides share
 */

import type { ChatMessage } from "../../../../shared/chats-ipc";
import type { AgentContext, TurnOrigin } from "../../agent/bridge-types";

export const SHUTDOWN_GRACE_MS = 3_000;

export type MemoryTurnSettledEvent = {
  conversationId: string;
  requestId: string;
  assistantMessageId: string;
  planRequested: boolean;
  origin?: TurnOrigin;
  context?: AgentContext;
  terminal: "done" | "cancelled" | "error";
  outcome: "stored" | "empty" | "missing" | "retryable" | "fatal";
  assistantMessage?: ChatMessage;
};
