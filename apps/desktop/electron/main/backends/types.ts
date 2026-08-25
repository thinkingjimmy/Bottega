/**
 * [INPUT]: Depends on shared agent/MCP DTO, AbortSignal and Node subprocess environment type
 * [OUTPUT]: Provides descriptor/runtime/failure, AgentTurn, prompt, first productContext, release sensitive contribution, frozen third-party MCP/backend session config, Plan decision cards, synthesized static tables and protocol health observation callback, trusted input/sandbox/maintenance contracts; ACP launch overlay with builtin and backend-config plan
 * [POS]: The module's behavior limits are backends; The name of the registry combination is expanded, transport and business organization are recognized only through this document
 */

import type {
  AgentApprovalDecision,
  AgentBackendId,
  AgentSendPayload,
  AgentSubagentMeta,
  AgentTurnItem,
  AgentUserInputAnswers,
  AgentUserInputQuestion,
  AgentUserInputRequest,
  BackendAuthStatus,
  BackendCapabilities,
  BackendModelInfo,
  FailureKind,
  HeadlessPurpose,
  PromptHandoff,
  SensitiveContributionValidation,
  SessionRef,
  UsageLimitInfo,
  TurnFilesystemAccess,
} from "../../../shared/agent-ipc";
import type { ContentBlock } from "@agentclientprotocol/sdk";
import type { CleanupResult } from "../process-group";
import type {
  BuiltinMcpLease,
  BuiltinMcpServerSpec,
} from "../tools/lease";
import type { SubagentRegistry } from "../../../shared/subagent-registry";
import type { McpComponentHealthSubject } from "../../../shared/extensions-ipc";

/**
 * OpenCode 1.18.14 的 ACP builtins 尚未移植 plan_exit，无法产出原生
 * plan-review 事件；但产品的下一 turn 决策链完整，故只在 commit 期合成。
 * 其余后端 fail-closed，继续消费各自的原生 planMessageKind 通道。
 */
export const PLAN_DECISION_SYNTHESIS: Record<AgentBackendId, boolean> = {
  claude: false,
  codex: false,
  kimi: false,
  opencode: true,
};

export type ThirdPartyMcpProtocolObservation = Readonly<{
  outcome: "success" | "failure";
  subject: McpComponentHealthSubject;
  /** 仅传脱敏后的协议事实；authoritative main owner 负责 canonical digest。 */
  evidence: string;
}>;

export type AgentRuntime = {
  executable: string;
  path: string;
};

export type ResolvedRuntime = AgentRuntime & { version: string };

export type RuntimeValidation =
  | { status: "installed" }
  | { status: "unsupported"; reason: string };

// 判别联合而非可选字段：usage-limit 必然带窗口信息，
// 类型上就不存在"声称限流却说不出是哪个窗口"的中间态。
export type BackendFailure =
  | { kind: "auth-required" | "unknown"; message: string }
  | { kind: "usage-limit"; message: string; limit: UsageLimitInfo };

/**
 * 分类线索：限流窗口在 ACP 上是带外到达的（Claude 走 usage_update notification，
 * 不在 error 里），所以判据只能由 turn 把最近快照喂回分类器。
 */
export type FailureHints = {
  rateLimit?: unknown;
};

export type ResolvedAgentInputItem =
  | { type: "text"; text: string }
  /** `resolvedOnly` 标记系统展开产物（当前只有 `@Section` 附件）：它不在用户
   *  `input` 里，出错时报因也不该说成"你贴的图"。 */
  | { type: "image"; dataUrl: string; filename: string; resolvedOnly?: true }
  | { type: "skill"; name: string; path: string }
  | { type: "mention"; name: string; path: string };

export type ResolvedAgentInput = {
  input: ResolvedAgentInputItem[];
  commit(): void;
  rollback(): void;
  release(): Promise<void>;
};

export type AgentTurnCallbacks = {
  onThread: (session: SessionRef) => Promise<void>;
  onItemDelta: (itemId: string, text: string) => void;
  onItem: (item: AgentTurnItem) => void;
  onApproval: (approval: import("../../../shared/agent-ipc").AgentApprovalRequest) => void;
  onApprovalClosed: (approvalId: string) => void;
  onTerminal: (event: {
    type: "done" | "cancelled" | "error";
    message?: string;
    failureKind?: FailureKind;
    usageLimit?: UsageLimitInfo;
  }) => void;
  onProcessError: (failure: BackendFailure) => void;
  onPolicyViolation?: (violation: { budget: string; detail: string }) => void;
  onUserInput?: (request: AgentUserInputRequest) => void;
  onUserInputClosed?: (userInputId: string) => void;
  onSubagentUpdate?: (agent: AgentSubagentMeta) => void;
  onSubagentItem?: (agentThreadId: string, item: AgentTurnItem) => void;
  onSubagentItemDelta?: (
    agentThreadId: string,
    itemId: string,
    text: string
  ) => void;
  onThirdPartyMcpProtocol?: (
    observation: ThirdPartyMcpProtocolObservation
  ) => void;
};

