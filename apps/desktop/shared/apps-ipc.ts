/**
 * [INPUT]: type-only AgentBackendId from agent-ipc, placement facts, and Extension identity vocabulary
 * [OUTPUT]: Provides sealed App manifests, v15 Editor/Use residence/source facts, fenced contextual grant candidates carrying the App's own icon so one App wears one face on every surface, compact effective provenance, compatibility-bound Studio authorization/grants, durable pinnedAt records, operation types, generation/grant/reference records, the canonical defaultAppGrantRequest payload, runtime eligibility, Design events, and the bridge/surface/navigation/install buckets it re-exports
 * [POS]: Single shared Apps wire truth and the barrel over its sibling buckets; navigation, surface, acquisition (apps-install-ipc), authorization, generation and Agent custody remain explicitly separate contracts
 */

import type { AgentBackendId } from "./agent-ipc";
export * from "./apps-bridge-ipc";
export * from "./apps-install-ipc";
import type {
  AppGuiCompatibilityRef,
  BaseGuiCapability,
  BaseGuiCapabilityScopes,
  BaseGuiHostActionCapability,
  BaseGuiManifest,
} from "./apps-surface-ipc";
export * from "./apps-surface-ipc";
import type { AppChatSlot } from "./apps-navigation-ipc";
export * from "./apps-navigation-ipc";
import type {
  AppEditorProjection,
  AppSourceState,
  AppUseSwitchIntent,
} from "./placement/facts";
import type {
  AppExtensionRequirementManifestField,
  ExtensionBackendEligibilityView,
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

export type AppRequirements = { tools: AppRequirement[] };

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

export type BaseAppManifest = AppManifestBase & {
  kind: "base";
  packageSchemaVersion: 2;
  gui?: BaseGuiManifest;
} & AppExtensionRequirementManifestField;

export type AppManifest = StaticAppManifest | ServerAppManifest | BaseAppManifest;
export type AppDomainIdentity =
  | { kind: "no-data"; appKind: "static" | "server" }
  | {
      kind: "base";
      domain: { kind: "ordinary" };
    };

export type AppCapabilityGrant = {
  appId: string;
  data?: { kind: "base"; level: "read" | "row-write" };
  agentDelegation: { fileRead: boolean; useData: boolean };
  grantedAt: number;
};

/**
 * App Studio 自用数据面的独立授权。它绑定冻结 generation 字节与 Base GUI
 * decision，不参与普通 Chat/Project 的 effectiveGrants。
 */
export type AppStudioGrant = {
  appId: string;
  generationId: string;
  contentDigest: Sha256Digest;
  data: { kind: "base"; level: "read" | "row-write" };
  agentDelegation: { fileRead: false; useData: false };
  baseGuiDecisionId: string | null;
  baseGuiDecisionRevision: number;
  compatibilityRefDigest?: Sha256Digest;
  grantedAt: number;
};

export type AppInstallAuthorization = Readonly<{
  scope: "studio-only";
  decision: "approve-requested";
}>;

/** chat/project 同一授权位的负向变体；删除记录才是 absent。 */
export type AppDisabledGrant = {
  appId: string;
  state: "disabled";
  disabledAt: number;
};

export type AppGrantRecord = AppCapabilityGrant | AppDisabledGrant;

export function isPositiveAppGrant(record: AppGrantRecord): record is AppCapabilityGrant {
  return !("state" in record) || record.state !== "disabled";
}

/* ============================================================
 * 默认档的载荷：可见性不该夹带权限。
 *
 * `defaultGrant` 一个字段同时承载两件事——「这个 App 在哪些地方可用」
 * 与「Agent 能替你做什么」。它有三个写入者：设置页授权档的切换、Design
 * 初装时的 enableGlobal，以及画布上那条「重新打开」的悬浮条。三边从前
 * 各拼各的 request，且拼得相反：第一个 fileRead:false，后两个 true。
 *
 * 后果不是显示不一致，是静默改权：Design 一装完，授权页的「让 Agent 代你
 * 操作」就已经是开的，而用户从没被问过；从悬浮条重新打开也是同一结果；
 * 反过来在授权页切一次档位，那个委托又被悄悄关掉。一个字段几个写入者，
 * 就必然有几个在说谎，而界面没有任何地方交代是哪一个。
 *
 * 委托因此焊死为空，且只在这里写一次：开放可用范围只回答「在哪儿能用」。
 * 委托与数据级别各有自己的控件，用户在授权页看得见、改得动——要给
 * Agent 读文件的权，那该是他在那个开关上按下的，不该搭「重新打开」的
 * 顺风车。
 *
 * 数据级别留给调用方显式传：它是各 App 真实需要的差异（Base App 读自己
 * 的 Base，Design 走 Base GUI 租约而不需要这一层），不是漂移。必须一致的
 * 那一半在这里，允许不同的那一半由调用方说出口——这两件事分开，漂移才
 * 没有藏身之处。
 * ============================================================ */
export function defaultAppGrantRequest(
  requestedDataLevel: "none" | "read" | "row-write"
) {
  return {
    requestedDataLevel,
    requestedAgentDelegation: { fileRead: false, useData: false },
  };
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
  manifestDigest: Sha256Digest;
  sourcePackageDigest: Sha256Digest;
  contentDigest: Sha256Digest;
  /** Required by content-layout-v3 and absent from legacy generations. */
  buildReceiptDigest?: Sha256Digest;
  compatibilityRefDigest?: Sha256Digest;
  compatibilityRef?: AppGuiCompatibilityRef;
  manifest: AppManifest;
  extensionRequirementResolution: AppExtensionResolutionBinding;
  contentLayoutVersion: 2 | 3;
  createdAt: number;
  retiredAt?: number;
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
      compatibilityRefDigest?: Sha256Digest;
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
  /** 缺席/null 均表示尚未显式批准；迁移绝不替用户补权。 */
  studioGrant?: AppStudioGrant | null;
  studioGrantRevision?: number;
  /** Sidebar projection order; null means the App is not pinned. */
  pinnedAt: number | null;
  domainIdentity: AppDomainIdentity | null;
  generations: AppGeneration[];
  generationBinding: AppGenerationBinding;
  manifest: AppManifest | null;
  editChatSlot: AppChatSlot | null;
  activeUseChatSlot: AppChatSlot | null;
  /** Required in canonical v15 records; optional only for a pre-v15 bridge/test input. */
  editor?: AppEditorProjection;
  activeUseSwitch?: AppUseSwitchIntent | null;
  sourceState?: AppSourceState;
  /** Required by the v15 persistence schema; optional only for legacy/test bridge inputs. */
  editableSource?: boolean;
  skillStatus: {
    state: "pending" | "done" | "failed";
    turnIntentId: string;
  } | null;
  addedAt: number;
};

export const defaultAppEditorProjection = (): AppEditorProjection => ({
  editorActivatedAt: null,
  editorHiddenAt: null,
  editorRevision: 0,
});

export const appEditorProjectionOf = (record: Pick<AppRecord, "editor">) =>
  record.editor ?? defaultAppEditorProjection();

export const appSourceStateOf = (record: Pick<AppRecord, "sourceState">) =>
  record.sourceState ?? {
    sourceRevision: 0,
    fingerprint: null,
    lastReconciledAt: null,
  };

export type SetAppPinnedInput = Readonly<{
  appId: string;
  pinned: boolean;
}>;


export type AppRuntimeState = "running" | "stopped" | "crashed";
export type AppOperation = "install" | "repair" | "update" | "delete";

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

export type AppOpenResult = {
  origin: string;
  activationId?: string;
  generationId?: string;
};

export type AppGrantTarget =
  | { kind: "chat"; chatId: string }
  | { kind: "project"; projectId: string };

/** Mutation targets carry the lifecycle fact the renderer actually observed. */
export type AppGrantCommandTarget =
  | { kind: "chat"; chatId: string; expectedConversationIncarnationId: string }
  | { kind: "project"; projectId: string; expectedProjectLifecycleRevision: number };

export type SetAppGrantInput = {
  target: AppGrantCommandTarget;
  appId: string;
  requestedDataLevel?: "none" | "read" | "row-write";
  requestedAgentDelegation: { fileRead: boolean; useData: boolean };
};

export type SetAppGrantStateInput = {
  target: AppGrantCommandTarget;
  appId: string;
  state: "grant" | "disabled" | "clear";
  requestedDataLevel?: "none" | "read" | "row-write";
  requestedAgentDelegation?: { fileRead: boolean; useData: boolean };
};

export type SetDefaultAppGrantInput = {
  appId: string;
  grant: { requestedDataLevel?: "none" | "read" | "row-write"; requestedAgentDelegation: { fileRead: boolean; useData: boolean } } | null;
};

export type AppGrantSnapshot = { target: AppGrantTarget; revision: number; grants: AppGrantRecord[] };

/** 授权管理页只展示 canonical 账本中的原始来源，不展开 Project 继承。 */
export type AppGrantSource = {
  source: "chat" | "project" | "global";
  target: AppGrantTarget | null;
  commandTarget: AppGrantCommandTarget | null;
  targetName: string;
  revision: number;
  appId: string;
  appName: string;
  state: "grant" | "disabled";
  grant: AppCapabilityGrant | null;
  disabledAt: number | null;
  impact: "chat-only" | "project-members" | "all-scopes";
};

export type AppGrantSourcesSnapshot = { chats: AppGrantSource[]; projects: AppGrantSource[]; globals: AppGrantSource[] };

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
  /** 仅 Studio surface 填充；普通 attachment 不消费这两个 revision。 */
  studioGrantRevision?: number;
  baseGuiDecisionRevision?: number;
}>;

