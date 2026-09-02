/**
 * [INPUT]: Depends only on type-only Apps manifest, record, domain, grant, and availability primitives
 * [OUTPUT]: Provides enumerable Base GUI capabilities, compatibility-bound capability decisions, derived Studio data grants, content-layout-aware surface leases, staged GUI readiness/bindings, actions, and trusted Design history commands
 * [POS]: Shared Apps wire leaf for renderer surfaces; apps-ipc re-exports it while lifecycle/install contracts remain separate
 */

import type {
  AppCapabilityGrant,
  AppDomainIdentity,
  AppManifest,
  AvailableAppsInput,
} from "./apps-ipc";
import type { Sha256Digest } from "./extensions-ipc";
import type {
  BaseGuiBuildManifest,
  BaseGuiPreferencesManifest,
} from "./app-gui/contracts";
import type {
  BeginFileExportRequestV1,
  WriteFileExportChunkHeaderV1,
} from "./app-gui/file-export";
export * from "./app-gui/contracts";
export * from "./app-gui/cutover";
export * from "./app-gui/query";
export * from "./app-gui/file-export";

export const BASE_GUI_CAPABILITIES = [
  "row-insert",
  "row-patch",
  "row-delete",
  "attachment-read",
  "workspace-read",
] as const;
export type BaseGuiCapability = (typeof BASE_GUI_CAPABILITIES)[number];

export type BaseGuiHostActionCapability = "compose-text" | "file.export";
export type BaseGuiCapabilityScopes = Readonly<{ workspaceRead?: "design/" }>;

export type BaseGuiManifest = Readonly<{
  capabilities: readonly BaseGuiCapability[];
  hostActions?: readonly BaseGuiHostActionCapability[];
  capabilityScopes?: BaseGuiCapabilityScopes;
  build?: BaseGuiBuildManifest;
  preferences?: BaseGuiPreferencesManifest;
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
  requestedHostActions: readonly BaseGuiHostActionCapability[];
  grantedHostActions: readonly BaseGuiHostActionCapability[];
  requestedCapabilityScopes: BaseGuiCapabilityScopes;
  grantedCapabilityScopes: BaseGuiCapabilityScopes;
  compatibilityRefDigest?: Sha256Digest;
  compatibilityMigrationRevision?: string;
  state: "consent-required" | "approved" | "declined";
}>;

export type BaseGuiLiveBinding = Readonly<{
  appId: string;
  /** Absent only for pre-v3 legacy fixtures created before the discriminated floor. */
  contentLayoutVersion?: 2 | 3;
  generationId: string;
  contentDigest: Sha256Digest;
  lifecycleRevision: number;
  baseCapabilities: readonly BaseGuiCapability[];
  hostActions: readonly BaseGuiHostActionCapability[];
  workspaceReadScope: "design/" | null;
  surfaceId: string;
  appSurfaceLeaseId: string | null;
  capabilityDecisionId: string | null;
  capabilityRevision: number;
}>;

export function requestedBaseGuiCapabilities(
  manifest: AppManifest | null | undefined
): readonly BaseGuiCapability[] {
  return manifest?.kind === "base"
    ? [...new Set(manifest.gui?.capabilities ?? [])]
    : [];
}

export function requestedBaseGuiHostActions(
  manifest: AppManifest | null | undefined
): readonly BaseGuiHostActionCapability[] {
  return manifest?.kind === "base"
    ? [...new Set(manifest.gui?.hostActions ?? [])]
    : [];
}

export function requestedBaseGuiCapabilityScopes(
  manifest: AppManifest | null | undefined
): BaseGuiCapabilityScopes {
  if (
    manifest?.kind !== "base" ||
    !manifest.gui?.capabilities.includes("workspace-read") ||
    manifest.gui.capabilityScopes?.workspaceRead !== "design/"
  ) return {};
  return { workspaceRead: "design/" };
}

/**
 * Studio 数据档只由冻结 manifest 推导：GUI 至少可读自己的 Base，声明任一
 * row mutation 才升级为 row-write。精确操作仍由 Base GUI decision 二次裁剪。
 */
