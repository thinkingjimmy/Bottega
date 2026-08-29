/**
 * [INPUT]: type-only AgentBackendId that relies on agent-ipc
 * [OUTPUT]: Provides sealed App manifests, surface-scoped Base GUI capabilities/host actions, App generation/grant/reference records, the positive servesWebRuntime runtime-eligibility predicate, Bottega Design Canvas events, and the renderer bridge contract
 * [POS]: Apps for shared modules are the single source of truth; Navigation, authorization, generation, operation and Agent custody are not mutually exclusive in type
 */

import type { AgentBackendId } from "./agent-ipc";
export * from "./apps-bridge-ipc";
import type {
  AppOpenMode,
  BaseGuiCapability,
  BaseGuiCapabilityScopes,
  BaseGuiHostActionCapability,
  BaseGuiManifest,
} from "./apps-surface-ipc";
export * from "./apps-surface-ipc";
import type { AppChatRole } from "./chats-ipc";
import type { ProductResourceScope } from "./product-resource-scope";
import type {
  AppExtensionRequirementManifestField,
  ExtensionBackendEligibilityView,
  ExtensionBackendHealthView,
  ExtensionDisclosureView,
  ExtensionPackageGenerationRef,
  FrozenAppExtensionRequirementSetV1,
  Sha256Digest,
} from "./extensions-ipc";

export type AppRequirement = {
  id: string;
  kind: "cli" | "mcp" | "config";
  label: string;
  note: string;
  required: boolean;
  sensitive?: boolean;
  configKey?: string;
};

export type AppRequirements = {
  tools: AppRequirement[];
};

type AppManifestBase = {
  name: string;
  description: string;
  icon: string;
  requirements: AppRequirements | null;
  /** Package default only; a durable per-install override remains user-owned. */
  defaultOpenMode?: AppOpenMode;
};

export type StaticAppManifest = AppManifestBase & {
  kind: "static";
  installCmd: string;
  buildCmd: string | null;
  staticDir: string;
  healthPath: string;
  agentRequirements: {
    mcpServers: string[];
    skills: string[];
  } | null;
} & AppExtensionRequirementManifestField & { domain?: never };

export type ServerAppManifest = AppManifestBase & {
  kind: "server";
  installCmd: string;
  buildCmd: string | null;
  startCmd: string;
  healthPath: string;
  serveAgentPrompt: string | null;
  serveTrigger: {
    watchPath: string;
  } | null;
  agentRequirements: {
    mcpServers: string[];
    skills: string[];
  } | null;
} & AppExtensionRequirementManifestField & { domain?: never };

export type BaseAppManifest = AppManifestBase & {
  kind: "base";
  packageSchemaVersion: 2;
  gui?: BaseGuiManifest;
} & AppExtensionRequirementManifestField;

export type AppManifest =
  | StaticAppManifest
  | ServerAppManifest
  | BaseAppManifest;


export type AppDomainIdentity =
  | { kind: "no-data"; appKind: "static" | "server" }
  | {
      kind: "base";
      domain: { kind: "ordinary" };
    };

export type AppCapabilityGrant = {
  appId: string;
  data?:
    | { kind: "base"; level: "read" | "row-write" };
  agentDelegation: { fileRead: boolean; useData: boolean };
  grantedAt: number;
};

/** chat/project 同一授权位的负向变体；删除记录才是 absent。 */
export type AppDisabledGrant = {
  appId: string;
  state: "disabled";
  disabledAt: number;
};

export type AppGrantRecord = AppCapabilityGrant | AppDisabledGrant;

export function isPositiveAppGrant(
  record: AppGrantRecord
): record is AppCapabilityGrant {
  return !("state" in record) || record.state !== "disabled";
}

export type AppExtensionResolutionBinding =
  | { kind: "none" }
  | {
      kind: "frozen";
      frozenSet: FrozenAppExtensionRequirementSetV1;
      packageGenerationReservationId: string;
    };

export type AppGenerationRuntimeBinding =
  | { kind: "none" }
  | { kind: "server"; dataEpochId: string };

export type AppGeneration = Readonly<{
  generationId: string;
  generationBuildId: string;
  /** v1 读取期仅为迁移兼容；所有新 generation 必须同时持有三个 v2 digest。 */
  manifestDigest?: Sha256Digest;
  sourcePackageDigest?: Sha256Digest;
  contentDigest: Sha256Digest;
  manifest: AppManifest;
  extensionRequirementResolution: AppExtensionResolutionBinding;
  contentLayoutVersion: 1 | 2;
  createdAt: number;
}>;

