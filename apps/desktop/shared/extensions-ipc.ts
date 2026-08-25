/**
 * [INPUT]: The type-only AgentBackendId that relies on agent-ipc; Side effects of no platform
 * [OUTPUT]: Provides Agent Extension package/component tri-axis status, with source App requirement, declared/resolved config, backend/runtime eligibility/health, scoped grant, round delivery and installation/update/deactivation/unloading contract
 * [POS]: The Extension line protocol shared with the pure state truth source; The global capability matrix and the turn-scoped active fact is that the separation, installation, authorization, and delivery triad are not mutually exclusive in type
 */

import type { AgentBackendId } from "./agent-ipc";

export type Sha256Digest = `sha256:${string}`;

export type PackageGenerationDataBinding =
  | Readonly<{ kind: "none" }>
  | Readonly<{ kind: "stdio"; pluginDataEpochId: string }>;

export type ExtensionPackageGenerationRef = Readonly<{
  packageGenerationId: string;
  recordDigest: Sha256Digest;
}>;

export type PackageGenerationRecord = Readonly<{
  packageGenerationId: string;
  installIdentity: string;
  contentDigest: Sha256Digest;
  provenanceDigest: Sha256Digest;
  admissionEvidence: Readonly<{
    adapterId: string;
    schemaDigest: Sha256Digest;
    validatorFixtureDigest: Sha256Digest;
    admissionDigest: Sha256Digest;
  }>;
  /** admission 时冻结的人类可读名称，不从可变 URL 现场重算 */
  displayName?: string;
  declaredCapabilityDigest: Sha256Digest;
  dataBinding: PackageGenerationDataBinding;
  recordDigest: Sha256Digest;
}>;

export type FrozenExtensionInventoryReason = Readonly<{
  taxonomyVersion: 1;
  code:
    | "package-not-installed"
    | "no-matching-generation"
    | "generation-not-admitted"
    | "generation-removal-pending"
    | "component-not-found"
    | "identity-conflict"
    | "invalid-app-config";
  parameters: Readonly<Record<string, string>>;
  evidenceDigest: Sha256Digest;
}>;

export type FrozenExtensionDeliveryEligibilityReason = Readonly<{
  taxonomyVersion: 1;
  code:
    | "package-disabled"
    | "package-disable-pending"
    | "package-generation-removal-pending"
    | "component-disabled"
    | "backend-capability-mismatch"
    | "delivery-channel-unsupported"
    | "transport-unsupported"
    | "projection-unavailable"
    | "runtime-health-failed"
    | "turn-policy-ineligible"
    /** 计划已成立，但本轮只读快照没能物化出来；未物化即不得签发 */
    | "snapshot-materialization-failed";
  parameters: Readonly<Record<string, string>>;
  evidenceDigest: Sha256Digest;
}>;

export type ExtensionDeliveryStrength =
  | "per-tool-enforced"
  | "per-turn-enforced"
  | "server-inclusion-only"
  | "workspace-requested"
  | "backend-delegated"
  | "unsupported-by-policy"
  | "unknown";

export type ExtensionComponentKind = "skill" | "mcp-server";
export type ExtensionTransport =
  | "manual-snapshot"
  | "fixed-workspace"
  | "stdio"
  | "streamable-http"
  | "sse";

export type McpComponentHealthSubject =
  | Readonly<{
      kind: "package";
      generationRef: ExtensionPackageGenerationRef;
      componentId: string;
      serverId: string;
      declaredConfigDigest: Sha256Digest;
      resolvedConfigDigest: Sha256Digest;
      backend: AgentBackendId;
      runtimeVersion: string;
      transport: Extract<ExtensionTransport, "stdio" | "streamable-http" | "sse">;
    }>
  | Readonly<{
      kind: "manual";
      serverId: string;
      configDigest: Sha256Digest;
      backend: AgentBackendId;
      runtimeVersion: string;
      transport: Extract<ExtensionTransport, "stdio" | "streamable-http" | "sse">;
    }>;

