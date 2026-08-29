/**
 * [INPUT]: Depends on type-only Apps lifecycle, grant, package, surface, and Design command DTOs
 * [OUTPUT]: Provides APPS_CHANNEL and the complete renderer AppsBridgeApi contract
 * [POS]: Shared Apps wire boundary; keeps channel routing and preload shape separate from durable domain records
 */

import type {
  AddAppInput,
  AppCapabilitiesSnapshot,
  AppConfigValue,
  AppExtensionStatus,
  AppGrantSnapshot,
  AppGrantSourcesSnapshot,
  AppGrantTarget,
  AppInstallEvent,
  AppManagementLeaseRef,
  AppOpenResult,
  AppRecord,
  AppRepoProbeResult,
  AppRuntimeStatus,
  AppsListSnapshot,
  AvailableAttachedApp,
  AvailableAppsInput,
  EnsureAppChatSlotInput,
  EnsureAppChatSlotResult,
  GhStatus,
  InstallPresetInput,
  PresetAppSummary,
  PresetProbeResult,
  RemoveAppMode,
  RenameAppInput,
  SaveAsAppInput,
  SaveAsAppResult,
  SetAppAgentInput,
  SetAppGrantInput,
  SetAppGrantStateInput,
  SetDefaultAppGrantInput,
  SharePreview,
  SharePreviewInput,
  SharePublishInput,
} from "./apps-ipc";
import type {
  AppAttachmentSurface,
  AppGuiInfo,
  AppGuiInfoInput,
  AppOpenMode,
  AppSurfaceAcquireInput,
  BaseGuiCapability,
  BaseGuiCapabilityScopes,
  BaseGuiHostActionCapability,
  DeleteDesignDataInput,
  DesignAutoOpenInput,
  DesignCanvasVersion,
  DesignDataStatus,
  DesignSurfaceInput,
  ImportDesignCanvasInput,
  ListDesignVersionsInput,
  RestoreDesignVersionInput,
  SetDesignEnabledInput,
} from "./apps-surface-ipc";

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
  releaseGuiSurface: "apps:gui-surface:release",
  setOpenMode: "apps:open-mode:set",
  importDesignCanvas: "apps:design:import",
  listDesignImportCandidates: "apps:design:import-candidates",
  listDesignFiles: "apps:design:files",
  listDesignVersions: "apps:design:versions",
  restoreDesignVersion: "apps:design:restore",
  setDesignAutoOpen: "apps:design:auto-open:set",
  designDataStatus: "apps:design:data:status",
  deleteDesignData: "apps:design:data:delete",
  setDesignEnabled: "apps:design:enabled:set",
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

export type AppsBridgeApi = {
  add: (input: AddAppInput) => Promise<AppRecord>;
  remove: (appId: string, mode?: RemoveAppMode, requestId?: string) => Promise<void>;
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
  ensureChatSlot: (input: EnsureAppChatSlotInput) => Promise<EnsureAppChatSlotResult>;
  retrySkill: (appId: string) => Promise<AppRecord>;
  resolveExtensionConsent: (input: { appId: string; granted: boolean }) => Promise<AppRecord>;
  resolveBaseGuiConsent: (input: {
    appId: string;
    grantedCapabilities: BaseGuiCapability[];
    grantedHostActions?: BaseGuiHostActionCapability[];
    grantedCapabilityScopes?: BaseGuiCapabilityScopes;
  }) => Promise<AppRecord>;
  revokeBaseGuiAccess: (appId: string) => Promise<AppRecord>;
  promoteGeneration: (input: { appId: string; expectedConsentRevision: number }) => Promise<AppRecord>;
  extensionStatus: (appId: string) => Promise<AppExtensionStatus>;
  revokeExtensionGrant: (appId: string) => Promise<AppExtensionStatus>;
  rebuildExtensionGeneration: (appId: string) => Promise<AppRecord>;
  capabilities: (appId: string) => Promise<AppCapabilitiesSnapshot>;
  guiInfo: (input: AppGuiInfoInput) => Promise<AppGuiInfo>;
  releaseGuiSurface: (input: AppGuiInfoInput) => Promise<void>;
  setOpenMode: (input: { appId: string; mode: AppOpenMode | null }) => Promise<AppRecord>;
  importDesignCanvas: (input: ImportDesignCanvasInput) => Promise<{ file: string }>;
  listDesignImportCandidates: (input: DesignSurfaceInput) => Promise<string[]>;
  listDesignFiles: (input: DesignSurfaceInput) => Promise<string[]>;
  listDesignVersions: (input: ListDesignVersionsInput) => Promise<DesignCanvasVersion[]>;
  restoreDesignVersion: (input: RestoreDesignVersionInput) => Promise<DesignCanvasVersion>;
  setDesignAutoOpen: (input: DesignAutoOpenInput) => Promise<boolean>;
  designDataStatus: (appId: string) => Promise<DesignDataStatus>;
  deleteDesignData: (input: DeleteDesignDataInput) => Promise<boolean>;
  setDesignEnabled: (input: SetDesignEnabledInput) => Promise<AppRecord>;
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