export type AppGenerationBinding = {
  bindingRevision: number;
  active: {
    generationId: string;
    runtime: AppGenerationRuntimeBinding;
  } | null;
  pending?: {
    generationId: string;
    expectedActiveGenerationId: string | null;
    resolutionDigest: Sha256Digest;
    packageGenerationReservationId: string;
    runtime: AppGenerationRuntimeBinding;
    consentDecisionId: string;
    expectedConsentRevision: number;
    baseGuiDecision?: Readonly<{
      decisionId: string;
      expectedRevision: number;
      requestedCapabilities: readonly BaseGuiCapability[];
      requestedHostActions: readonly BaseGuiHostActionCapability[];
      requestedCapabilityScopes: BaseGuiCapabilityScopes;
      state: "consent-required" | "approved" | "declined";
    }>;
    extensionState?: "consent-required" | "ready-to-promote";
    state: "consent-required" | "ready-to-promote";
  };
  drainingGenerationIds: string[];
};

/**
 * main 按 App active generation 的 frozen package ref 生成的真实投影。
 * installed / grant / enabled 互不隐含，renderer 不再拿全局快照猜。
 */
export type AppExtensionRequirementStatus = Readonly<{
  declaredComponentIdentity: string;
  componentInstanceIdentity?: string;
  required: boolean;
  requestedConfig?: Readonly<Record<string, unknown>>;
  resolution:
    | Readonly<{
        state: "resolved";
        packageGenerationRef: ExtensionPackageGenerationRef;
        resolvedConfigDigest: Sha256Digest;
      }>
    | Readonly<{ state: "unresolved" }>;
  installed: boolean;
  admission: "valid" | "misconfigured" | "unknown";
  generationState:
    | "active"
    | "retained"
    | "removal-pending"
    | "missing"
    | "unresolved";
  enabled:
    | "yes"
    | "no"
    | "disable-pending"
    | "retained"
    | "removal-pending"
    | "unknown";
  grant:
    | Readonly<{ state: "granted"; revision: number }>
    | Readonly<{ state: "missing" }>
    | Readonly<{ state: "revoked"; revokedAt: number }>
    | Readonly<{ state: "not-applicable" }>;
  eligibility: readonly ExtensionBackendEligibilityView[];
  deliveryHealth: readonly ExtensionBackendHealthView[];
}>;

export type AppExtensionStatus = Readonly<{
  appId: string;
  appGenerationId: string | null;
  frozenState: "frozen" | "none" | "generation-missing";
  requirements: readonly AppExtensionRequirementStatus[];
}>;

export type AppCapabilitiesSnapshot = Readonly<{
  appId: string;
  capturedAt: number;
  tools: readonly Readonly<{
    requirement: AppRequirement;
    status: "satisfied" | "missing" | "needs-config" | "unknown";
    guidance: string | null;
  }>[];
  agentTools: Readonly<{
    mcpServers: readonly Readonly<{
      name: string;
      health: "healthy" | "missing" | "unknown";
    }>[];
    skills: readonly Readonly<{
      name: string;
      health: "healthy" | "missing" | "unknown";
    }>[];
  }>;
  dataCapability: Readonly<{
    kind: "none" | "base";
    grantLevels: readonly ("read" | "row-write")[];
  }>;
  baseGuiCapability: Readonly<{
    requested: readonly BaseGuiCapability[];
    effective: readonly BaseGuiCapability[];
  }>;
  settings: Readonly<{
    toolsPath: "/settings/tools";
    extensionsPath: "/settings/extensions";
  }>;
}>;

export type AppChatSlot = {
  id: string;
  state: "draft" | "canonical";
};

export type AppFailurePhase =
  | "clone"
  | "manifest"
  | "install"
  | "build"
  | "start"
  | "update"
  | "delete";

