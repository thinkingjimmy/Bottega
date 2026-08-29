/**
 * [INPUT]: type-only depends on the generation/domain/Base GUI access DTO for apps-ipc and the digest, requirement declaration for extensions-ipc
 * [OUTPUT]: Provides two process custody, activation, drain, data epoch, with a build, reference, and execution plan digest of Base GUI capability request/checkpoint, with the ownership of the contract with the cutover source/target closed durable lifecycle
 * [POS]: The App is a shared App Attach lifecycle protocolThe renderer has no capability-bearing identity
 */

import type {
  AppDomainIdentity,
  AppGenerationRuntimeBinding,
  BaseGuiCapability,
  BaseGuiCapabilityScopes,
  BaseGuiHostActionCapability,
} from "./apps-ipc";
import type {
  AppExtensionRequirementDeclaration,
  Sha256Digest,
} from "./extensions-ipc";

export type AppGenerationBuildCheckpoint = Readonly<{
  kind: "app-extension" | "base-gui" | "server-data-cutover";
  operationId: string;
  state: "prepared" | "committed" | "aborted" | "needs-attention";
}>;

export type AppGenerationBuildOperation = Readonly<{
  generationBuildId: string;
  appId: string;
  appGenerationId: string;
  expectedActiveGenerationId: string | null;
  phase:
    | "staging"
    | "generation-committed"
    | "ready-to-promote"
    | "promoted"
    | "aborted"
    | "needs-attention";
  revision: number;
  normalizedDomainIdentity: AppDomainIdentity;
  runtime: AppGenerationRuntimeBinding;
  /** staging 阶段就冻结的 normalized 声明；participant 只读它，不回查 live manifest */
  extensionRequirements: readonly AppExtensionRequirementDeclaration[];
  /** Base generation 的 GUI 请求与 sealed content 同时冻结；非 Base 不带此字段。 */
  baseGuiCapabilityRequest?: Readonly<{
    requestedCapabilities: readonly BaseGuiCapability[];
    requestedHostActions: readonly BaseGuiHostActionCapability[];
    requestedCapabilityScopes: BaseGuiCapabilityScopes;
    contentDigest: Sha256Digest;
  }>;
  checkpoints: readonly AppGenerationBuildCheckpoint[];
}>;

export type FrozenAppReferenceCapability = Readonly<{
  data: "none" | "base-read" | "base-row-write";
  fileRead: boolean;
  useData: boolean;
  backendId: string;
  snapshotDigest: Sha256Digest;
}>;

export type AppReferenceOwner =
  | Readonly<{
      kind: "chat-turn" | "relay-attempt";
      ownerId: string;
      ownerRevision: number;
    }>
  | Readonly<{
      kind: "app-internal-turn";
      ownerId: string;
      ownerRevision: number;
      activationId: string;
    }>;

export type AppReferenceJournalEntry = Readonly<{
  journalEntryId: string;
  leaseId: string;
  turnRequestId: string;
  owner: AppReferenceOwner;
  appId: string;
  generationId: string;
  contentDigest: Sha256Digest;
  lifecycleRevision: number;
  frozenCapability: FrozenAppReferenceCapability;
  capabilityDigest: Sha256Digest;
  phase: "prepared" | "active" | "release-pending" | "released";
}>;

export type AgentTurnCustodyDependency =
  | Readonly<{ kind: "app-reference"; journalEntryId: string }>
  | Readonly<{
      kind: "extension-plan";
      planInstanceId: string;
      planDigest: Sha256Digest;
      componentPlanLeaseIds: readonly string[];
    }>;

/**
 * `birthIdentity` 是 PID 复用的唯一判据，必须来自 OS 的进程创建时刻
 * （darwin/linux 的 `ps -o lstart=`），不能用 main 侧的 `Date.now()` 冒充——
 * 后者在 main 重启后无从复现，也就证不了「这个 PID 还是当年那个进程」。
 */
export type ProcessIdentity = Readonly<{
  pid: number;
  processGroupId: number;
  birthIdentity: string;
  executableIdentity: string;
}>;

export type AgentTurnCustodyOwner =
  | AppReferenceOwner;

