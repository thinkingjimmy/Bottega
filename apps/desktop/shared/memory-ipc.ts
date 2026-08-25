/**
 * [INPUT]: Depends on the type of sequentially based base; It's not dependent on Electron, Node or DOM
 * [OUTPUT]: Provides Memory provider/receipt/effectiveTarget, main-owned observation scope, recall/source observation, directory warning/error, three-phase durable version change, provider/revision fenced version directory and preload bridge agreement; The momentary facts must be filled and `| null` Expression of absence
 * [POS]: The shared memory is the only source of truth for IPC; main, preload, renderer only exchanged the value defined in this file
 */

export type MemorySkipReason =
  | "disabled"
  | "paused"
  | "plan-mode"
  | "prompt-not-issued";

export type MemoryFailureKind =
  | "initialization"
  | "scope-resolution"
  | "policy-store"
  | "runtime-configuration"
  | "identity"
  | "provider"
  | "ownership"
  | "deadline"
  | "render-budget"
  | "stale-capability";

export type MemoryTurnOutcome =
  | Readonly<{ kind: "used"; count: number }>
  | Readonly<{ kind: "none" }>
  | Readonly<{ kind: "unavailable"; failureKind: MemoryFailureKind }>
  | Readonly<{ kind: "skipped"; reason: MemorySkipReason }>;

export type TurnContextReceipt = Readonly<{
  version: 1;
  requestId: string;
  memory: MemoryTurnOutcome;
}>;

/* ============================================================
 * descriptor 是「插件的自我介绍」：前端下拉、安装面板、重建按钮
 * 与探针分支全部由它派生。新增 provider 只在 main 注册表加一条，
 * 本文件一个字都不用改——这是 D5「新插件 = 单文件」的前提。
 * ============================================================ */

export type MemoryCommitModel = "async-task" | "sync";
export type MemoryPurgeModel = "workspace-purge" | "runtime-reset";

export type MemoryProviderDescriptor = {
  id: string;
  displayName: string;
  /** 一句话说清它是什么、与同类的关键差别；呈现层不再维护第二份说明。 */
  summary: string;
  /** 项目主页；没有可公开地址时为 null，界面就不画那条链接——
      与其编一个打不开的 URL，不如诚实地什么都不显示。 */
  homepage: string | null;
  /** async-task 有 taskId 可轮询对账；sync 一次调用即终态，重放为 at-least-once。 */
  commitModel: MemoryCommitModel;
  /** 清库原语：provider API 清 workspace，或托管运行时整根重置。 */
  purgeModel: MemoryPurgeModel;
  /** 由本产品托管安装与运行（可插拔下载 + launchd）。 */
  managed: boolean;
  defaultBaseUrl: string;
  /** 额外配置面板 id；null 表示装完即可用。 */
  configPanelId: string | null;
  /** 托管运行时的锁定版本；没有安装规格时为 null。 */
  lockedVersion: string | null;
};

export type MemoryHealth =
  | "unknown"
  | "checking"
  | "ready"
  | "compat"
  | "unavailable";

/* 健康探针的病因事实：kind 是分类，detail 是原始证据。
   version 只出现在 compat：版本漂移降级为可用 + 警示，不一票否决。
   configuration 是托管两阶段安装的中间态，不是故障。 */
export type MemoryHealthIssue = {
  kind:
    | "unreachable"
    | "unhealthy"
    | "auth"
    | "version"
    | "protocol"
    | "configuration"
    /* 端口监听者不是托管实例（自有服务已死、外部进程接管同端口）。
       health 探针会通过（对方也答 /health），但把对话发给它是信息泄漏——
       身份校验（launchd PID ↔ lsof 监听者）不符即 fail-closed。 */
    | "identity";
  detail: string;
};

/* ============================================================
 * effectiveTarget：main-only resolver 的唯一输出（D13）。
 * renderer 只显示，不再自己拼「provider + baseUrl 谁说了算」。
 * 任何不一致都 fail-closed：canEnable=false + blockedReason。
 * ============================================================ */

