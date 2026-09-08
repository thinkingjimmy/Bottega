/**
 * [INPUT]: Depends on shared Agent options and Chat notice types
 * [OUTPUT]: Provides explicit Agent CAS, switch receipts, history fences, and eligibility reasons
 * [POS]: Shared switch protocol for canonical storage, admission, and the composer
 */

import type { AgentBackendId, AgentTurnOptions } from "../agent-ipc";

export type AgentSwitchIntent = Readonly<{
  expectedAgent: AgentBackendId;
  expectedAgentRevision: number;
  expectedChatRecordRevision: number;
  targetAgent: AgentBackendId;
}>;
export type AgentExpectation = Readonly<{
  expectedAgent: AgentBackendId;
  expectedAgentRevision: number;
}>;
export type ChatOptionsPatch = AgentExpectation & Readonly<{
  chatId: string;
  expectedChatRecordRevision: number;
  patch: Partial<Omit<AgentTurnOptions, "backend">>;
}>;
export type HistoryViewFence = Readonly<{
  incarnationId: string;
  nativeMessageRevision: number;
  activeGenerationId: string | null;
}>;
export type HandoffCoverage = Readonly<{
  mode: "excerpts" | "none";
  historyIncluded: boolean;
  notInjected: boolean;
  storageTrimmed: boolean;
  lookup: "available" | "disabled" | "unsupported" | "unavailable";
}>;
export type AgentSwitchedNotice = Readonly<{
  kind: "agent-switched";
  from: AgentBackendId;
  to: AgentBackendId;
  at: number;
  agentRevision: number;
  context: HandoffCoverage;
}>;
export type AgentSwitchReceipt = Readonly<{
  intentId: string;
  submissionHash: string;
  chatId: string;
  agentRevision: number;
  chatRecordRevision: number;
  nativeMessageRevision: number;
  targetOptions: AgentTurnOptions;
  noticeMessageId: string;
  userMessageId: string;
  assistantMessageId: string;
  noticeSeq: number;
  userSeq: number;
  assistantSeq: number;
  historyView: HistoryViewFence;
}>;
export const AGENT_SWITCH_BLOCK_REASONS = [
  "readonly", "app-bound", "archived", "running", "approval", "plan-review",
  "queue", "paused", "submission", "recovery", "revision-stale",
] as const;
export type AgentSwitchBlockReason = typeof AGENT_SWITCH_BLOCK_REASONS[number];
export type AgentSwitchEligibility = Readonly<{
  eligible: boolean;
  reason: AgentSwitchBlockReason | null;
  agent: AgentBackendId;
  agentRevision: number;
  chatRecordRevision: number;
}>;

export function isOriginalAdoptedBinding(chat: {
  importOrigin?: unknown;
  agentRevision: number;
  session: unknown;
}) {
  return Boolean(chat.importOrigin && chat.session && chat.agentRevision === 0);
}