export type EffectiveAppGrant = Readonly<{
  appId: string;
  grant: AppCapabilityGrant;
  provenance: {
    effectiveSource: "chat" | "project" | "global";
    suppressedBy: "chat" | "project" | null;
  };
  snapshot: AttachmentCapabilitySnapshot;
}>;

export type AvailableAttachedApp = {
  appId: string;
  name: string;
  state: AppRecord["state"];
  generationId: string | null;
  effectiveSource: "chat" | "project" | "global" | null;
  suppressedBy: "chat" | "project" | null;
  /** Chat-local deny 也保留在可管理列表中，此时 clear 是唯一合法恢复动作。 */
  effectiveGrant: AppCapabilityGrant | null;
};

export type AppGrantCandidate = Readonly<{
  appId: string;
  name: string;
  /* 与 Apps 页那张卡同源的身份：同一个 App 在候选列表、Project 设置与
     Apps 页必须长同一张脸，否则用户得靠名字在三处自行认亲。 */
  icon: string | null;
  state: AppRecord["state"];
  generationId: string | null;
  domainIdentity: AppDomainIdentity | null;
  scopeRecord: AppGrantRecord | null;
  inheritedGrant: AppCapabilityGrant | null;
  inheritedSource: "project" | "global" | null;
  effectiveGrant: AppCapabilityGrant | null;
  effectiveSource: "chat" | "project" | "global" | null;
  suppressedBy: "chat" | "project" | null;
}>;

export type AppGrantCandidatesInput = Readonly<{
  target: AppGrantCommandTarget;
}>;

export type AvailableAppsInput = { conversationId: string; conversationIncarnationId: string };
export type SetAppAgentInput = {
  appId: string;
  role: "interactive" | "maintenance";
  agent: AgentBackendId | "auto";
};

export type RenameAppInput = {
  appId: string;
  name: string;
};
