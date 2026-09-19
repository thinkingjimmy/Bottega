/**
 * [INPUT]: Depends on Zod and the closed Agent backend order from ./agent-ipc
 * [OUTPUT]: Provides AGENT_CONNECTIONS_CHANNEL, the WarmIntent type, warmIntentSchema and AgentConnectionsBridgeApi
 * [POS]: Shared warm-intent transport contract for main, preload and renderer; carries no connection state back
 */

import { z } from "zod";
import { AGENT_BACKEND_ORDER, type AgentBackendId } from "./agent-ipc";

export const AGENT_CONNECTIONS_CHANNEL = {
  warm: "agent-connections:warm",
} as const;

/* 只说「哪个会话想用哪家」。连接是否真的建立、是否已存在、是否失败，
   renderer 一概不知情（PRD Q6：不投影任何连接状态）。 */
export type WarmIntent = {
  conversationId: string;
  backend: AgentBackendId;
};

export const warmIntentSchema = z
  .object({
    conversationId: z.string().min(1).max(256),
    backend: z.enum(AGENT_BACKEND_ORDER),
  })
  .strict();

export type AgentConnectionsBridgeApi = {
  /** Fire-and-forget: the pool never answers, and a failure never reaches the renderer. */
  warm: (intent: WarmIntent) => void;
};