export type AppRecord = {
  id: string;
  sourceRepoUrl: string | null;
  publishedRepoUrl: string | null;
  /** github=远端导入、local=Save as App、preset=main-owned 首方远端包；只有 github 携带来源仓库。 */
  origin: "github" | "local" | "preset";
  /** preset 安装的发布身份与实际取源 commit；非 preset 缺省。 */
  presetId?: string;
  installedPresetPin?: string;
  displayName: string;
  dir: string;
  state:
    | "creating"
    | "installing"
    | "ready"
    | "install-failed"
    | "updating"
    | "update-failed"
    | "deleting"
    | "delete-failed"
    | "quarantined";
  lastError: {
    phase: AppFailurePhase;
    message: string;
  } | null;
  agentWarning: string | null;
  agent: AgentBackendId;
  maintenanceAgent: AgentBackendId | "auto";
  headlessConsent: {
    backend: AgentBackendId;
    version?: string;
    consentAt?: number;
    inherited?: boolean;
  } | null;
  bindingRevision: number;
  lifecycleRevision: number;
  /** 缺席/null 都表示默认关闭；字段 optional 仅为同版老档与测试 fixture 平滑读取。 */
  defaultGrant?: AppCapabilityGrant | null;
  defaultGrantRevision?: number;
  /** null/absent follows the active manifest default; otherwise this is the durable user choice. */
  openModeOverride?: AppOpenMode | null;
  domainIdentity: AppDomainIdentity | null;
  generations: AppGeneration[];
  generationBinding: AppGenerationBinding;
  manifest: AppManifest | null;
  editChatSlot: AppChatSlot | null;
  activeUseChatSlot: AppChatSlot | null;
  skillStatus: {
    state: "pending" | "done" | "failed";
    turnIntentId: string;
  } | null;
  addedAt: number;
};


export type AppRuntimeState = "running" | "stopped" | "crashed";
export type AppOperation = "install" | "repair" | "update";

/* ============================================================================
 * Web runtime 资格：正面判据，不是「不是 base」
 * ---------------------------------------------------------------------------
 * manifest 是 active generation 的投影：没有 active 代时它必须为 null（见
 * AppStore 的 record 不变量）。于是 `manifest?.kind !== "base"` 这种反向写法
 * 在 manifest 缺席时会失守——「还不知道是什么」被读成「不是 Base」，随后
 * 有人替 Base App 去启 web runtime。判据只能正着写：只有确知是 static/server
 * 才起 runtime，未知一律不起。
 * ========================================================================= */
export function servesWebRuntime(
  manifest: AppManifest | null | undefined
): manifest is StaticAppManifest | ServerAppManifest {
  return manifest?.kind === "static" || manifest?.kind === "server";
}

export function repairSite(
  record: AppRecord
): "staging" | "copy" | null {
  if (record.state === "install-failed") {
    return record.lastError &&
      (record.lastError.phase === "install" ||
        record.lastError.phase === "build")
      ? "staging"
      : null;
  }
  return record.state === "update-failed" ? "copy" : null;
}

/* 两种粒度必须分开：App 整个没进本轮上下文，与 App 进了但某个扩展 component 没
   交付，用户要做的处置完全不同（D20 只要求前者，后者来自 Integration §6）。 */
export type AppAgentOmission = Readonly<{
  appId: string;
  reason:
    /** 附加的 App 数超过逐轮引用上限 */
    | "reference-limit"
    /** instructions 放不下 2KB 预算 */
    | "instruction-budget"
    /** This backend/turn has no product tool channel. */
    | "backend-unsupported"
    /** ordinary Base 的读写工具均被关闭，故 App 整体不进入 Agent instructions。 */
    | "base-tools-disabled";
}>;

export type AppAgentDegradation = Readonly<{
  appId: string;
  reason: "base-reads-disabled" | "base-row-mutations-disabled";
}>;

export type AppAgentVisibility = Readonly<{
  conversationId: string;
  /** 单调身份：renderer 据 revision 拒绝晚到的旧 attempt。 */
  attemptGeneration: string;
  planInstanceId: string | null;
  runtimeSnapshotId: string;
  revision: number;
  /** 本轮完全未注入、Agent 因此不知道其存在的 App */
  omittedApps: readonly AppAgentOmission[];
  /** App 已注入但能力面被用户开关收窄；与完全不可见的 omission 分账。 */
  degradedApps: readonly AppAgentDegradation[];
  /** App 已注入，但这些扩展 component 本轮未交付 */
  excludedComponents: readonly Readonly<{
    appId: string;
    declaredComponentIdentity: string;
    required: boolean;
    code: string;
  }>[];
  /** 只有本轮已物化并签发的 component 才在此。 */
  activeComponents: readonly Readonly<{
    appId: string;
    componentInstanceIdentity: string;
  }>[];
}>;