export type AgentTurnCustodyEntry = Readonly<{
  custodyId: string;
  turnRequestId: string;
  owner: AgentTurnCustodyOwner;
  backendRuntimeIdentity: string;
  controlNonce: string;
  dependencies: readonly AgentTurnCustodyDependency[];
  phase:
    | "intent"
    | "aborted"
    | "owned"
    | "activation-authorized"
    | "activated"
    | "release-pending"
    | "released"
    | "quarantined";
  revision: number;
  processIdentity?: ProcessIdentity;
  abortReason?: ProcessCustodyAbortReason;
  quarantineReason?: ProcessCustodyQuarantineReason;
}>;

/**
 * abort/quarantine 两支原因由 Agent turn 与 App server 两本账共用：D29 与 D33
 * 是同构而非同一，但「凭什么写这个 tombstone」的判据必须只有一套。
 */

/** 只能从 pre-owned intent 进入的不可逆 tombstone 原因；三支都不持 PID。 */
export type ProcessCustodyAbortReason =
  | "cancelled-before-owned"
  | "guardian-spawn-failed"
  | "owner-no-longer-live";

/**
 * 不是失败，是「不敢下结论」：两支都意味着我们既不能证明进程已退出，
 * 也不敢向可能被复用的 PID 发信号，于是全部关联 capability owner 留在
 * quarantine，禁止 GC 与新能力签发，直到恢复面收敛。
 */
export type ProcessCustodyQuarantineReason =
  | "process-identity-unconfirmed"
  | "process-survived-kill";

/**
 * App server 的 durable custody 记录（D29）。与 turn custody 相位集同构，
 * 但绑的是 generation/data epoch 与 activation，而不是 turn 的 logical lease。
 */
export type AppProcessCustodyEntry = Readonly<{
  custodyId: string;
  appId: string;
  activationId: string;
  generationId: string;
  contentDigest: Sha256Digest;
  lifecycleRevision: number;
  dataEpochId: string;
  controlNonce: string;
  phase: AgentTurnCustodyEntry["phase"];
  revision: number;
  processIdentity?: ProcessIdentity;
  abortReason?: ProcessCustodyAbortReason;
  quarantineReason?: ProcessCustodyQuarantineReason;
}>;

export type AppGenerationDrainCount = Readonly<{
  providerId: string;
  count: number;
  evidenceIds: readonly string[];
}>;

/**
 * epoch 的所有权状态与「哪一次切换造了它」是两件事，分两张表记：
 * ownership 回答「这份可写字节现在归谁、能不能删」，cutover 回答「从哪来、到哪去」。
 * 合成一格会让 delete 的 archive 流程与 update 的 source fence 互相污染。
 */
export type AppDataEpochOwnership =
  | Readonly<{
      dataEpochId: string;
      appId: string;
      state: "staged" | "active" | "retained" | "discard-pending" | "discarded";
    }>
  | Readonly<{
      dataEpochId: string;
      appId: string;
      state: "archive-pending" | "archived";
      archiveId: string;
    }>;

/** 三种 source 的封闭联合；任一分支都不得伪造 source generation。 */
export type AppDataCutoverSource =
  | Readonly<{ kind: "none" }>
  | Readonly<{ kind: "existing"; generationId: string; dataEpochId: string }>
  | Readonly<{ kind: "legacy-import"; snapshotId: string }>;

/**
 * `disposition` 是单调的 durable 决定轴，`phase` 只是 `open` 期间的进度标记。
 * 重启对账只信 disposition + store 里那条 active binding：两者交叉即可判定
 * 「CAS 到底发生没发生」，不必给物理目录再编一套心跳。
 */
export type AppDataCutoverRecord = Readonly<{
  cutoverId: string;
  generationBuildId: string;
  revision: number;
  disposition:
    | "open"
    | "prepared"
    | "committed"
    | "abort-pending"
    | "aborted"
    | "released";
  appId: string;
  source: AppDataCutoverSource;
  target: Readonly<{ generationId: string; dataEpochId: string }>;
  phase: "admission-close" | "source-drain" | "target-build" | "cas" | "done";
}>;