export type MemoryEffectiveTarget = {
  providerId: string;
  baseUrl: string;
  source: "manifest" | "default";
  managed: boolean;
  instanceId: string | null;
  providerDataInstanceId: string | null;
  /** coordinator 冻结的已安装版本；status 只消费，不反向读取 manifest。 */
  expectedVersion?: string | null;
  canConfigure: boolean;
  canRebuild: boolean;
  canEnable: boolean;
  blockedReasonCode?: "ownership" | "configuration" | "not-installed" | null;
  blockedReason: string | null;
};

/* ============================================================
 * needs-attention：每一类挂起都带定义好的恢复动作（D14）。
 * 「只展示不可操作」的挂起等于永久红点，不配存在。
 * ============================================================ */

/* 正文漂移不在册：它已被批自己就地跳过并记 gap，没有留给用户的
   动作。挂一条无事可做的挂起，只是把「已处理」伪装成「待处理」。
   配置 apply 失败同理不在册：applyStatus 常驻告警 + 前向重试自己
   收敛，没有留给用户的动作。 */
export type MemoryAttentionKind =
  | "capture-gap"
  | "cleanup-failed"
  | "rebuild-failed"
  | "capacity-pressure";

export type MemoryAttentionAction =
  | "acknowledge"
  | "retry-cleanup"
  | "compact"
  | "abandon"
  | "resume-rebuild";

export type MemoryAttentionItem = {
  id: string;
  kind: MemoryAttentionKind;
  sessionKey: string | null;
  detail: string;
  at: number;
  actions: MemoryAttentionAction[];
};

export type MemoryRebuildPhase =
  | "prepared"
  | "quiescing"
  | "reconciling"
  | "purging"
  | "watermarks-cleared"
  | "backfilling"
  | "completed"
  | "failed";

export type MemoryRebuildSnapshot = {
  jobId: string;
  phase: MemoryRebuildPhase;
  purgedScopes: number;
  totalScopes: number;
  backfilledTurns: number;
  totalTurns: number;
  startedAt: number;
  error: string | null;
};

/** 四项均只投影当前 sharing mode/generation；gap = 裁剪线 ∩ allow ∩ 未交付。 */
export type MemoryDeliverySnapshot = {
  pendingTurns: number;
  inflightBatches: number;
  deliveredTurns: number;
  gapTurns: number;
};

export type MemoryObservationScope = Readonly<{
  providerDataInstanceId: string;
  sharingMode: import("./settings-ipc").MemorySharingMode;
  sharingGeneration: number;
}>;

export type MemoryRecallSnapshot = Readonly<{
  usedTurns: number;
  zeroTurns: number;
  failedTurns: number;
  lastAt: number | null;
  lastOutcome: "used" | "none" | "unavailable" | null;
  lastCount: number | null;
}>;

type MemorySupplyCounts = Readonly<{
  id: string;
  delivered: number;
  pending: number;
  gap: number;
}>;

export type MemorySupplyRow = MemorySupplyCounts &
  (
    | Readonly<{
        kind: "chat";
        chatId: string;
        title: string | null;
        state: "active" | "archived" | "deleted";
      }>
    | Readonly<{ kind: "foreign" }>
  );

export type MemorySupplyResult =
  | Readonly<{ state: "disabled" }>
  | Readonly<{
      state: "ready";
      scope: MemoryObservationScope;
      rows: MemorySupplyRow[];
      totalStreams: number;
      totalDelivered: number;
    }>;

