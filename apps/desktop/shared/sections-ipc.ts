/**
 * [INPUT]: Depends on Agent turn, Chats, Durable Submission DTO, and receiving artificial messages full journal payload and notice action
 * [OUTPUT]: Provides renderer ManualTurnPersistence with main-only TrustedManualTurnPersistence ((includes adopt) ✓Workspace CAS, receipt/ACK/outcome and Section chain action contract
 * [POS]: The Conversation Coordinator boundaries of shared; The renderer type cannot be configured to SessionRef adopt, nor directly append chat or claim Agent turn
 */

import type { AgentSendPayload } from "./agent-ipc";
import type { ProductFailure } from "./product-failure";
import type {
  AppendChatMessageInput,
  AdoptChatInput,
  ChatMessage,
  CreateAppChatInput,
  CreateChatInput,
} from "./chats-ipc";
import type {
  IncarnationPrecondition,
  SubmissionAck,
  SubmissionContentV1,
  SubmissionOutcome,
  WorkspacePrecondition,
} from "./submission";

export type RelayActionInput = {
  actionId: string;
  expectedPauseEpoch: number;
};

export type RelayActionResult = "continued" | "discarded" | "stale";
export type RelayStopResult = "stopped" | "not-relay" | "stale";
export type RelayActionState =
  | "active"
  | "continued"
  | "discarded"
  | "expired";

export type RelayActionSnapshot = {
  actionId: string;
  rootChainId: string;
  pauseEpoch: number;
  pendingCount: number;
  state: RelayActionState;
};

export type RelayActionsSnapshot = {
  revision: number;
  actions: Record<string, RelayActionSnapshot>;
};

export type ManualTurnPersistence =
  | { kind: "create"; input: CreateChatInput }
  | { kind: "create-app"; input: CreateAppChatInput }
  | { kind: "append"; input: AppendChatMessageInput };

/** main-only 扩展；preload 的 SectionsBridgeApi 永远只接受上面的 renderer 联合。 */
export type TrustedManualTurnPersistence =
  | ManualTurnPersistence
  | { kind: "adopt"; input: AdoptChatInput };

export type ManualTurnSubmission = {
  intentId: string;
  persistence: ManualTurnPersistence;
  /** 恒为当前消息的结构化 input；历史折叠由 main 按 canonical session 决策。 */
  turn: AgentSendPayload;
  /** v3 route-independent capsule；Gallery 快照只存在于该 strict 联合内。 */
  content: SubmissionContentV1;
  /** admission 与延迟 append 共用的 incarnation CAS。 */
  precondition: IncarnationPrecondition;
  /** renderer 冻结的逻辑 Workspace owner；main 在 lifecycle gate 内按当前事实 CAS。 */
  workspacePrecondition: WorkspacePrecondition;
};

export type TrustedManualTurnSubmission = Omit<ManualTurnSubmission, "persistence"> & {
  persistence: TrustedManualTurnPersistence;
};

export type ManualTurnReceipt =
  | {
      phase: "started" | "queued";
      requestId: string;
      blockedBy?: "relay-queue" | "chain-paused" | "app-transition";
      userMessage: ChatMessage;
    }
  | { phase: "settled"; requestId: string }
  | { phase: "failed"; requestId: string; userPersisted: boolean };

export type AdmissionResult =
  | { kind: "accepted"; receipt: ManualTurnReceipt }
  | { kind: "rejectedBeforeAdmission"; reason: string; failure?: ProductFailure }
  | { kind: "ambiguous"; cause: string };

export const SECTIONS_CHANNEL = {
  submitManualTurn: "sections:submit-manual-turn",
  cancelManualTurn: "sections:cancel-manual-turn",
  ackManualIntents: "sections:ack-manual-intents",
  ackSubmission: "sections:ack-submission",
  submissionOutcome: "sections:submission-outcome",
  submissionOutcomeEvent: "sections:submission-outcome-event",
  stopRelayChain: "sections:stop-relay-chain",
  continueRelay: "sections:continue-relay",
  discardRelay: "sections:discard-relay",
  actionsSnapshot: "sections:actions-snapshot",
  actionsEvent: "sections:actions-event",
} as const;

export type SectionsBridgeApi = {
  submitManualTurn(input: ManualTurnSubmission): Promise<AdmissionResult>;
  cancelManualTurn(requestId: string): Promise<void>;
  ackManualIntents(intentIds: string[]): Promise<void>;
  ackSubmission?(input: SubmissionAck): Promise<void>;
  submissionOutcome?(intentId: string): Promise<SubmissionOutcome>;
  onSubmissionOutcome?(
    callback: (outcome: SubmissionOutcome) => void
  ): () => void;
  stopRelayChain(requestId: string): Promise<RelayStopResult>;
  continueRelay(input: RelayActionInput): Promise<RelayActionResult>;
  discardRelay(input: RelayActionInput): Promise<RelayActionResult>;
  actionsSnapshot(): Promise<RelayActionsSnapshot>;
  onActionsEvent(
    callback: (snapshot: RelayActionsSnapshot) => void
  ): () => void;
};