export type McpComponentHealthRecord = Readonly<{
  subject: McpComponentHealthSubject;
  revision: number;
  state: "healthy" | "degraded" | "quarantined";
  evidence: "protocol-success" | "protocol-failure" | "custody-quarantine";
  evidenceDigest: Sha256Digest;
  consecutiveFailures: number;
  observedAt: number;
  retryAt: number | null;
  recordDigest: Sha256Digest;
}>;

export type ExtensionComponentRecord = Readonly<{
  componentIdentity: string;
  packageGenerationRef: ExtensionPackageGenerationRef;
  componentId: string;
  kind: ExtensionComponentKind;
  transport: ExtensionTransport;
  declarationDigest: Sha256Digest;
  declaredConfigDigest: Sha256Digest;
  serverId?: string;
}>;

export type ExtensionEnableState = "enabled" | "disable-pending" | "disabled";
export type ExtensionAdministrativeState = "active" | "disable-pending" | "denied";
export type ExtensionAdmissionState = "valid" | "misconfigured";

export type ExtensionDeliveryReference = Readonly<{
  capabilitySnapshotId: string;
  entryDigest: Sha256Digest;
  deliveryChannel: ExtensionTransport;
  strength: ExtensionDeliveryStrength;
  sharingPolicy: "isolated" | "share-identical";
}>;

export type ExtensionCapabilityEntry = Readonly<{
  componentIdentity: string;
  packageGenerationRef: ExtensionPackageGenerationRef;
  backendId: AgentBackendId;
  backendRuntimeIdentity: string;
  transport: ExtensionTransport;
  deliveryStrength: ExtensionDeliveryStrength;
  eligible: boolean;
  deliveryReference?: ExtensionDeliveryReference;
  exclusion?: FrozenExtensionDeliveryEligibilityReason;
  multiInstanceIsolation: boolean;
  health?: McpComponentHealthRecord;
}>;

export type ExtensionCapabilitySnapshot = Readonly<{
  snapshotId: string;
  snapshotDigest: Sha256Digest;
  inventoryRevision: string;
  backendId: AgentBackendId;
  backendRuntimeIdentity: string;
  productPolicyRevision: string;
  createdAt: number;
  entries: readonly ExtensionCapabilityEntry[];
}>;

export type ExtensionInventoryPackage = Readonly<{
  installIdentity: string;
  source: Readonly<{
    normalizedUrl: string;
    requestedRef: string;
    resolvedCommit: string;
    subdirectory: string;
    treeDigest: Sha256Digest;
    fetchedAt: number;
  }>;
  activeGenerationRef: ExtensionPackageGenerationRef | null;
  generations: readonly PackageGenerationRecord[];
  admission: ExtensionAdmissionState;
  administrativeState: ExtensionAdministrativeState;
  globalCatalogEnabled: boolean;
  enabled: ExtensionEnableState;
  enabledComponentIdentities: readonly string[];
  removalPendingGenerationIds: readonly string[];
}>;

export type ExtensionInventorySnapshot = Readonly<{
  revision: string;
  digest: Sha256Digest;
  packages: readonly ExtensionInventoryPackage[];
  components: readonly ExtensionComponentRecord[];
  /** registry 原始快照为空；health authority 按 backend/runtime 合成观察记录。 */
  health?: readonly McpComponentHealthRecord[];
}>;

export type AppExtensionRequirementDeclaration = Readonly<{
  componentIdentity: string;
  packageDigest?: string;
  versionRange?: string;
  required: boolean;
  requestedConfig?: Record<string, unknown>;
  source?: Readonly<{ repoUrl: string; ref?: string }>;
}>;

export type AppExtensionRequirementManifestField = Readonly<{
  extensionRequirements?: readonly AppExtensionRequirementDeclaration[];
}>;

