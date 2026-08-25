/**
 * [INPUT]: Depends on shared Chat/Agent type
 * [OUTPUT]: Provides turn settle Event shape and shutdown frequency constant SHUTDOWN_GRACE_MS
 * [POS]: The state machine's algebraic layer of main/memory/service; Retrieve rendering to prompt-lane, where only the cross-layer shared pure values are left
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
