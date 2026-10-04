/**
 * [INPUT]: Depends on shared Agent/Chat/MCP/platform DTOs, canonical Project context, hydrated Project Tools and durable Skill receipts, backend session config, App authorization, and built-in MCP leases
 * [OUTPUT]: Defines bridge dependencies including trusted turn admission, dispatch authorization and Skill-isolated session configuration.
 * [POS]: apps/desktop/electron/main/agent/bridge; Narrow Agent bridge contract; Electron composition and executors exchange frozen authority without importing one another
 */

import type { ProviderId } from "@ai-chat/cloud-protocol/contracts/provider";
import type {
  AgentBackendId,
  BackendCapabilities,
  AgentEventBody,
  AgentSendPayload,
  PreparedSkillSelectionReceipt,
  AgentTurnItem,
  SessionRef,
  SteerAdmission,
  SteerDecision,
  SteerIpcReceipt,
  SteerOutboxProjection,
  TurnPersistOutcome,
  TurnFilesystemAccess,
  TurnSnapshot,
} from "../../../../shared/ipc/agent/agent-ipc";
import type {
  ChatMessage,
  PersistedSubagent,
  TurnCommitInput,
} from "../../../../shared/ipc/content/chats-ipc";
import type {
  AgentTurn,
  BackendTurnOptions,
  ResolvedAgentInput,
  ThirdPartyMcpProtocolObservation,
} from "../../backends/types";
import type { AgentProcessLease } from "../../agent-process-supervisor";
import type { IssuedBuiltinMcp } from "../../tools/lease";
import type { TurnEntry } from "../turns/turn/turn-registry-model";
import type { AcpTraceWriter } from "../../backends/acp/trace";
import type {
  AgentTurnCustodyDependency,
  AgentTurnCustodyOwner,
} from "../../../../shared/apps/model/app-lifecycle";
import type { BackendRuntimeSnapshot } from "../../backends/runtime/runtime-registry";
import type { ThirdPartyMcpPlan } from "../../../../shared/ipc/settings/mcp-servers-ipc";
import type { FinalTurnProjection } from "../admission/product-context";
import type { PlatformCapabilities } from "../../../../shared/platform/platform-capabilities";
import type { HydratedProjectTools } from "../../sections/coordinator/admission/prepared-project-tools";
import type { TurnProjectContext } from "../../../../shared/product/product-resource-scope";
import type {
  ExtensionPackageGenerationRef,
  Sha256Digest,
} from "../../../../shared/ipc/settings/extensions-ipc";
import type {
  FrozenTurnMemoryAdmission,
  MemoryPrePromptValidation,
  MemoryRecallProjection,
  PromptHandoff,
} from "../../memory/core/domain";

export type BuiltinTurnToolPolicy = Readonly<{
  /** resolveContext 时冻结；restart/retry 永远复用这一份用户偏好。 */
  disabledTools: readonly string[];
  /** 当前 context 所依据的 runtime capability；spawn CAS 后最终确认。 */
  builtinTools: "none" | "read" | "mutate";
  backendRuntimeIdentity: string;
  /** A workflow step's turn: exact-issue its submit_step_result (set only by main from the workflow turn policy). */
  workflowStep?: true;
}>;

export type TurnProjectionInput = Readonly<{
  handoff?: AgentSendPayload["handoff"];
  freshSession?: boolean;
  conversationId: string;
  requestId: string;
  backendId: AgentBackendId;
  origin?: TurnOrigin;
  planMode: boolean;
}>;