export type FrozenAppExtensionRequirement =
  | Readonly<{
      state: "resolved";
      componentIdentity: string;
      packageGenerationRef: ExtensionPackageGenerationRef;
      required: boolean;
      declarationDigest: Sha256Digest;
      resolvedConfigDigest: Sha256Digest;
      capabilitySetDigest: Sha256Digest;
    }>
  | Readonly<{
      state: "unresolved";
      componentIdentity: string;
      required: boolean;
      declarationDigest: Sha256Digest;
      reason: FrozenExtensionInventoryReason;
    }>;

export type FrozenAppExtensionRequirementSetV1 = Readonly<{
  resolutionId: string;
  appGenerationId: string;
  registryRevision: string;
  inventorySnapshotDigest: Sha256Digest;
  graphDigest: Sha256Digest;
  resolutionDigest: Sha256Digest;
  status: "ready" | "degraded" | "blocked";
  extensionRequirements: readonly FrozenAppExtensionRequirement[];
}>;

export type ScopedComponentGrant = Readonly<{
  appId: string;
  appGenerationId: string;
  requirementResolutionDigest: Sha256Digest;
  declarationDigest: Sha256Digest;
  componentIdentity: string;
  packageGenerationRef: ExtensionPackageGenerationRef;
  resolvedConfigDigest: Sha256Digest;
  grantRevision: number;
  grantedAt: number;
}>;

export type AppExtensionConsentDecisionBase = Readonly<{
  decisionId: string;
  appId: string;
  pendingAppGenerationId: string;
  requirementResolutionDigest: Sha256Digest;
  consentRevision: number;
}>;

export type AppExtensionConsentDecision = Readonly<
  AppExtensionConsentDecisionBase &
    (
      | { status: "consent-required"; grantSetDigest?: never }
      | { status: "granted" | "denied"; grantSetDigest: Sha256Digest }
      | {
          status: "derived";
          grantSetDigest: Sha256Digest;
          derivedFrom: {
            appGenerationId: string;
            grantSetDigest: Sha256Digest;
          };
        }
    )
>;

export type ExtensionTurnIdentity = Readonly<{
  turnClass: "manual" | "relay" | "headless";
  planMode: boolean;
  backendId: AgentBackendId;
  backendRuntimeIdentity: string;
  workspace:
    | { kind: "none" }
    | {
        kind: "owned";
        workspaceCapabilityId: string;
        canonicalIdentityDigest: Sha256Digest;
        lifecycleRevision: number;
      };
}>;

export type ComponentDeliveryPlan = Readonly<{
  planInstanceId: string;
  planDigest: Sha256Digest;
  inventoryRevision: string;
  capabilitySnapshotDigest: Sha256Digest;
  turnIdentity: ExtensionTurnIdentity;
  appBindings: readonly Readonly<{
    appId: string;
    appGenerationId: string;
    appReferenceLeaseId: string;
    requirementResolutionDigest: Sha256Digest;
    appGrantAggregateRevision: number;
    requirementBindings: readonly Readonly<{
      declarationDigest: Sha256Digest;
      componentIdentity: string;
      packageGenerationRef: ExtensionPackageGenerationRef;
      resolvedConfigDigest: Sha256Digest;
      required: boolean;
      scopedGrantRevision: number;
      deliveryInstanceId: string;
    }>[];
  }>[];
  deliveries: readonly Readonly<{
    deliveryInstanceId: string;
    componentIdentity: string;
    packageGenerationRef: ExtensionPackageGenerationRef;
    resolvedConfigDigest: Sha256Digest;
    componentPlanLeaseId: string;
    deliveryRef: ExtensionDeliveryReference;
  }>[];
}>;

export type FrozenComponentDeliveryExclusionReason =
  | Readonly<{ kind: "inventory"; reason: FrozenExtensionInventoryReason }>
  | Readonly<{
      kind: "delivery-eligibility";
      reason: FrozenExtensionDeliveryEligibilityReason;
    }>
  | Readonly<{
      kind: "authorization";
      taxonomyVersion: 1;
      code:
        | "product-policy-denied"
        | "user-global-denied"
        | "app-consent-missing"
        | "scoped-grant-missing"
        | "scoped-grant-revoked"
        | "attachment-delegation-disabled";
      parameters: Readonly<Record<string, string>>;
      evidenceDigest: Sha256Digest;
    }>
  | Readonly<{
      kind: "composition";
      taxonomyVersion: 1;
      code: "multi-instance-conflict" | "sharing-policy-conflict";
      parameters: Readonly<Record<string, string>>;
      evidenceDigest: Sha256Digest;
    }>;

