/**
 * [INPUT]: type-only AgentBackendId that relies on agent-ipc
 * [OUTPUT]: Provides three types of sealed manifests, Base GUI v2 mutation/attachment-read capability, ordinary App domain/generation/tri-mode grant/reference/custody, AppRecord, including default global authorization revision, App-scoped Extension, seven-mode projection, capability current testing, GUI info/failure detectable, durable edit/use chat slots, single-mode alternate identity Agent visibility, running mode preload API agreement
 * [POS]: Apps for shared modules are the single source of truth; Navigation, authorization, generation, operation and Agent custody are not mutually exclusive in type
 */

import type { AgentBackendId } from "./agent-ipc";
import type { AppChatRole } from "./chats-ipc";
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

/** ordinary Base GUI 的 read 面恒可用；每项 mutation/attachment 能力独立 opt-in。 */
export type BaseGuiCapability =
  | "row-insert"
  | "row-patch"
  | "row-delete"
  | "attachment-read";

export type BaseGuiManifest = Readonly<{
  capabilities: readonly BaseGuiCapability[];
}>;

export type BaseGuiCapabilityDecision = Readonly<{
  decisionId: string;
  revision: number;
  appId: string;
  generationId: string;
  contentDigest: Sha256Digest;
  expectedActiveGenerationId: string | null;
  requestedCapabilities: readonly BaseGuiCapability[];
  grantedCapabilities: readonly BaseGuiCapability[];
  state: "consent-required" | "approved" | "declined";
}>;

export type BaseGuiLiveBinding = Readonly<{
  appId: string;
  generationId: string;
  contentDigest: Sha256Digest;
  lifecycleRevision: number;
  baseCapabilities: readonly BaseGuiCapability[];
  capabilityDecisionId: string | null;
  capabilityRevision: number;
}>;

export type BaseAppManifest = AppManifestBase & {
  kind: "base";
  packageSchemaVersion: 2;
  gui?: BaseGuiManifest;
} & AppExtensionRequirementManifestField;

export type AppManifest =
  | StaticAppManifest
  | ServerAppManifest
  | BaseAppManifest;

export function requestedBaseGuiCapabilities(
  manifest: AppManifest | null | undefined
): readonly BaseGuiCapability[] {
  return manifest?.kind === "base"
    ? [...new Set(manifest.gui?.capabilities ?? [])]
    : [];
}

export const BASE_GUI_ACTION_CHANNEL = "ai-chat:base-gui-host-action";
export type BaseGuiHostAction =
  | { type: "open-data" }
  | { type: "open-data-view"; viewId: string };