export type AgentContext = {
  sessionRecovery?: BackendTurnOptions["sessionRecovery"];
  onSessionPrompt?: BackendTurnOptions["onSessionPrompt"];
  activeCapabilities?: BackendCapabilities;
  availabilityStart?: import("../../backends/runtime/availability/evidence").TurnEvidenceStart;
  workspace: string;
  /** main 证明的执行类型；只授权 exact-issued、Chat-scoped commit 工具。 */
  managedWorktree?: boolean;
  projectContext?: TurnProjectContext;
  /** Durable main-owned manual selection; runtime capability may narrow channels but never reselect owners. */
  preparedSkillSelection?: PreparedSkillSelectionReceipt;
  appId?: string;
  filesystemAccess?: TurnFilesystemAccess & { controlRoot: string };
  appReferenceRequestId?: string;
  appReferenceEntryIds?: string[];
  /** 本轮 attachment 说明；由 bridge 传入 createTurn，经 prompt 首块下发到所有后端 */
  attachedAppInstructions?: string;
  /** runtime CAS 后唯一冻结的工具/skill/prompt 投影；lease 与 backend 共用。 */
  finalTurnProjection?: FinalTurnProjection;
  /** Exact frozen Skills identity/ref/root owner for this turn. */
  skillsCustodyId?: string;
  skillsRuntimeRoot?: string;
  /** 本轮完整 closed logical lease 集合；custody intent 逐条复验后才交付能力 */
  custodyDependencies?: readonly AgentTurnCustodyDependency[];
  /**
   * 本轮 custody 的 owner。与 `custodyDependencies` 同一处产出：谁能回答
   * 「这个 owner 还活着吗」，谁就该说出 owner 是什么。bridge 自己按
   * conversationId 编一个，会让 owner 与真实的 durable turn 身份脱节。
   */
  custodyOwner?: AgentTurnCustodyOwner;
  builtinToolPolicy?: BuiltinTurnToolPolicy;
  /** Durable manual receipt plus hash-verified candidates; never reconstructed from live stores. */
  preparedProjectTools?: HydratedProjectTools;
  /** runtime CAS 改变 capability 时重建 App refs/instructions 所需的冻结输入。 */
  turnProjectionInput?: TurnProjectionInput;
  /** runtime capability 变更时据此重签 App refs。 */
  turnAppAcquisition?: TurnProjectionInput;
  /** 与 App read roots 分开保存，重建时不会把旧 generation 根带进新 context。 */
  baseReadOnlyRoots?: readonly string[];
  /** sealed package MCP 的瞬时 resolved config；只在 main 内存穿过，不进 IPC/ledger。 */
  packageMcpEntries?: readonly ThirdPartyMcpPlan["entries"][number][];
  /** Exact delivery facts actually materialized for this turn/session. */
  extensionDiscoveryBindings?: readonly Readonly<{
    kind: "ambient-projection" | "app-delivery";
    authorityId: string;
    planInstanceId?: string;
    packageGenerationRef: ExtensionPackageGenerationRef;
    componentInstanceIdentity: string;
    deliveryIdentity: Sha256Digest;
  }>[];
  /** request 级隐私身份能力；不进入 FinalTurnProjection，resume 只能原样透传。 */
  memory?: FrozenTurnMemoryAdmission;
};

import type { TurnOrigin } from "../turns/turn/turn-registry-model";
export type { TurnOrigin };

/** publish 端口的入参：requestId 由 bridge 统一补章，判别联合逐 variant 剥离。 */
export type AgentEventPayload = AgentEventBody extends infer Event
  ? Event extends AgentEventBody
    ? Omit<Event, "requestId">
    : never
  : never;

export type ConversationAdmission = (
  conversationId: string,
  register: () => Promise<void>
) => Promise<void>;

export type AppendTurnResult = {
  outcome: TurnPersistOutcome;
  storedMessage?: ChatMessage;
  subagents?: Record<string, PersistedSubagent>;
  error?: Error;
};

export type BridgeEntry = TurnEntry<AgentTurn> & {
  artifacts?: ReturnType<import("../../artifacts/service").ArtifactService["begin"]>;
  payload?: AgentSendPayload;
  context?: AgentContext;
  builtinMcp?: IssuedBuiltinMcp;
  processLease?: AgentProcessLease;
  trace?: AcpTraceWriter;
  /** 首次 spawn 前冻结；resume 重试复用同一份，不回读 live 配置。 */
  thirdPartyMcpPlan?: ThirdPartyMcpPlan;
  /** 首次 createTurn 冻结；同一 request 的 resume/retry 不重新读取 Settings。 */
  backendSessionConfig?: BackendTurnOptions["backendSessionConfig"];
  memoryRecall?: MemoryRecallProjection;
  memoryPrePromptValidation?: MemoryPrePromptValidation;
  memoryContribution?: {
    release(): void;
  };
  promptHandoff?: PromptHandoff;
};