export type AppInstallEvent =
  | {
      appId: string;
      type: "progress";
      step: string;
      operation: AppOperation;
    }
  | { appId: string; type: "status"; record: AppRecord }
  | { appId: string; type: "log"; line: string }
  | { appId: string; type: "runtime"; state: AppRuntimeState }
  | { appId: string; type: "gui" }
  | {
      type: "design-canvases-changed";
      appId: string;
      chatId: string;
      conversationIncarnationId: string;
      turnId: string;
      files: readonly string[];
      drafting: boolean;
    }
  | { appId: string; type: "removed" }
  | { type: "agent-visibility"; visibility: AppAgentVisibility }
  | { type: "runtime-warning"; message: string };

/* ------------------------------------------------------------------------- *
 *  两条 warning 各有归属：页面横幅与预设区。挤进一个标量就只能靠 `??` 短路
 *  ——网关降级时坏预设包的告警被永久吞掉，视图层也只剩「有告警就别显示空
 *  状态」这种猜法，猜的结果是一个什么都不渲染的空网格。分槽后各归各位。
 *
 *  没有「列表读不出来」这一槽：主档损坏时 AppStore.load() 直接 fail-closed
 *  抛出，产品根本起不来，main 不存在「列表可疑但我还活着」这种状态。
 *  renderer 侧那条 listWarning 只对应它自己的 IPC 失败，不上 wire。
 * ------------------------------------------------------------------------- */
export type AppsListSnapshot = {
  apps: AppRecord[];
  /** 网关降级：列表可信，但 App 跑不起来 */
  runtimeWarning: string | null;
};

export type GhStatus =
  | { state: "missing"; message: string }
  | { state: "unauthenticated"; message: string }
  | { state: "ready"; message: string };

export type AppRepoProbeResult =
  | { kind: "web"; repoUrl: string }
  | {
      kind: "base";
      repoUrl: string;
      preflightId: string;
      digest: string;
      commitSha: string;
      manifest: BaseAppManifest;
      requirements: AppRequirement[];
      cliStatuses: Array<{
        id: string;
        detectable: boolean;
        installed: boolean;
      }>;
      disclosures: Array<{ path: string; content: string }>;
      files: Array<{ path: string; bytes: number }>;
      ignored: string[];
      rowCount: number;
      hasGui: boolean;
      extensionPreflights: readonly AppExtensionInstallPreflight[];
    };

export type AppExtensionInstallPreflight = Readonly<{
  declaredComponentIdentity: string;
  scope: ProductResourceScope;
  projectLifecycleRevision: number | null;
  scopeRevision: number;
  repoUrl: string;
  requestedRef: string;
  resolvedCommit: string;
  contentDigest: Sha256Digest;
  capabilityDigest: Sha256Digest;
  capabilities: ExtensionDisclosureView;
  preflightId: string | null;
  state: "ready" | "installed";
}>;

/**
 * 预设 App 的卡片数据：main-owned catalog 编译进产品。
 * 双语 README 摘要直接同行返回——预设由产品自己写、体量受控，
 * 为一段静态文本再开一条 IPC 是把简单问题做复杂。
 */
export type PresetAppSummary = {
  id: string;
  name: string;
  description: string;
  icon: string;
  requirements: AppRequirement[];
  readme: string;
  readmeZhCN: string;
};

export type PresetInstallRequest = {
  presetId: string;
  requestId: string;
  config?: AppConfigValue;
};

export type PresetProbeResult = Extract<
  AppRepoProbeResult,
  { kind: "base" }
> & {
  presetId: string;
  resolvedPin: string;
  channel: "release" | "dev";
};

export type InstallPresetInput = PresetInstallRequest & {
  preflightId: string;
  digest: string;
};

export type AppConfigValue = {
  values: Record<string, string>;
  agentReadableKeys: string[];
};

export type ShareDataMode = "full" | "sample" | "schema";
export type SharePreviewInput = {
  appId: string;
  dataMode: ShareDataMode;
  repoName: string;
  visibility: "public" | "private";
};
export type SharePreview = {
  previewId: string;
  digest: string;
  files: Array<{ path: string; bytes: number }>;
  rowCount: number;
  sampleRows: Array<{ id: string; values: Record<string, unknown> }>;
  ignored: string[];
  readmePlaceholder: boolean;
  diffSummary: string;
};
export type SharePublishInput = {
  appId: string;
  previewId: string;
  confirmedDigest: string;
  requestId: string;
};

export type AppOpenResult = {
  origin: string;
  activationId?: string;
  generationId?: string;
};

export type AppRuntimeStatus = {
  appId: string;
  state: AppRecord["state"];
  lifecycleRevision: number;
  generationId: string | null;
  contentDigest: Sha256Digest | null;
  runtime: AppRuntimeState;
  activationId: string | null;
  origin: string | null;
  quarantined: boolean;
};

