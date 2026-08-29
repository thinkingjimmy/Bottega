/**
 * [INPUT]: Depends only on type-only Apps manifest, record, domain, grant, and availability primitives
 * [OUTPUT]: Provides Base GUI capabilities/actions, effective open mode, surface leases, GUI bindings, and trusted Design history commands
 * [POS]: Shared Apps wire leaf for renderer surfaces; apps-ipc re-exports it while lifecycle/install contracts remain separate
 */

import type {
  AppCapabilityGrant,
  AppDomainIdentity,
  AppManifest,
  AppRecord,
  AvailableAppsInput,
} from "./apps-ipc";
import type { Sha256Digest } from "./extensions-ipc";

export type AppOpenMode = "same-window" | "new-window";

export function effectiveAppOpenMode(
  record: Pick<AppRecord, "manifest" | "openModeOverride">
): AppOpenMode {
  return record.openModeOverride ?? record.manifest?.defaultOpenMode ?? "same-window";
}

export type BaseGuiCapability =
  | "row-insert"
  | "row-patch"
  | "row-delete"
  | "attachment-read"
  | "workspace-read";

export type BaseGuiHostActionCapability = "compose-text";
export type BaseGuiCapabilityScopes = Readonly<{ workspaceRead?: "design/" }>;

export type BaseGuiManifest = Readonly<{
  capabilities: readonly BaseGuiCapability[];
  hostActions?: readonly BaseGuiHostActionCapability[];
  capabilityScopes?: BaseGuiCapabilityScopes;
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
  state: "consent-required" | "approved" | "declined";
}>;

export type BaseGuiLiveBinding = Readonly<{
  appId: string;
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

export const BASE_GUI_ACTION_CHANNEL = "ai-chat:base-gui-host-action";
export const BASE_GUI_ACTION_RESULT_CHANNEL = "ai-chat:base-gui-host-action-result";
export type BaseGuiHostAction =
  | { type: "open-data" }
  | { type: "open-data-view"; viewId: string }
  | { type: "compose-text"; text: string };
export type BaseGuiHostMessage = {
  channel: typeof BASE_GUI_ACTION_CHANNEL;
  token: string;
  requestId: string;
  action: BaseGuiHostAction;
};
export type BaseGuiHostActionResult = {
  channel: typeof BASE_GUI_ACTION_RESULT_CHANNEL;
  requestId: string;
  ok: boolean;
  error?: string;
};

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
  baseCapabilities: readonly BaseGuiCapability[];
  hostActions: readonly BaseGuiHostActionCapability[];
  error?: string;
};

export type AppGuiInfoInput = Readonly<{
  appId: string;
  surfaceId: string;
  appSurfaceLeaseId: string;
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