export type ComponentDeliveryExclusion = Readonly<{
  appId: string;
  appGenerationId: string;
  requirementResolutionDigest: Sha256Digest;
  declarationDigest: Sha256Digest;
  componentIdentity: string;
  required: boolean;
  reason: FrozenComponentDeliveryExclusionReason;
}>;

export type ComponentDeliveryDecision =
  | Readonly<{
      status: "blocked";
      exclusions: readonly ComponentDeliveryExclusion[];
      plan?: never;
    }>
  | Readonly<{
      status: "ready" | "degraded";
      exclusions: readonly ComponentDeliveryExclusion[];
      plan: ComponentDeliveryPlan;
    }>;

/* ------------------------------------------------------------------------- *
 *  Renderer 契约。
 *
 *  admission 的 `pluginRoot` 是 userData 下的绝对路径，与 app-ipc 的 opaque
 *  文件授权同理：真实路径永不进 renderer。下面这些 DTO 因此是**投影**，不是
 *  内部结构的直传——UI 拿到的每个字段都必须是它有权知道的。
 * ------------------------------------------------------------------------- */

export type ExtensionDisclosureView = Readonly<{
  executableScripts: readonly string[];
  skills: readonly Readonly<{
    componentId: string;
    name: string;
    allowedTools: readonly string[];
    /** 整个 skill 目录（含 references/）的 canonical 内容摘要 */
    contentDigest: Sha256Digest;
  }>[];
  mcpServers: readonly Readonly<{
    componentId: string;
    serverId: string;
    transport: ExtensionTransport;
    endpoint?: string;
    command?: string;
    /** 只有名字：header 值可能是凭据 */
    staticHeaderNames: readonly string[];
  }>[];
  requiresPluginDataWriteRoot: boolean;
}>;

/* 首装与更新是同一条流水线：install identity 由「来源 + 子目录」决定，所以
   对同一个仓库再预检一次，天然就是这个安装的下一代。差异只在下面两个字段。 */
export type ExtensionCapabilityDiffView = Readonly<{
  previousGenerationId: string;
  /** canonical 能力行；新增即扩权 */
  added: readonly string[];
  removed: readonly string[];
  /** 扩权必须重新授权：新代 seal 后全部 component 回到未启用 */
  requiresReauthorization: boolean;
}>;

/** 更新时仍精确绑定旧代的 App；迁移与否由用户逐个选择，不迁移就继续用旧代 */
export type ExtensionAffectedAppView = Readonly<{
  appId: string;
  appGenerationId: string;
}>;

export type ExtensionPreflightView = Readonly<{
  preflightId: string;
  contentDigest: Sha256Digest;
  componentNamespace: string;
  installIdentity: string;
  adapterId: string;
  source: Readonly<{
    normalizedUrl: string;
    requestedRef: string;
    resolvedCommit: string;
    subdirectory: string;
  }>;
  disclosure: ExtensionDisclosureView;
  /** report 级诊断（未知顶层字段等）；error 级会让 preflight 直接失败 */
  reports: readonly string[];
  fileCount: number;
  totalBytes: number;
  /** null = 首装；非 null 即这是同一 install identity 的新一代 */
  capabilityDiff: ExtensionCapabilityDiffView | null;
  affectedApps: readonly ExtensionAffectedAppView[];
}>;

export type ExtensionDeliveryHealthStatus =
  | "healthy"
  | "degraded"
  | "unavailable"
  | "unknown";

export type ExtensionBackendEligibilityView = Readonly<{
  backendId: AgentBackendId;
  channel: ExtensionTransport;
  eligible: boolean;
  strength: ExtensionDeliveryStrength;
  exclusionCode?: FrozenExtensionDeliveryEligibilityReason["code"];
}>;