export type MemoryStatusSnapshot = {
  enabled: boolean;
  paused: boolean;
  provider: string;
  baseUrl: string;
  target: MemoryEffectiveTarget | null;
  health: MemoryHealth;
  healthIssue: MemoryHealthIssue | null;
  lastCaptureAt: number | null;
  warning: string | null;
  /* 瞬态字段一律用 `| null` 表达缺席，而不是让键本身消失：可选键会让
     每个读者各自发明一份兜底默认值，于是「还没测到」与「测到是零」在
     四五个地方被判成不同的事。契约里少一个 `?`，呈现层就少一整套 ?? 。 */
  recallWarning: string | null;
  runningVersion: string | null;
  recall: MemoryRecallSnapshot;
  /** main-owned 当前观测范围；暂停时保持最后 live Consent，renderer 不得重建。 */
  observationScope: MemoryObservationScope | null;
  epoch: {
    effectiveAt: number;
    sharingGeneration: number;
  } | null;
  /** Settings Owner 的 apply 收敛记账：磁盘新、runtime 旧的窗口可观测。 */
  applyStatus: {
    state: "pending" | "failed";
    message: string | null;
    at: number;
  } | null;
  delivery: MemoryDeliverySnapshot;
  rebuild: MemoryRebuildSnapshot | null;
  attention: MemoryAttentionItem[];
};

/** preview 只暴露数量、边界与目的地；正文永不跨 renderer IPC。 */
export type MemoryConsentReason = "enable" | "cutover" | "sharing" | "rebuild";

export type MemoryConsentPreview = Readonly<{
  reason: MemoryConsentReason;
  providerId: string;
  providerDataInstanceId: string;
  hostname: string;
  model: string;
  previousHostname: string | null;
  previousModel: string | null;
  currentSharingMode: import("./settings-ipc").MemorySharingMode | null;
  nextSharingMode: import("./settings-ipc").MemorySharingMode;
  nextSharingGeneration: number;
  includeHistory: boolean;
  chats: number;
  turns: number;
  from: number | null;
  to: number | null;
  gaps: number;
  digest: string;
}>;

export type MemoryConsentAuthority = Readonly<{
  token: string;
  preview: MemoryConsentPreview;
  expiresAt: number;
}>;

export type MemoryRuntimeConfigPreview = Readonly<{
  providerId: string;
  providerDataInstanceId: string;
  currentHostname: string;
  currentModel: string;
  nextHostname: string;
  nextModel: string;
  change: "none" | "model" | "hostname" | "hostname-and-model";
  requiresConfirmation: boolean;
  digest: string;
}>;

export type MemoryRuntimeConfigAuthority = Readonly<{
  token: string;
  preview: MemoryRuntimeConfigPreview;
  expiresAt: number;
}>;

/* ============================================================
 * 托管运行时：Coordinator 串行槽的唯一投影。operationId 只防迟到
 * 展示，真并发由 owner 的串行队列消灭。
 *
 * 这里只列会改变磁盘/launchd 的动作。读版本目录不在其中——它不该
 * 把 phase 打成 running，把整块面板变灰。
 * ============================================================ */

export type MemoryRuntimeOperation =
  | "install"
  | "repair"
  | "upgrade"
  | "switch-version"
  | "config-write"
  | "config-regenerate"
  | "config-adopt-manual"
  | "bootstrap"
  | "bootout"
  | "runtime-reset"
  /** 反向三步：bootout → 删 plist → 删整个托管根（含数据）；授权账本不动。 */
  | "uninstall";

/** renderer 只能发起用户可见的非破坏性维护；私有原语与卸载不越 preload。 */
export type MemoryRuntimeRendererCommand =
  | "install"
  | "repair"
  | "upgrade"
  | "switch-version";

export type MemoryDestructiveOperation = "uninstall" | "rebuild";

export type MemoryDestructiveAuthority = {
  token: string;
  providerId: string;
  operation: MemoryDestructiveOperation;
  expiresAt: number;
};

