/**
 * [INPUT]: Depends on shared Agent IPC, chats IPC, product failure, sections IPC, the shared turn reducer's draft and SubagentRegistry types, and agent/controls/completion's InteractionState
 * [OUTPUT]: Provides the turn model the registry keeps: TurnOrigin (manual, relay, or a workflow step with its run, step, attempt and role) and turnMessageId, SourceTerminal, TurnCleanup, TurnPersist, RegistryTurn, the startup, retry and steer states, SubagentOutcomeStatus, TurnChildTask, SteerOperation, TurnEntry, RetryClaim, DraftObservation, and the isTombstone, blocksNewTurn and awaitsUserResponse predicates
 * [POS]: apps/desktop/electron/main/agent/turns/turn; Type and predicate half of the turn lifecycle; turn-registry.ts owns the state machine over these, agent/ re-exports TurnOrigin from here. No Electron dependency.
 */
import type { ProviderId } from "@ai-chat/cloud-protocol/contracts/provider";
import type { TurnDraft } from "../../../../../shared/chats/model/chat-turn-reducer";
import type {
  AgentApprovalRequest,
  AgentTurnItem,
  AgentUserInputRequest,
  FailureKind,
  UsageLimitInfo,
  SessionRef,
  SessionServiceTierEffective,
} from "../../../../../shared/ipc/agent/agent-ipc";
import type { TurnCommitInput } from "../../../../../shared/ipc/content/chats-ipc";
import type { SubagentRegistry } from "../../../../../shared/tools/subagent-registry";
import type { ProductFailure } from "../../../../../shared/product/product-failure";
import type { WorkflowTurnSource } from "../../../../../shared/ipc/content/sections-ipc";
import type { InteractionState } from "../../controls/completion";

/**
 * turn 的发起证据：人工输入、relay 或 workflow 步骤。定义在本层
 * （无 Electron 依赖的 turn 单一真相源）；bridge-types 只再导出，方向恒为
 * agent/ → 本文件。
 * A workflow turn has no queryText: its step prompt is never a person's words; userMessageId only keys the step message's mechanics.
 */
export type TurnOrigin =
  | {
      kind: "manual";
      queryText: string;
      userText: string;
      userMessageId: string;
    }
  | { kind: "relay" }
  | ({ kind: "workflow"; userMessageId: string } & WorkflowTurnSource);

/** The persisted message a turn answers, for mechanics keyed by it (sent-prompt evidence, session recovery, fresh retry); a relay has none. */
export function turnMessageId(origin: TurnOrigin | undefined): string | undefined {
  return origin && origin.kind !== "relay" ? origin.userMessageId : undefined;
}

export type SourceTerminal = {
  type: "done" | "cancelled" | "error";
  message?: string;
  failureKind?: FailureKind;
  failure?: ProductFailure;
  /** 仅 failureKind==="usage-limit" 时存在，卡片据此渲染窗口与恢复时刻 */
  usageLimit?: UsageLimitInfo;
  facts?: { skillDescriptionsTruncated?: true };
};

export type TurnCleanup = "pending" | "complete" | "failed";
export type TurnPersist =
  | "unprepared"
  | "pending"
  | "stored"
  | "empty"
  | "missing"
  | "retryable"
  | "fatal";

export type RegistryTurn = {
  interrupt(): void;
  markStopped(): void;
  pid?: number;
  readonly steeringSupported?: boolean;
};
type Startup = {
  task: Promise<void>;
  cancelRequested: boolean;
};

type RetryState = {
  attempt: number;
  timer?: NodeJS.Timeout;
  inFlight?: Promise<void>;
};

type RetryClaimState = {
  generation: number;
  settled: Promise<void>;
  resolve(): void;
};

export type SteerOperationState = {
  controller: AbortController;
  settled: Promise<void>;
  resolve(): void;
};

export type SubagentOutcomeStatus =
  | "completed"
  | "errored"
  | "interrupted"
  | "timeout";

export type TurnChildTask = {
  abort(): void | Promise<void>;
  settled: Promise<unknown>;
};

export type SteerOperation = {
  epoch: number;
  signal: AbortSignal;
  finish(): void;
};

export type TurnEntry<TTurn extends RegistryTurn = RegistryTurn> = InteractionState & {
  /** A built-in or an available package Provider (d4b follow-up slice 2). */
  backend: ProviderId;
  conversationId: string;
  requestId: string;
  messageId: string;
  assistantSeq: number;
  planRequested: boolean;
  origin?: TurnOrigin;
  recallAttempted: boolean;
  startedAt: number;
  phase: "starting" | "active" | "resume-failed" | "retry-claiming";
  cleanup: TurnCleanup;
  persist: TurnPersist;
  session?: SessionRef;
  serviceTierEffective?: SessionServiceTierEffective;
  resumeRetryToken?: string;
  generation: number;
  draft: TurnDraft;
  approvals: Map<string, AgentApprovalRequest>;
  userInputs: Map<string, AgentUserInputRequest>;
  subagents: SubagentRegistry;
  subagentOutcomes: Map<string, SubagentOutcomeStatus>;
  childController: AbortController;
  children: Set<TurnChildTask>;
  startup?: Startup;
  turn?: TTurn;
  appId?: string;
  resolvedInput?: {
    commit(): void;
    rollback(): void;
    release(): Promise<void>;
  };
  incarnationId?: string;
  terminalSeq?: number;
  currentSubagents?: Set<string>;
  sourceTerminal?: SourceTerminal;
  effectiveTerminal?: SourceTerminal;
  postProcess?: Promise<SourceTerminal>;
  finalizeInFlight?: Promise<void>;
  cleanupInFlight?: Promise<void>;
  prepared?: TurnCommitInput;
  projectionTail: Promise<void>;
  retry: RetryState;
  retryClaim?: RetryClaimState;
  /** A Stop that arrived while a retry was claiming: the next generation starts already cancelled. */
  cancelAcrossRetry?: boolean;
  steerOpEpoch: number;
  fenceClosed: boolean;
  steerOperations: Map<number, SteerOperationState>;
  tombstoneExpiresAt?: number;
};

export type RetryClaim<TTurn extends RegistryTurn = RegistryTurn> = InteractionState & {
  entry: TurnEntry<TTurn>;
  generation: number;
  token: string;
};

export type DraftObservation =
  | { type: "delta"; itemId: string }
  | { type: "item"; item: AgentTurnItem }
  | { type: "item-removed"; itemId: string };

export const isTombstone = (entry: TurnEntry) =>
  Boolean(entry.effectiveTerminal) &&
  entry.cleanup === "complete" &&
  ["stored", "empty", "missing"].includes(entry.persist);

export const blocksNewTurn = (entry: TurnEntry | null | undefined) =>
  Boolean(entry && !isTombstone(entry));

/**
 * turn 是否停在用户身上：存在未闭合的审批或追问。
 * 这是「agent 在等你回话」的协议级真相——两张表由 stamp 在
 * approval/user-input 的 requested 与 closed 之间维护，别处无第二个来源。
 */
export const awaitsUserResponse = (entry: TurnEntry | null | undefined) =>
  Boolean(entry && (entry.approvals.size > 0 || entry.userInputs.size > 0));