export type ExtensionBackendHealthView = Readonly<{
  backendId: AgentBackendId;
  channel: ExtensionTransport;
  status: ExtensionDeliveryHealthStatus;
}>;

export type ExtensionComponentView = Readonly<{
  componentIdentity: string;
  componentId: string;
  kind: ExtensionComponentKind;
  transport: ExtensionTransport;
  enabled: boolean;
  /** 全局页只放 per-backend 能力与健康；本轮生效是 conversation-scoped 事件。 */
  eligibility: readonly ExtensionBackendEligibilityView[];
  deliveryHealth: readonly ExtensionBackendHealthView[];
}>;

/* disable 的收敛是四步，逐步落盘：崩溃后不重做已完成的步骤，也不跳过未完成的。
   四步全绿之前 enabled 只能停在 `disable-pending`。 */
export type ExtensionConvergenceStep =
  | "projection-binding-revoked"
  | "shared-artifacts-released"
  | "product-sessions-drained"
  | "discovery-cache-invalidated";

/**
 * 物理卸载的四步，同样逐步落盘。前两步是**闸**：durable 引用要由用户解决，
 * 运行期 lease/custody 要自己归零；后两步才是不可逆的回收。
 */
export type ExtensionUninstallStep =
  | "durable-references-resolved"
  | "runtime-custody-drained"
  | "package-generations-removed"
  | "package-bytes-collected";

export type ExtensionLifecycleStep =
  | ExtensionConvergenceStep
  | ExtensionUninstallStep;

/**
 * 投影的所有权主体。用户与每个 App 各自持有**独立**的 workspace consent；
 * 产品绝不从 AppReferenceLease 推导投影所有权——那条 lease 只证明「本轮这个
 * App 在场」，不证明用户同意把字节写进这个 workspace。
 */
export type ExtensionProjectionOwner =
  | Readonly<{ kind: "user" }>
  | Readonly<{ kind: "app"; appId: string }>;

/** 产品没写过、也无权撤销的副本：只能如实标 backend-delegated 并交回用户处置 */
export type ExtensionForeignOccupancyView = Readonly<{
  projectionId: string;
  componentIdentity: string;
  strength: Extract<ExtensionDeliveryStrength, "backend-delegated">;
}>;

export type ExtensionConvergenceView = Readonly<{
  operationId: string;
  completedSteps: readonly ExtensionConvergenceStep[];
  /** 非 null 即收敛卡住：状态停在 disable-pending，绝不冒充 disabled */
  blocked: string | null;
}>;

/** 仍被精确绑定的旧代：保持不可变、可寻址，回收要等 owner 全部归零 */
export type ExtensionRetainedGenerationView = Readonly<{
  generationId: string;
  resolvedCommit: string;
  blockerCount: number;
}>;

/**
 * 卸载进行中的账面。`boundApps` 非空即**绝不物理删除**：用户要么逐个迁移，
 * 要么放弃卸载让这个包保持「已停用但仍安装」——产品无权把旧 frozen graph
 * 原地改成 degraded。
 */
export type ExtensionUninstallView = Readonly<{
  operationId: string;
  completedSteps: readonly ExtensionUninstallStep[];
  blocked: string | null;
  boundApps: readonly ExtensionAffectedAppView[];
  /** 其它 durable owner（逐轮 plan lease、尚未释放的 reservation）的 owner id */
  otherOwners: readonly string[];
  /** 未归还的 ProjectionBindingLease；共享产物仍被别人指着的条数 */
  projectionLeases: number;
  sharedArtifacts: number;
  /** 进程 / transport custody 未归零的凭据 */
  custody: readonly string[];
}>;

/**
 * package 代码已回收、install-owned 数据仍在盘上。
 *
 * 这不是遗漏：code GC 顺手删数据，等于让「换个版本」和「丢掉全部历史」共用
 * 一个动作。最终数据删除只能是全部 generation/custody 归零后的独立显式动作。
 */