export type MemoryRuntimeSnapshot = {
  providerId: string;
  /** per-provider 单调序号；renderer 只接受不低于当前 revision 的快照。 */
  revision: number;
  supported: boolean;
  installed: boolean;
  serviceReachable: boolean;
  /** configuration-required：静态 env 已就位、密钥未提交，禁止启用 Memory。 */
  phase: "idle" | "running" | "failed" | "configuration-required";
  operation: MemoryRuntimeOperation | null;
  operationId: string | null;
  step: string | null;
  stepIndex: number;
  stepTotal: number;
  operationStartedAt: number | null;
  transfer: {
    receivedBytes: number;
    totalBytes: number;
    /** 已有模型未通过完整性校验，本次传输是自动修复。 */
    recovered?: boolean;
  } | null;
  log: string[];
  error: string | null;
  configIssue: MemoryConfigIssue | null;
  configModes: Record<string, "managed" | "manual">;
  installedVersion: string | null;
  /** 版本切换的 durable 三阶段；只有 candidate-installed 可参与 readiness 晋升。 */
  versionChange?: {
    targetVersion: string;
    phase: "intent" | "installing" | "candidate-installed";
  } | null;
  lockedVersion: string | null;
  latestVersion: string | null;
  latestCheckedAt: number | null;
  latestCheckError: string | null;
  latestCheckWarning?: string | null;
  updateAvailable: boolean;
  versionCatalogSupported?: boolean;
  /** 安装目标由谁决定：locked = 产品锁定版，selected = 用户在目录里自选。
      它与 configModes 的 manual 是两个概念——后者说的是 ov.conf 由谁写。
      把「自选版本」当成「手工接管配置」，会让自选者常驻一条失配警示。 */
  versionSource: "locked" | "selected" | null;
  versionHistory: string[];
  yankedVersions?: string[];
  /** installedVersion 与 lockedVersion 是否一致；未安装为 null（D15）。 */
  versionMatch: boolean | null;
  instanceId: string | null;
  ownershipMarkerPresent?: boolean;
  dataEpoch: string | null;
  providerDataInstanceId: string | null;
  installRoot: string | null;
  dataRoot: string | null;
};

export type MemoryRuntimeVersionsResult = {
  providerId: string;
  /** 目录响应创建时的 runtime revision；renderer 据此丢弃跨操作迟到响应。 */
  revision: number;
  versions: string[];
  yankedVersions: string[];
};

export function acceptMemoryRuntimeSnapshot(
  current: MemoryRuntimeSnapshot | undefined,
  incoming: MemoryRuntimeSnapshot
) {
  return !current || incoming.revision >= current.revision;
}

export type MemoryConfigField = {
  key: string;
  label: string;
  description: string;
  secret: boolean;
  /** 已有值时留空 = 保留；仅 secret 字段适用。 */
  retainedWhenBlank: boolean;
  required: boolean;
  defaultValue?: string;
  transport: "env" | "file";
  /** 字段级语义校验（main 侧在写入前强制）：
      model-base-url = 外部仅 HTTPS、HTTP 仅 loopback、禁内嵌凭证。
      没有它，一次 config-write 就能把保留的密钥与后续对话内容
      转发到攻击者地址——Base URL 决定「密钥发去哪」，不是普通文本。 */
  format?: "model-base-url";
};

export type ResolvedConfigValues = Record<string, string>;

export type MemoryConfigIssue = {
  providerId: string;
  instanceId: string;
  file: string;
  expectedHash: string;
  actualHash: string;
};

export type MemoryConfigIssueAction = "regenerate" | "adopt-manual";

export type MemoryRuntimeConfigMutation =
  | Readonly<{ kind: "write"; values: Record<string, string> }>
  | Readonly<{
      kind: "resolve-issue";
      issue: MemoryConfigIssue;
      action: MemoryConfigIssueAction;
    }>;

export type MemoryConfigPanel = {
  panelId: string;
  providerId: string;
  title: string;
  description: string;
  fields: MemoryConfigField[];
};