export type AgentBridgeOptions = {
  /** Product composition injects the current OS matrix; tests omit it unless exercising the gate. */
  platformSupport?: PlatformCapabilities;
  traceDirectory?: string;
  resolveContext: (
    conversationId: string,
    payload?: AgentSendPayload,
    origin?: TurnOrigin,
    preparedProjectTools?: HydratedProjectTools
  ) => Promise<AgentContext> | AgentContext;
  releaseContext?: (context: AgentContext) => Promise<void> | void;
  /** runtime identity CAS 后、input/lease 物化前的唯一 context 重投影口。 */
  finalizeContextForRuntime?: (
    context: AgentContext,
    runtime: BackendRuntimeSnapshot
  ) => Promise<AgentContext> | AgentContext;
  resolveAppEnvironment?: (appId: string) => Promise<NodeJS.ProcessEnv>;
  /** Freeze main-only session config; isolated Skills exclude ambient plugin projections, not Provider settings. */
  freezeBackendSessionConfig?: (
    backend: AgentBackendId,
    options?: { isolateSkills: boolean }
  ) =>
    | BackendTurnOptions["backendSessionConfig"]
    | Promise<BackendTurnOptions["backendSessionConfig"]>;
  withConversationAdmission: ConversationAdmission;
  onAppTurnCompleted: (
    appId: string,
    conversationId: string,
    requestId: string
  ) => Promise<void>;
  onAppTurnFailed?: (
    appId: string,
    conversationId: string,
    requestId: string
  ) => Promise<void>;
  assertChatBackend?: (
    conversationId: string,
    backend: ProviderId
  ) => Promise<void> | void;
  conversationIncarnation?: (conversationId: string) => string | undefined;
  assertTurnAdmission?: (payload: AgentSendPayload, authority?: import("../../backends/types").TrustedTurnAuthority) => Promise<void> | void;
  prepareFreshRetry?: (payload: AgentSendPayload, userMessageId?: string) => Promise<AgentSendPayload["handoff"]>;
  reserveAssistantSequence?: (conversationId: string) => Promise<number>;
  /** 主 turn 的后端中立 item 观察口；发布前同步执行的 void 派生，subagent part 不走此回调。 */
  onTurnItem?: (conversationId: string, item: AgentTurnItem) => void;
  steer?: (input: SteerAdmission) => Promise<SteerIpcReceipt>;
  decideSteer?: (input: SteerDecision) => Promise<SteerIpcReceipt>;
  ackSteerIntents?: (outboxRefs: string[]) => Promise<void>;
  steerSnapshot?: (
    conversationId: string
  ) => Promise<SteerOutboxProjection[]> | SteerOutboxProjection[];
  conversationForOutboxRef?: (outboxRef: string) => string | undefined;
  onSessionBound?: (
    conversationId: string,
    session: SessionRef,
    context: AgentContext | undefined
  ) => Promise<void>;
  replaceSession?: (
    conversationId: string,
    expected: SessionRef,
    next: SessionRef | null
  ) => Promise<void>;
  projectTurnSnapshot?: (
    conversationId: string,
    snapshot: TurnSnapshot
  ) => TurnSnapshot;
  resolveInput: (
    payload: AgentSendPayload,
    workspace: string,
    capabilities: BackendCapabilities,
    context: AgentContext
  ) => Promise<ResolvedAgentInput> | ResolvedAgentInput;
  /** runtime finalization 后唯一 late-context merge；fresh/reuse/resume 同路。 */
  mergeLateInput?: (
    resolved: ResolvedAgentInput,
    requestId: string
  ) => Promise<ResolvedAgentInput> | ResolvedAgentInput;
  recallMemory?: (
    input: Readonly<{
      admission: FrozenTurnMemoryAdmission;
      queryText: string;
      signal: AbortSignal;
      deadlineAt: number;
    }>
  ) => Promise<MemoryRecallProjection>;
  prepareMemoryContribution?: (
    admission: FrozenTurnMemoryAdmission,
    projection: MemoryRecallProjection
  ) => {
    kind: string;
    text: string;
    count: number;
    bytes: number;
    consume(): MemoryPrePromptValidation;
    /** 必选：这是撤销 contribution 的唯一句柄，可选会让全部撤销点静默失效。 */
    release(): void;
  } | null;
  assertPlanAvailable?: (
    requested: boolean,
    workspace: string,
    backend: AgentBackendId
  ) => Promise<void> | void;
  appendTurnResult?: (
    conversationId: string,
    input: TurnCommitInput
  ) => Promise<AppendTurnResult>;
  loadSubagents?: (
    conversationId: string
  ) => Promise<Record<string, PersistedSubagent>>;
  issueBuiltinMcp?: (
    payload: AgentSendPayload,
    generation: number,
    origin: TurnOrigin | undefined,
    context: AgentContext
  ) => IssuedBuiltinMcp | undefined;
  resolveThirdPartyMcpPlan?: (input: {
    backendId: AgentBackendId;
    backendRuntimeIdentity: string;
    planMode: boolean;
    origin?: TurnOrigin;
    context: AgentContext;
  }) => ThirdPartyMcpPlan;
  /** backend 协议确认进入 health authority；spawn/进程存活不属于这条证据链。 */
  observeThirdPartyMcpProtocol?: (
    observation: ThirdPartyMcpProtocolObservation
  ) => void;
  /** Fires only after the backend has entered the active turn state. */
  onTurnStarted?: (event: {
    conversationId: string;
    requestId: string;
    explicitDesign: boolean;
    context: AgentContext;
  }) => Promise<void> | void;
  onTurnSettled?: (event: {
    conversationId: string;
    requestId: string;
    assistantMessageId: string;
    planRequested: boolean;
    origin?: TurnOrigin;
    context?: AgentContext;
    terminal: "done" | "cancelled" | "error";
    outcome: TurnPersistOutcome;
    assistantMessage?: ChatMessage;
    /** Whether the turn's process and leases were released; settled before this fires (a workflow step's latch reads it). */
    cleanup: "pending" | "complete" | "failed";
  }) => Promise<void> | void;
  onTurnPrepared?: (event: {
    conversationId: string;
    requestId: string;
    assistantMessageId: string;
    planRequested: boolean;
    origin?: TurnOrigin;
    context?: AgentContext;
    terminal: "done" | "cancelled" | "error";
    facts?: { skillDescriptionsTruncated?: true };
    commit: TurnCommitInput;
  }) => Promise<void> | void;
  onSteerFenceTimeout?: (event: {
    requestId: string;
    opEpochs: number[];
  }) => Promise<void> | void;
  onCompletedImage?: (event: {
    conversationId: string;
    messageId: string;
    assistantSeq: number;
    itemOrdinal: number;
    item: AgentTurnItem;
    workspaceRoot: string;
  }) => Promise<void> | void;
};