export function studioDataGrantForManifest(
  manifest: AppManifest | null | undefined
): AppCapabilityGrant["data"] | null {
  if (manifest?.kind !== "base" || !manifest.gui) return null;
  const rowWrite = manifest.gui.capabilities.some((capability) =>
    capability === "row-insert" ||
    capability === "row-patch" ||
    capability === "row-delete"
  );
  return { kind: "base", level: rowWrite ? "row-write" : "read" };
}

export const BASE_GUI_ACTION_CHANNEL = "ai-chat:base-gui-host-action";
export const BASE_GUI_ACTION_RESULT_CHANNEL = "ai-chat:base-gui-host-action-result";
export type BaseGuiHostAction =
  | { type: "open-data" }
  | { type: "open-data-view"; viewId: string }
  | { type: "compose-text"; text: string }
  | { type: "file.export.begin"; request: BeginFileExportRequestV1 }
  | { type: "file.export.chunk"; header: WriteFileExportChunkHeaderV1; bytes: Uint8Array }
  | { type: "file.export.finalize"; exportId: string }
  | { type: "file.export.cancel"; exportId: string };

export type AppSurfaceMode = "chat-tab" | "studio";
export type AppSurfaceAcquireInput = AvailableAppsInput & {
  appId: string;
  mode: AppSurfaceMode;
};
export type AppAttachmentSurface = Readonly<{
  surfaceLeaseId: string;
  conversationId: string;
  conversationIncarnationId: string;
  appId: string;
  mode: AppSurfaceMode;
  generationId: string;
  contentDigest: Sha256Digest;
  lifecycleRevision: number;
  workspaceAuthorityIdentity: string;
  domainIdentity: AppDomainIdentity;
  dataGrant: AppCapabilityGrant["data"] | null;
  ownerKey: string | null;
}>;

export type AppGuiInfo = {
  pages: string[];
  origin: string;
  token: string;
  generationKey?: string;
  bootstrapProtocol?: "load-v0" | "nonce-ready-v1";
  baseCapabilities: readonly BaseGuiCapability[];
  hostActions: readonly BaseGuiHostActionCapability[];
  /** Exact runtime surface lease; differs from the logical lease while staging. */
  appSurfaceLeaseId?: string;
  cutover?: Readonly<{
    cutoverId: string;
    lifecycle: "staging" | "active";
  }>;
  error?: string;
};

export type AppGuiInfoInput = Readonly<{
  appId: string;
  surfaceId: string;
  appSurfaceLeaseId: string;
}>;

export type AppGuiReadyInput = AppGuiInfoInput & Readonly<{
  cutoverId: string;
  readyNonce: string;
}>;

export type AppGuiReadyResult = Readonly<{
  outcome: "committed" | "aborted";
}>;

export type DesignCanvasVersion = Readonly<{
  versionId: string;
  file: string;
  digest: string;
  source: "ai" | "manual" | "restore";
  parentVersion: string | null;
  restoredFromVersion?: string;
  provenance: Readonly<{
    chatId?: string;
    conversationIncarnationId?: string;
    turnId?: string;
  }>;
  createdAt: number;
}>;

export type DesignSurfaceInput = Readonly<{
  appId: string;
  appSurfaceLeaseId: string;
}>;
export type ImportDesignCanvasInput = DesignSurfaceInput & Readonly<{ file: string }>;
export type ListDesignVersionsInput = ImportDesignCanvasInput;
export type RestoreDesignVersionInput = DesignSurfaceInput &
  Readonly<{ versionId: string; confirmed: true }>;
export type DesignAutoOpenInput = Readonly<{
  appId: string;
  conversationId: string;
  conversationIncarnationId: string;
  suppressed: boolean;
}>;
export type DesignDataStatus = Readonly<{
  dataCustodyId: string;
  stableWorkspaceOwnerId: string;
}> | null;
export type DeleteDesignDataInput = Readonly<{
  appId: string;
  dataCustodyId: string;
  confirmed: true;
}>;
export type SetDesignEnabledInput = Readonly<{
  appId: string;
  enabled: boolean;
}>;