export type AgentTurnTrace = {
  recordWire(dir: "in" | "out", line: string): void;
  recordMapped(
    event:
      | { type: "delta"; itemId: string; text: string }
      | { type: "item"; item: AgentTurnItem }
  ): void;
};

export type StartOutcome = "started" | "resume-failed";

export type AdapterSteerOutcome =
  | { outcome: "injected" }
  | {
      outcome: "unconsumed";
      /** `staged-resource`：附件快照晚于围栏冻结，只能由下一轮带读面重发。 */
      reason:
        | "promptRequired"
        | "not-in-flight"
        | "unsupported"
        | "staged-resource";
    }
  | { outcome: "ambiguous"; reason: string };

export type AgentTurn = {
  readonly pid: number | undefined;
  readonly steeringSupported?: boolean;
  /** 通用 prompt writer 终态；response Promise 不得代替它。必选：可选会让
      「backend 未实现」与「prompt 从未创建」共用 not-created，已发送的
      contribution 会被 receipt 谎报成 prompt-not-issued。 */
  promptHandoff(): Promise<PromptHandoff>;
  start(startupSignal?: AbortSignal): Promise<StartOutcome>;
  steer?(prompt: ContentBlock[]): Promise<AdapterSteerOutcome>;
  respondApproval(
    approvalId: string,
    decision: AgentApprovalDecision
  ): Promise<void>;
  interrupt(): void;
  markStopped(): void;
  pendingUserInput?(
    userInputId: string
  ): { questions: AgentUserInputQuestion[] } | undefined;
  respondUserInput?(userInputId: string, answers: AgentUserInputAnswers): void;
};

/* ============================================================
 * 进程宿主：一个 turn 只能有一条取得进程的路。
 *
 * `launch` 交出的是**完整 capability**——命令（可能已被围栏包装）、参数、
 * workspace cwd 与 backend env。custody 宿主只会在 durable
 * `activation-authorized` 落账之后才经 authenticated channel 把它交出去，
 * 所以 transport 侧构造 launch 与 backend 真的拿到 launch 是两个时刻。
 * `delivered` 就是后一个时刻：直连宿主立即兑现，custody 宿主等 ack。
 * ============================================================ */
export type AgentProcessLaunch = {
  command: string;
  args: readonly string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
};

export type AgentProcessLauncher = (
  request: AgentProcessLaunch
) => import("node:child_process").ChildProcessWithoutNullStreams;

export type AgentProcessHost = {
  /** 同步返回宿主进程；它的 0/1/2 就是 backend 的 0/1/2 */
  launch: AgentProcessLauncher;
  readonly delivered: Promise<void>;
};

export type BackendTurnOptions = {
  payload: AgentSendPayload;
  input: ResolvedAgentInput;
  callbacks: AgentTurnCallbacks;
  runtime: ResolvedRuntime;
  workspace: string;
  /** 缺省是直连 spawn；产品路径恒由组合根注入 custody guardian 宿主 */
  processHost?: AgentProcessHost;
  processEnv?: NodeJS.ProcessEnv;
  /** 第一次 createTurn 前冻结；同一 request 的 resume/retry 复用，不回读 live Settings。 */
  backendSessionConfig?: Readonly<{
    codexSkillRules?: readonly Readonly<{ path: string; enabled: false }>[];
  }>;
  filesystemAccess?: TurnFilesystemAccess & { controlRoot: string };
  subagents: SubagentRegistry;
  trace?: AgentTurnTrace;
  builtinMcp?: {
    server: BuiltinMcpServerSpec;
    lease: BuiltinMcpLease;
    waitReady(signal: AbortSignal): Promise<void>;
  };
  /** main/bridge 冻结的整 server inclusion 计划；backend 只负责协议翻译。 */
  thirdPartyMcpPlan?: import("../../../shared/mcp-servers-ipc").ThirdPartyMcpPlan;
  /** main 在 runtime CAS 后冻结的产品上下文；逐 spawn 作为 prompt 首块下发。 */
  productContext?: string;
  /** 通用敏感 prompt contribution；backend 只消费 lease，不理解其业务来源。 */
  sensitiveContribution?: {
    kind: string;
    text: string;
    count: number;
    bytes: number;
    consume(): SensitiveContributionValidation;
    /** prompt 未创建/attempt 结束时释放 fresh lease；已 consume 时幂等 no-op。 */
    release?(): void;
  };
  onPromptContributionValidation?(value: SensitiveContributionValidation): void;
};