export type BaseGuiHostMessage = {
  channel: typeof BASE_GUI_ACTION_CHANNEL;
  token: string;
  action: BaseGuiHostAction;
};

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
  componentIdentity: string;
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
    /** 该 backend 本轮没有 instructions/tool 通道（如 OpenCode 的 builtinTools=none） */
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
    componentIdentity: string;
    required: boolean;
    code: string;
  }>[];
  /** 只有本轮已物化并签发的 component 才在此。 */
  activeComponents: readonly Readonly<{
    appId: string;
    componentIdentity: string;
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
  componentIdentity: string;
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

export type AppSurfaceAcquireInput = AvailableAppsInput & { appId: string };
export type AppAttachmentSurface = Readonly<{
  surfaceLeaseId: string;
  conversationId: string;
  conversationIncarnationId: string;
  appId: string;
  generationId: string;
  contentDigest: Sha256Digest;
  lifecycleRevision: number;
  domainIdentity: AppDomainIdentity;
  dataGrant: AppCapabilityGrant["data"] | null;
  ownerKey: string | null;
}>;

/**
 * renderer 只拿一个 opaque id：管理会话的闭合 scope（generation/digest/lifecycle
 * 与 webContents/session 绑定）是 main-only，绝不做成可回传的 DTO。
 */
export type AppManagementLeaseRef = Readonly<{ managementLeaseId: string }>;

export const APPS_CHANNEL = {
  add: "apps:add",
  remove: "apps:remove",
  list: "apps:list",
  open: "apps:open",
  status: "apps:status",
  originWithoutStart: "apps:origin-without-start",
  stop: "apps:stop",
  grant: "apps:grant",
  revokeGrant: "apps:grant:revoke",
  setGrantState: "apps:grant:state",
  setDefaultGrant: "apps:grant:default",
  listGrantSources: "apps:grant:sources",
  listAvailable: "apps:available",
  acquireSurface: "apps:surface:acquire",
  releaseSurface: "apps:surface:release",
  acquireManagementLease: "apps:management-lease:acquire",
  releaseManagementLease: "apps:management-lease:release",
  event: "apps:event",
  reveal: "apps:reveal",
  cancelInstall: "apps:cancel-install",
  readLog: "apps:read-log",
  retry: "apps:retry",
  repair: "apps:repair",
  setAgent: "apps:set-agent",
  saveAsApp: "apps:save-as-app",
  rename: "apps:rename",
  ensureChatSlot: "apps:ensure-chat-slot",
  retrySkill: "apps:retry-skill",
  resolveExtensionConsent: "apps:extension-consent",
  resolveBaseGuiConsent: "apps:base-gui-consent",
  revokeBaseGuiAccess: "apps:base-gui-access:revoke",
  promoteGeneration: "apps:promote-generation",
  extensionStatus: "apps:extension-status",
  revokeExtensionGrant: "apps:extension-grant:revoke",
  rebuildExtensionGeneration: "apps:extension-generation:rebuild",
  capabilities: "apps:capabilities",
  guiInfo: "apps:gui-info",
  readReadme: "apps:read-readme",
  probeRepo: "apps:probe-repo",
  discardProbe: "apps:discard-probe",
  listPresets: "apps:list-presets",
  probePreset: "apps:probe-preset",
  discardPresetProbe: "apps:discard-preset-probe",
  installPreset: "apps:install-preset",
  ghStatus: "apps:gh-status",
  readConfig: "apps:read-config",
  writeConfig: "apps:write-config",
  sharePreview: "apps:share-preview",
  sharePublish: "apps:share-publish",
  shareDiscard: "apps:share-discard",
} as const;

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
export type AppGuiInfo = {
  /** gui/ 内可伺服的 html 相对路径；宿主入口固定 index.html */
  pages: string[];
  /** 该 App 的固定 gateway origin；pages 为空时仍返回，供空态文案自证 */
  origin: string;
  /** 单实例 short-lived token：每次签发即撤销上一枚，App 停止/GUI 撤销时清除 */
  token: string;
  /** 只来自 active generation 与 durable decision 的求交，App 不从 manifest 猜权限。 */
  baseCapabilities: readonly BaseGuiCapability[];
  /** GUI 准备失败仍保留 pages，让显式“应用”路由能原地给出可行动错误。 */
  error?: string;
};

export type RemoveAppMode = "cascade" | "retain-data";
export type RemoveAppInput = {
  appId: string;
  mode: RemoveAppMode;
  requestId: string;
};

export type AppsBridgeApi = {
  add: (input: AddAppInput) => Promise<AppRecord>;
  remove: (
    appId: string,
    mode?: RemoveAppMode,
    requestId?: string
  ) => Promise<void>;
  list: () => Promise<AppsListSnapshot>;
  open: (appId: string) => Promise<AppOpenResult>;
  status: (appId: string) => Promise<AppRuntimeStatus>;
  originWithoutStart: (appId: string) => Promise<AppOpenResult | null>;
  stop: (appId: string) => Promise<void>;
  grant: (input: SetAppGrantInput) => Promise<AppGrantSnapshot>;
  revokeGrant: (target: AppGrantTarget, appId: string) => Promise<AppGrantSnapshot>;
  setGrantState: (input: SetAppGrantStateInput) => Promise<AppGrantSnapshot>;
  setDefaultGrant: (input: SetDefaultAppGrantInput) => Promise<AppRecord>;
  listGrantSources: () => Promise<AppGrantSourcesSnapshot>;
  listAvailable: (input: AvailableAppsInput) => Promise<AvailableAttachedApp[]>;
  acquireSurface: (input: AppSurfaceAcquireInput) => Promise<AppAttachmentSurface>;
  releaseSurface: (surfaceLeaseId: string) => Promise<void>;
  /** App 详情页的 main-owned 管理会话 */
  acquireManagementLease: (appId: string) => Promise<AppManagementLeaseRef>;
  releaseManagementLease: (managementLeaseId: string) => Promise<void>;
  reveal: (appId: string) => Promise<void>;
  cancelInstall: (appId: string) => Promise<void>;
  readLog: (appId: string) => Promise<string>;
  retry: (appId: string) => Promise<void>;
  repair: (appId: string) => Promise<void>;
  setAgent: (input: SetAppAgentInput) => Promise<AppRecord>;
  saveAsApp: (input: SaveAsAppInput) => Promise<SaveAsAppResult>;
  rename: (input: RenameAppInput) => Promise<AppRecord>;
  ensureChatSlot: (
    input: EnsureAppChatSlotInput
  ) => Promise<EnsureAppChatSlotResult>;
  retrySkill: (appId: string) => Promise<AppRecord>;
  /* 同意/拒绝都是终态：拒绝让该代零 grant 地 promote，扩展逐条以
     scoped-grant-missing 被排除，而不是把 App 永远卡在 pending。 */
  resolveExtensionConsent: (input: {
    appId: string;
    granted: boolean;
  }) => Promise<AppRecord>;
  resolveBaseGuiConsent: (input: {
    appId: string;
    grantedCapabilities: BaseGuiCapability[];
  }) => Promise<AppRecord>;
  revokeBaseGuiAccess: (appId: string) => Promise<AppRecord>;
  promoteGeneration: (input: {
    appId: string;
    expectedConsentRevision: number;
  }) => Promise<AppRecord>;
  /** 按 active App generation 与其 frozen package refs 返回 scoped 状态。 */
  extensionStatus: (appId: string) => Promise<AppExtensionStatus>;
  revokeExtensionGrant: (appId: string) => Promise<AppExtensionStatus>;
  rebuildExtensionGeneration: (appId: string) => Promise<AppRecord>;
  capabilities: (appId: string) => Promise<AppCapabilitiesSnapshot>;
  guiInfo: (appId: string) => Promise<AppGuiInfo>;
  readReadme: (appId: string) => Promise<string | null>;
  probeRepo: (repoUrl: string) => Promise<AppRepoProbeResult>;
  discardProbe: (preflightId: string) => Promise<void>;
  listPresets: () => Promise<PresetAppSummary[]>;
  probePreset: (presetId: string) => Promise<PresetProbeResult>;
  discardPresetProbe: (preflightId: string) => Promise<void>;
  installPreset: (input: InstallPresetInput) => Promise<AppRecord>;
  ghStatus: () => Promise<GhStatus>;
  readConfig: (appId: string) => Promise<AppConfigValue>;
  writeConfig: (appId: string, config: AppConfigValue) => Promise<AppConfigValue>;
  sharePreview: (input: SharePreviewInput) => Promise<SharePreview>;
  sharePublish: (input: SharePublishInput) => Promise<AppRecord>;
  shareDiscard: (previewId: string) => Promise<void>;
  onEvent: (callback: (event: AppInstallEvent) => void) => () => void;
};