export const MEMORY_CHANNEL = {
  providers: "memory:providers",
  getStatus: "memory:get-status",
  refreshHealth: "memory:refresh-health",
  supplyStreams: "memory:supply-streams",
  revealDataRoot: "memory:reveal-data-root",
  resolveAttention: "memory:resolve-attention",
  previewConsent: "memory:preview-consent",
  requestConsentAuthority: "memory:request-consent-authority",
  status: "memory:status",
  runtimeGet: "memory:runtime-get",
  runtimeRun: "memory:runtime-run",
  runtimeConfig: "memory:runtime-config",
  runtimeConfigPreview: "memory:runtime-config-preview",
  runtimeConfigAuthority: "memory:runtime-config-authority",
  runtimeRefresh: "memory:runtime-refresh",
  runtimeCheckUpdates: "memory:runtime-check-updates",
  runtimeVersions: "memory:runtime-versions",
  resolveConfigIssue: "memory:resolve-config-issue",
  runtimeState: "memory:runtime-state",
  requestDestructiveAuthority: "memory:request-destructive-authority",
  consumeDestructiveAuthority: "memory:consume-destructive-authority",
  configPanels: "memory:config-panels",
} as const;

export type MemoryBridgeApi = {
  providers(): Promise<MemoryProviderDescriptor[]>;
  configPanels(): Promise<MemoryConfigPanel[]>;
  getStatus(): Promise<MemoryStatusSnapshot>;
  refreshHealth(): Promise<MemoryStatusSnapshot>;
  supplyStreams(): Promise<MemorySupplyResult>;
  revealDataRoot(providerId: string): Promise<void>;
  resolveAttention(input: {
    id: string;
    action: MemoryAttentionAction;
  }): Promise<MemoryStatusSnapshot>;
  previewConsent(input: {
    providerId: string;
    includeHistory: boolean;
    reason: MemoryConsentReason;
    sharingMode: import("./settings-ipc").MemorySharingMode;
  }): Promise<MemoryConsentPreview>;
  requestConsentAuthority(input: {
    providerId: string;
    includeHistory: boolean;
    reason: MemoryConsentReason;
    sharingMode: import("./settings-ipc").MemorySharingMode;
    previewDigest: string;
  }): Promise<MemoryConsentAuthority>;
  onStatus(listener: (snapshot: MemoryStatusSnapshot) => void): () => void;
  getRuntimeState(providerId: string): Promise<MemoryRuntimeSnapshot>;
  runRuntimeOperation(input: {
    providerId: string;
    operation: MemoryRuntimeRendererCommand;
    version?: string;
  }): Promise<MemoryRuntimeSnapshot>;
  writeRuntimeConfig(input: {
    providerId: string;
    values: Record<string, string>;
    authorityToken?: string;
  }): Promise<MemoryRuntimeSnapshot>;
  previewRuntimeConfig(input: {
    providerId: string;
    mutation: MemoryRuntimeConfigMutation;
  }): Promise<MemoryRuntimeConfigPreview>;
  requestRuntimeConfigAuthority(input: {
    providerId: string;
    mutation: MemoryRuntimeConfigMutation;
    previewDigest: string;
  }): Promise<MemoryRuntimeConfigAuthority>;
  refreshRuntimeState(providerId: string): Promise<MemoryRuntimeSnapshot>;
  checkRuntimeUpdates(input: {
    providerId: string;
    force: boolean;
  }): Promise<MemoryRuntimeSnapshot>;
  listRuntimeVersions(providerId: string): Promise<MemoryRuntimeVersionsResult>;
  resolveRuntimeConfigIssue(input: {
    issue: MemoryConfigIssue;
    action: MemoryConfigIssueAction;
    authorityToken?: string;
  }): Promise<MemoryRuntimeSnapshot>;
  onRuntimeState(
    listener: (snapshot: MemoryRuntimeSnapshot) => void
  ): () => void;
  requestDestructiveAuthority(input: {
    providerId: string;
    operation: MemoryDestructiveOperation;
  }): Promise<MemoryDestructiveAuthority>;
  consumeDestructiveAuthority(token: string): Promise<void>;
};