export type ExtensionRetainedInstallDataView = Readonly<{
  installIdentity: string;
  epochIds: readonly string[];
  /** 非空即还不能删 */
  custody: readonly string[];
}>;

export type ExtensionPackageView = Readonly<{
  installIdentity: string;
  adapterId: string;
  displayName: string;
  admission: ExtensionAdmissionState;
  administrativeState: ExtensionAdministrativeState;
  globalCatalogEnabled: boolean;
  enabled: ExtensionEnableState;
  source: Readonly<{
    normalizedUrl: string;
    resolvedCommit: string;
    subdirectory: string;
    fetchedAt: number;
  }>;
  activeGenerationId: string | null;
  components: readonly ExtensionComponentView[];
  retainedGenerations: readonly ExtensionRetainedGenerationView[];
  /** 收敛结束不代表外部副本被处置了：它比收敛活得久，一直留在界面上 */
  foreignOccupancies: readonly ExtensionForeignOccupancyView[];
  /** null = 没有进行中的停用收敛 */
  convergence: ExtensionConvergenceView | null;
  /** null = 没有进行中的物理卸载 */
  uninstall: ExtensionUninstallView | null;
}>;

export type ExtensionsSnapshot = Readonly<{
  packages: readonly ExtensionPackageView[];
  /** 收敛未完成期间不得启动新的产品会话；UI 照实说明这道闸 */
  productSessionAdmissionClosed: boolean;
  /** package 已回收但数据仍在的安装；删除数据是独立、显式的动作 */
  retainedInstallData: readonly ExtensionRetainedInstallDataView[];
}>;

export const EXTENSIONS_CHANNEL = {
  list: "extensions:list",
  preflight: "extensions:preflight",
  confirm: "extensions:confirm",
  discard: "extensions:discard",
  enableComponent: "extensions:enable-component",
  disableComponent: "extensions:disable-component",
  beginDisable: "extensions:begin-disable",
  beginUninstall: "extensions:begin-uninstall",
  resolveUninstall: "extensions:resolve-uninstall",
  cancelUninstall: "extensions:cancel-uninstall",
  purgeInstallData: "extensions:purge-install-data",
  changed: "extensions:changed",
} as const;

export type ExtensionsBridgeApi = {
  list(): Promise<ExtensionsSnapshot>;
  preflight(input: {
    repoUrl: string;
    requestedRef?: string;
    subdirectory?: string;
  }): Promise<ExtensionPreflightView>;
  confirm(input: {
    preflightId: string;
    expectedContentDigest: Sha256Digest;
    expectedResolvedCommit: string;
    /** 只有这里点名的 App 才创建新的 pending 代；其余继续指向旧代 */
    migrateAppIds?: readonly string[];
  }): Promise<ExtensionsSnapshot>;
  discard(preflightId: string): Promise<void>;
  enableComponent(componentIdentity: string): Promise<ExtensionsSnapshot>;
  disableComponent(componentIdentity: string): Promise<ExtensionsSnapshot>;
  beginDisable(installIdentity: string): Promise<ExtensionsSnapshot>;
  /** 关闭该包全部代的新 reservation/plan/projection 准入，并列出待解决的引用 */
  beginUninstall(installIdentity: string): Promise<ExtensionsSnapshot>;
  /** 只有这里点名的 App 才起新的 pending 代；随后再试着把卸载推进一步 */
  resolveUninstall(input: {
    installIdentity: string;
    migrateAppIds?: readonly string[];
  }): Promise<ExtensionsSnapshot>;
  /** 放弃卸载：重开准入，包保持「已停用但仍安装」 */
  cancelUninstall(installIdentity: string): Promise<ExtensionsSnapshot>;
  /** 独立、显式的最终数据删除；package 未回收干净时拒绝 */
  purgeInstallData(installIdentity: string): Promise<ExtensionsSnapshot>;
  onChanged(listener: (snapshot: ExtensionsSnapshot) => void): () => void;
};