export type SetupTerminalAction = "install" | "update" | "login";

export type SetupCommand = {
  command: string;
  dangerous: boolean;
};

export type SetupExtension = {
  commands: Partial<Record<SetupTerminalAction, SetupCommand>>;
  latestVersion?(): Promise<string>;
};

/**
 * `unknown` 是一等结论，不是缺省值：没有 auth 扩展、或握手只能证明进程健康
 * 而证不了登录态的后端（OpenCode），必须能诚实地说「没结论」。把它折成
 * `authenticated` 就是伪造登录态。
 */
export type AuthCheckStatus = Extract<
  BackendAuthStatus,
  "authenticated" | "unauthenticated" | "unknown" | "error"
>;

export type AuthCheckResult = {
  status: AuthCheckStatus;
  /** 探针给出的原始可操作诊断；Registry 必须原样投影给 UI 与 runner。 */
  reason?: string;
};

export type AuthExtension = {
  check(runtime: ResolvedRuntime, signal?: AbortSignal): Promise<AuthCheckResult>;
  /** provider 表示单次模型 turn 不能代表整个 backend 的认证态。 */
  turnEvidence?: "backend" | "provider";
};

/* ============================================================
 * ACP 进程启动三元组。
 *
 * 抽出来只为一件事：让「怎么起这个后端」在 createTurn 与 readiness 探测
 * 之间只有一份。两份必然漂移，而漂移的那一份往往正是安全基线
 * （OpenCode 的锁定监听参数、每 turn 随机凭据、ask 档）。
 * ============================================================ */
export type AcpLaunch = {
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
};

export type AcpLaunchOverlay = {
  /** 持久授权派生的 App 环境；readiness 探测恒缺席。 */
  processEnv?: NodeJS.ProcessEnv;
  /**
   * 审批档（Codex 经 CODEX_CONFIG、OpenCode 经 OPENCODE_PERMISSION）、Plan 档
   * （仅 OpenCode：它的 plan 由 agent 切换**加**权限收紧两半构成，后一半在
   * env 里，赶不上 `session/set_config_option`）、内置 MCP 与产品 Skill 规则（仅 Codex）。
   * readiness 恒缺席——握手不跑 turn、不带内置工具。这不是分支，是这一格
   * 数据本来就没有；缺席即按最严档位落地。
   */
  session?: {
    approveForMe?: boolean;
    planMode?: boolean;
    builtinMcp?: BuiltinMcpServerSpec;
    thirdPartyMcpPlan?: import("../../../shared/mcp-servers-ipc").ThirdPartyMcpPlan;
    skillRules?: readonly Readonly<{ path: string; enabled: false }>[];
  };
};

export type AcpLauncher = (
  runtime: ResolvedRuntime,
  overlay?: AcpLaunchOverlay
) => AcpLaunch;

export type ModelsExtension = {
  list(
    runtime: ResolvedRuntime,
    workspace: string,
    signal?: AbortSignal
  ): Promise<BackendModelInfo[]>;
  /** 用户显式 Recheck 时丢弃本后端的目录缓存；TTL 是省事的默认，不是真相。 */
  invalidate?(): void;
};

export type SkillsExtension = {
  sources(workspace: string): Array<{
    path: string;
    scope: "user" | "repo" | "system";
  }>;
};

export type HeadlessJob = {
  purpose: HeadlessPurpose;
  cwd: string;
  sandboxRoot: string;
  readRoots: string[];
  toolPolicy: "none" | "workspace";
  ephemeral: boolean;
  prompt: string;
  untrustedContent?: string;
  model?: string;
  sandbox: "read-only" | "workspace-write";
  network: boolean;
  approvalPolicy: "never";
  env: "isolated-home" | "user-default";
  /** 仅产品侧持久授权派生的 App 配置；不得接受 manifest 直通变量名。 */
  processEnv?: NodeJS.ProcessEnv;
  homeDir?: string;
  ignoreUserConfig: boolean;
  outputSchema?: string;
  timeoutMs: number;
  onProcessGroup?: (pid: number) => Promise<void> | void;
  onProcessExit?: (pid: number) => Promise<void> | void;
};

export type HeadlessParserState = {
  text: string;
  json?: unknown;
  error?: string;
  events: AgentTurnItem[];
};