export type AppGrantTarget =
  | { kind: "chat"; chatId: string }
  | { kind: "project"; projectId: string };

export type SetAppGrantInput = {
  target: AppGrantTarget;
  appId: string;
  requestedDataLevel?: "none" | "read" | "row-write";
  requestedAgentDelegation: { fileRead: boolean; useData: boolean };
};

export type SetAppGrantStateInput = {
  target: AppGrantTarget;
  appId: string;
  state: "grant" | "disabled" | "clear";
  requestedDataLevel?: "none" | "read" | "row-write";
  requestedAgentDelegation?: { fileRead: boolean; useData: boolean };
};

export type SetDefaultAppGrantInput = {
  appId: string;
  grant: {
    requestedDataLevel?: "none" | "read" | "row-write";
    requestedAgentDelegation: { fileRead: boolean; useData: boolean };
  } | null;
};

export type AppGrantSnapshot = {
  target: AppGrantTarget;
  revision: number;
  grants: AppGrantRecord[];
};

/** 授权管理页只展示 canonical 账本中的原始来源，不展开 Project 继承。 */
export type AppGrantSource = {
  source: "chat" | "project" | "global";
  target: AppGrantTarget | null;
  targetName: string;
  revision: number;
  appId: string;
  appName: string;
  state: "grant" | "disabled";
  grant: AppCapabilityGrant | null;
  disabledAt: number | null;
  impact: "chat-only" | "project-members" | "all-scopes";
};

export type AppGrantSourcesSnapshot = {
  chats: AppGrantSource[];
  projects: AppGrantSource[];
  globals: AppGrantSource[];
};

export type AttachmentCapabilitySnapshot = Readonly<{
  conversationId: string;
  conversationIncarnationId: string;
  chatGrantRevision: number;
  projectId: string | null;
  projectGrantRevision: number | null;
  membershipRevision: number;
  defaultGrantRevision: number;
  appId: string;
  appLifecycleRevision: number;
  appGenerationId: string;
  appContentDigest: Sha256Digest;
}>;

export type EffectiveAppGrant = Readonly<{
  appId: string;
  grant: AppCapabilityGrant;
  provenance: {
    winner: "chat" | "project" | "global";
    contributors: readonly ("chat" | "project" | "global")[];
    suppressedBy: "chat" | "project" | null;
  };
  snapshot: AttachmentCapabilitySnapshot;
}>;

export type AvailableAttachedApp = {
  appId: string;
  name: string;
  state: AppRecord["state"];
  generationId: string | null;
  direct: boolean;
  inherited: boolean;
  global: boolean;
  disabledBy: "chat" | "project" | null;
  /** Chat-local deny 也保留在可管理列表中，此时 clear 是唯一合法恢复动作。 */
  effectiveGrant: AppCapabilityGrant | null;
};

export type AvailableAppsInput = {
  conversationId: string;
  conversationIncarnationId: string;
};


/**
 * renderer 只拿一个 opaque id：管理会话的闭合 scope（generation/digest/lifecycle
 * 与 webContents/session 绑定）是 main-only，绝不做成可回传的 DTO。
 */
export type AppManagementLeaseRef = Readonly<{ managementLeaseId: string }>;

export type AddAppInput = {
  repoUrl: string;
  maintenanceAgent: AgentBackendId | "auto";
  preflightId?: string;
  confirmedDigest?: string;
  config?: AppConfigValue;
};

export type SetAppAgentInput = {
  appId: string;
  role: "interactive" | "maintenance";
  agent: AgentBackendId | "auto";
};

export type SaveAsAppInput = {
  chatId: string;
  name: string;
  icon: string;
  requestId: string;
};

export type SaveAsAppResult =
  | { status: "done"; record: AppRecord }
  | {
      status: "rejected";
      error: { code: string; message: string };
    };

export type RenameAppInput = {
  appId: string;
  name: string;
};

export type EnsureAppChatSlotInput = {
  appId: string;
  role: AppChatRole;
  requestId: string;
  mode?: "reuse" | "new";
};

export type EnsureAppChatSlotResult = AppChatSlot;

/**
 * Base App 的 `gui/` 现状快照。pages 空即「没有 GUI」——不另设 hasGui 布尔，
 * 派生字段是第二真相源，会与 pages 各自漂移。
 */

export type RemoveAppMode = "cascade" | "retain-data";
export type RemoveAppInput = {
  appId: string;
  mode: RemoveAppMode;
  requestId: string;
};
