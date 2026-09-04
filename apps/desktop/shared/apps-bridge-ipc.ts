/**
 * [INPUT]: Depends on type-only Apps lifecycle, grant, package, surface, and Design command DTOs
 * [OUTPUT]: Provides APPS_CHANNEL, the AppRecordProjection/AppsProjectionSnapshot read models, and the complete renderer AppsBridgeApi contract, including fenced contextual grant candidates, structured add outcomes, symmetric Studio authorize/decline/revoke, and main-only durable App Pin mutation
 * [POS]: Shared Apps wire boundary; keeps channel routing and preload shape separate from durable domain records
 */

import type {
  AddAppInput,
  AddAppResult,
  AppCapabilitiesSnapshot,
  AppConfigValue,
  AppExtensionStatus,
  AppGrantSnapshot,
  AppGrantCandidate,
  AppGrantCandidatesInput,
  AppGrantSourcesSnapshot,
  AppInstallEvent,
  AppOpenResult,
  AppUseHistoryPage,
  ListAppUseHistoryInput,
  OpenAppEditorInput,
  OpenAppEditorChatInput,
  OpenAppUseChatInput,
  AppRecord,
  AppRepoProbeResult,
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
  SetAppPinnedInput,
  SetAppGrantInput,
  SetAppGrantStateInput,
  SetDefaultAppGrantInput,
  SharePreview,
  SharePreviewInput,
  SharePublishInput,
} from "./apps-ipc";
import type {
  AppEditorDestination,
  AppUseSwitchReceipt,
} from "./placement/facts";
import type {
  AppAttachmentSurface,
  AppGuiInfo,
  AppGuiInfoInput,
  AppGuiReadyInput,
  AppGuiReadyResult,
  AppSurfaceAcquireInput,
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
import type {
  BeginFileExportInputV1,
  BeginFileExportResultV1,
  CompleteFileExportInputV1,
  CompleteFileExportResultV1,
  WriteFileExportChunkInputV1,
} from "./app-gui/file-export";

export const APPS_CHANNEL = {
  add: "apps:add",
  remove: "apps:remove",
  list: "apps:list",
  open: "apps:open",
  originWithoutStart: "apps:origin-without-start",
  stop: "apps:stop",
  grant: "apps:grant",
  setGrantState: "apps:grant:state",
  setDefaultGrant: "apps:grant:default",
  listGrantSources: "apps:grant:sources",
  listGrantCandidates: "apps:grant:candidates",
  listAvailable: "apps:available",
  acquireSurface: "apps:surface:acquire",
  releaseSurface: "apps:surface:release",
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
  listUseHistory: "apps:use-history:list",
  openUseChat: "apps:use-chat:open",
  newUseChat: "apps:use-chat:new",
  openEditor: "apps:editor:open",
  openEditorChat: "apps:editor-chat:open",
  hideEditor: "apps:editor:hide",
  retrySkill: "apps:retry-skill",
  authorizeStudioAccess: "apps:studio-access:authorize",
  declineStudioAccess: "apps:studio-access:decline",
  revokeStudioAccess: "apps:studio-access:revoke",
  extensionStatus: "apps:extension-status",
  revokeExtensionGrant: "apps:extension-grant:revoke",
  rebuildExtensionGeneration: "apps:extension-generation:rebuild",
  capabilities: "apps:capabilities",
  guiInfo: "apps:gui-info",
  guiReady: "apps:gui-ready",
  releaseGuiSurface: "apps:gui-surface:release",
  fileExportBegin: "apps:file-export:begin",
  fileExportWrite: "apps:file-export:write",
  fileExportFinalize: "apps:file-export:finalize",
  fileExportCancel: "apps:file-export:cancel",
  setPinned: "apps:set-pinned",
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

/* ============================================================
 * 记录投影：可派生的事实由 main 端上桌，renderer 不再自己推
 *
 * `studioSurfaceReady` 是 grant-authority.studioSurfaceReady 的结论，
 * 与 surface 放行读同一组事实。它是派生量，故不进持久化 schema，只出现在
 * 这条 wire 上——AppRecord 依旧是账本，投影只是账本上的一次朗读。
 *
 * 字段必填：可选时 `record: AppRecord` 也能编译通过，于是渲染层可以一路
 * 传裸账本而类型系统一声不吭——真正丢的是「这一读是 main 念的」这件事。
 * 必填之后，谁要读投影就得先拿到投影。
 * ============================================================ */
export type AppRecordProjection = AppRecord &
  Readonly<{ studioSurfaceReady: boolean }>;

export type AppsProjectionSnapshot = Readonly<{
  apps: AppRecordProjection[];
  /** 网关降级：列表可信，但 App 跑不起来 */
  runtimeWarning: string | null;
}>;

export type AppsBridgeApi = {
  add: (input: AddAppInput) => Promise<AddAppResult>;
  remove: (appId: string, mode?: RemoveAppMode, requestId?: string) => Promise<void>;
  list: () => Promise<AppsProjectionSnapshot>;
  open: (appId: string) => Promise<AppOpenResult>;
  originWithoutStart: (appId: string) => Promise<AppOpenResult | null>;
  stop: (appId: string) => Promise<void>;
  grant: (input: SetAppGrantInput) => Promise<AppGrantSnapshot>;
  setGrantState: (input: SetAppGrantStateInput) => Promise<AppGrantSnapshot>;
  setDefaultGrant: (input: SetDefaultAppGrantInput) => Promise<AppRecord>;
  listGrantSources: () => Promise<AppGrantSourcesSnapshot>;
  listGrantCandidates: (input: AppGrantCandidatesInput) => Promise<AppGrantCandidate[]>;
  listAvailable: (input: AvailableAppsInput) => Promise<AvailableAttachedApp[]>;
  acquireSurface: (input: AppSurfaceAcquireInput) => Promise<AppAttachmentSurface>;
  releaseSurface: (surfaceLeaseId: string) => Promise<void>;
  reveal: (appId: string) => Promise<void>;
  cancelInstall: (appId: string) => Promise<void>;
  readLog: (appId: string) => Promise<string>;
  retry: (appId: string) => Promise<void>;
  repair: (appId: string) => Promise<void>;
  setAgent: (input: SetAppAgentInput) => Promise<AppRecord>;
  saveAsApp: (input: SaveAsAppInput) => Promise<SaveAsAppResult>;
  rename: (input: RenameAppInput) => Promise<AppRecord>;
  ensureChatSlot: (input: EnsureAppChatSlotInput) => Promise<EnsureAppChatSlotResult>;
  listUseHistory: (input: ListAppUseHistoryInput) => Promise<AppUseHistoryPage>;
  openUseChat: (input: OpenAppUseChatInput) => Promise<AppUseSwitchReceipt>;
  newUseChat: (appId: string, requestId: string) => Promise<AppUseSwitchReceipt>;
  openEditor: (input: OpenAppEditorInput) => Promise<AppEditorDestination>;
  openEditorChat: (input: OpenAppEditorChatInput) => Promise<AppEditorDestination>;
  hideEditor: (appId: string) => Promise<AppRecord>;
  retrySkill: (appId: string) => Promise<AppRecord>;
  authorizeStudioAccess: (appId: string) => Promise<AppRecord>;
  declineStudioAccess: (appId: string) => Promise<AppRecord>;
  revokeStudioAccess: (appId: string) => Promise<AppRecord>;
  extensionStatus: (appId: string) => Promise<AppExtensionStatus>;
  revokeExtensionGrant: (appId: string) => Promise<AppExtensionStatus>;
  rebuildExtensionGeneration: (appId: string) => Promise<AppRecord>;
  capabilities: (appId: string) => Promise<AppCapabilitiesSnapshot>;
  guiInfo: (input: AppGuiInfoInput) => Promise<AppGuiInfo>;
  guiReady: (input: AppGuiReadyInput) => Promise<AppGuiReadyResult>;
  releaseGuiSurface: (input: AppGuiInfoInput) => Promise<void>;
  fileExportBegin: (input: BeginFileExportInputV1) => Promise<BeginFileExportResultV1>;
  fileExportWrite: (input: WriteFileExportChunkInputV1) => Promise<unknown>;
  fileExportFinalize: (input: CompleteFileExportInputV1) => Promise<CompleteFileExportResultV1>;
  fileExportCancel: (input: CompleteFileExportInputV1) => Promise<CompleteFileExportResultV1>;
  setPinned: (input: SetAppPinnedInput) => Promise<AppRecord>;
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