export type HeadlessExecutionSpec = {
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
  /** 未提供时由 executor 投递 job prompt；空字符串表示 prompt 已安全进入 argv。 */
  stdin?: string;
  /** backend 仅用于已完成独立 enforcement matrix 的原生 OS 沙箱。 */
  osSandbox?: "executor" | "backend";
  /** 本后端自己的凭据/状态根；executor 据此在围栏中放行，其余后端的凭据仍拒读。 */
  credentialRoots?: string[];
  /**
   * 声明源只读面（如一次性状态根里凭据 symlink 的真实来源）：围栏读放行、
   * 写在 allow 后重新 deny。foreign 敏感面的双 deny 排在最后，声明不了别家凭据。
   */
  readOnlyRoots?: string[];
  /**
   * spec 预备的一次性产物（如 disposable 状态根）的回收钩子。executor 保证
   * 恰好调用一次：spawn 后在进程组清理落定之后，preflight 失败则在拒绝之前。
   */
  release?(): Promise<void>;
  parseLine(line: string, state: HeadlessParserState): void;
};

export type HeadlessRun = {
  events: AsyncIterable<AgentTurnItem>;
  result: Promise<{ text: string; json?: unknown }>;
  cancel(): Promise<void>;
  settled: Promise<CleanupResult>;
};

export type MaintenanceJobInput = {
  purpose: Extract<HeadlessPurpose, "install-analysis" | "repair" | "serve">;
  cwd: string;
  prompt: string;
  outputSchema?: string;
  sandbox: "read-only" | "workspace-write";
  network: boolean;
  processEnv?: NodeJS.ProcessEnv;
  timeoutMs: number;
  onProcessGroup?: HeadlessJob["onProcessGroup"];
  onProcessExit?: HeadlessJob["onProcessExit"];
};

export type MaintenanceSession = {
  createJob(input: MaintenanceJobInput): HeadlessJob;
  applyExtension(input: {
    userData: string;
    record: { id: string; displayName: string; dir: string };
    appDir: string;
    value: unknown;
    execute: (
      executable: string,
      args: string[],
      options: {
        cwd: string;
        env: NodeJS.ProcessEnv;
        allowFailure?: boolean;
      }
    ) => Promise<{ stdout: string }>;
    appendLog: (line: string) => Promise<void>;
  }): Promise<void>;
  inspectToolInventory(workspace: string): Promise<unknown>;
  validateRequirements(requirements: unknown, inventory: unknown): void;
};

export type MaintenanceAdapter = {
  open(input: {
    userData: string;
    appId: string;
    workspace: string;
    runtime: ResolvedRuntime;
  }): Promise<MaintenanceSession>;
  cleanup(input: { userData: string; appId: string }): Promise<void>;
};

export type ConnectionDescriptor = {
  id: AgentBackendId;
  displayName: string;
  workspaceDirName: string;
  /**
   * 按发现优先级返回全部可执行候选；Registry 负责逐个验证版本与文件身份。
   * 发现层不得提前裁成一个，否则 PATH 里的旧 shim 会遮住后面的有效安装。
   */
  detectRuntime(signal?: AbortSignal):
    | readonly AgentRuntime[]
    | Promise<readonly AgentRuntime[]>;
  /**
   * `--version` 探针的子进程环境；缺省是七变量最小用户环境。
   * CLI 的状态根随 env 漂移（XDG 等）时必须声明，否则探针会在错位的目录里
   * 建目录、落缓存，与真实 turn 各说各话。
   */
  versionEnvironment?(runtime: AgentRuntime): NodeJS.ProcessEnv;
  validateTurnOptions(value: unknown): void;
  validateSessionId(sessionId: string): boolean;
  createTurn(options: BackendTurnOptions): AgentTurn;
};

export type CapabilityProvider = {
  capabilitiesFor(runtime: ResolvedRuntime): BackendCapabilities;
  validateRuntime(runtime: ResolvedRuntime): RuntimeValidation;
};

export type FailureClassifier = {
  classifyFailure(cause: unknown, hints?: FailureHints): BackendFailure;
};

export type HeadlessExtension = {
  purposes: HeadlessPurpose[];
  /** 允许异步：spec 可以先预备一次性状态根（symlink 凭据）再交出执行面。 */
  spec(
    job: HeadlessJob,
    runtime: ResolvedRuntime
  ): HeadlessExecutionSpec | Promise<HeadlessExecutionSpec>;
};

export type BackendDescriptor =
  & ConnectionDescriptor
  & CapabilityProvider
  & FailureClassifier
  & {
  setup?: SetupExtension;
  auth?: AuthExtension;
  models?: ModelsExtension;
  skills?: SkillsExtension;
  headless?: HeadlessExtension;
  maintenance?: MaintenanceAdapter;
};
