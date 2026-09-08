/**
 * [INPUT]: Depends on shared/apps-ipc and the preload-exposed window.apps bridge
 * [OUTPUT]: Wraps App lifecycle and scoped events, including passive capabilities and explicit Agent tool inspection.
 * [POS]: Renderer Apps transport adapter; structured business rejections become typed errors, transport failures stay untouched, and a missing bridge throws
 */

import type { AppCompatibilityBlocked, AppCompatibilityFailure } from "../../shared/app-host/contract";
import type {
  AddAppInput,
  AppConfigValue,
  AppRecordProjection,
  AppGuiInfo,
  AppGuiInfoInput,
  AppGuiReadyInput,
  AppsBridgeApi,
  AppInstallEvent,
  AppGrantSourcesSnapshot,
  AppGrantCandidatesInput,
  AppSurfaceAcquireInput,
  BeginFileExportInputV1,
  CompleteFileExportInputV1,
  DesignAutoOpenInput,
  DesignSurfaceInput,
  DeleteDesignDataInput,
  ImportDesignCanvasInput,
  ListDesignVersionsInput,
  RestoreDesignVersionInput,
  SetDesignEnabledInput,
  AvailableAppsInput,
  EnsureAppChatSlotInput,
  ListAppUseHistoryInput,
  OpenAppEditorInput,
  OpenAppEditorChatInput,
  OpenAppUseChatInput,
  InstallPresetInput,
  RemoveAppMode,
  RenameAppInput,
  SaveAsAppInput,
  SetAppAgentInput,
  SetAppGrantInput,
  SetAppGrantStateInput,
  SetDefaultAppGrantInput,
  SharePreviewInput,
  SharePublishInput,
  WriteFileExportChunkInputV1,
} from "../../shared/apps-ipc";

declare global {
  interface Window {
    apps?: AppsBridgeApi;
  }
}

const bridge = (): AppsBridgeApi => {
  const api = window.apps;
  if (!api) throw new Error("apps bridge unavailable");
  return api;
};

export class AppCompatibilityRequiredError extends Error {
  constructor(readonly compatibility: AppCompatibilityFailure) { super(compatibility.code); }
}
export function unwrapCompatibility<T>(result: T | AppCompatibilityBlocked): T {
  if (result && typeof result === "object" && "kind" in result && result.kind === "compatibility-blocked") {
    throw new AppCompatibilityRequiredError((result as AppCompatibilityBlocked).compatibility);
  }
  return result as T;
}
export const onAppCompatibilityChanged = (callback: () => void) => bridge().onCompatibilityChanged(callback);
export const listAppCompatibilityRequests = () => bridge().compatibilityRequests();
export const resumeAppCompatibility = async (requestId: string) => unwrapCompatibility(await bridge().resumeCompatibility(requestId));
export const APP_COMPATIBILITY_EVENT = "app-host-compatibility";
export function presentAppCompatibility(failure: AppCompatibilityFailure) {
  window.dispatchEvent(new CustomEvent(APP_COMPATIBILITY_EVENT, { detail: failure }));
}
function unwrapLifecycleCompatibility<T>(result: T | AppCompatibilityBlocked): T {
  try { return unwrapCompatibility(result); }
  catch (cause) {
    if (cause instanceof AppCompatibilityRequiredError) presentAppCompatibility(cause.compatibility);
    throw cause;
  }
}
export const applyAppCompatibility = (requestId: string) => bridge().applyCompatibility(requestId).then(unwrapCompatibility);
export const forgetAppCompatibility = (requestId: string) => bridge().forgetCompatibility(requestId);

export const listApps = () => bridge().list();

export class DuplicateAppError extends Error {
  constructor(readonly appId: string) {
    super("App repository already exists");
  }
}

export const addApp = async (input: AddAppInput) => {
  const result = unwrapCompatibility(await bridge().add(input));
  if (result.status === "rejected") {
    throw new DuplicateAppError(result.error.appId);
  }
  return result.record;
};

export const removeApp = (
  appId: string,
  mode?: RemoveAppMode,
  requestId?: string
) => bridge().remove(appId, mode, requestId);
export const retryApp = (appId: string) => bridge().retry(appId).then(unwrapLifecycleCompatibility);
export const repairApp = (appId: string) => bridge().repair(appId).then(unwrapLifecycleCompatibility);
export const setAppAgent = (input: SetAppAgentInput) =>
  bridge().setAgent(input);
export class SaveAsAppRejectedError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message);
  }
}

export const saveAsApp = async (input: SaveAsAppInput) => {
  const result = await bridge().saveAsApp(input);
  if (result.status === "rejected") {
    throw new SaveAsAppRejectedError(
      result.error.code,
      result.error.message
    );
  }
  return result.record;
};
export const renameApp = (input: RenameAppInput) => bridge().rename(input);
export const ensureAppChatSlot = (input: EnsureAppChatSlotInput) =>
  bridge().ensureChatSlot(input);
export const listAppUseHistory = (input: ListAppUseHistoryInput) =>
  bridge().listUseHistory(input);
export const openAppUseChat = (input: OpenAppUseChatInput) =>
  bridge().openUseChat(input);
export const newAppUseChat = (appId: string, requestId: string) =>
  bridge().newUseChat(appId, requestId);
export const openAppEditor = (input: OpenAppEditorInput) =>
  bridge().openEditor(input);
export const openAppEditorChat = (input: OpenAppEditorChatInput) =>
  bridge().openEditorChat(input);
export const hideAppEditor = (appId: string) => bridge().hideEditor(appId);
export const authorizeAppStudioAccess = (appId: string) =>
  bridge().authorizeStudioAccess(appId).then(unwrapLifecycleCompatibility);

/** 拒绝本次授权：丢弃待批的那一代，重新构建随之解锁。 */
export const declineAppStudioAccess = (appId: string) =>
  bridge().declineStudioAccess(appId);

export const revokeAppStudioAccess = (appId: string) =>
  bridge().revokeStudioAccess(appId);

export const readAppExtensionStatus = (appId: string) =>
  bridge().extensionStatus(appId);
export const revokeAppExtensionGrant = (appId: string) =>
  bridge().revokeExtensionGrant(appId);
export const rebuildAppExtensionGeneration = (appId: string) =>
  bridge().rebuildExtensionGeneration(appId).then(unwrapLifecycleCompatibility);

export const retryAppSkill = (appId: string) => bridge().retrySkill(appId);
export const readAppReadme = (appId: string) => bridge().readReadme(appId);
/** 取 GUI 现状并轮换 token。 */
export const readAppGuiInfo = (input: AppGuiInfoInput): Promise<AppGuiInfo> =>
  bridge().guiInfo(input);
export const readyAppGuiSurface = (input: AppGuiReadyInput) =>
  bridge().guiReady(input);
export const releaseAppGuiSurface = (input: AppGuiInfoInput) =>
  bridge().releaseGuiSurface(input);
export const beginAppFileExport = (input: BeginFileExportInputV1) =>
  bridge().fileExportBegin(input);
export const writeAppFileExport = (input: WriteFileExportChunkInputV1) =>
  bridge().fileExportWrite(input);
export const finalizeAppFileExport = (input: CompleteFileExportInputV1) =>
  bridge().fileExportFinalize(input);
export const cancelAppFileExport = (input: CompleteFileExportInputV1) =>
  bridge().fileExportCancel(input);
export const setAppPinned = (appId: string, pinned: boolean) =>
  bridge().setPinned({ appId, pinned });
export const importDesignCanvas = (input: ImportDesignCanvasInput) =>
  bridge().importDesignCanvas(input);
export const listDesignImportCandidates = (input: DesignSurfaceInput) =>
  bridge().listDesignImportCandidates(input);
export const listDesignFiles = (input: DesignSurfaceInput) =>
  bridge().listDesignFiles(input);
export const listDesignVersions = (input: ListDesignVersionsInput) =>
  bridge().listDesignVersions(input);
export const restoreDesignVersion = (input: RestoreDesignVersionInput) =>
  bridge().restoreDesignVersion(input);
export const setDesignAutoOpen = (input: DesignAutoOpenInput) =>
  bridge().setDesignAutoOpen(input);
export const readDesignDataStatus = (appId: string) =>
  bridge().designDataStatus(appId);
export const deleteDesignData = (input: DeleteDesignDataInput) =>
  bridge().deleteDesignData(input);
export const setDesignEnabled = (input: SetDesignEnabledInput) =>
  bridge().setDesignEnabled(input);
export const probeAppRepo = async (repoUrl: string) => unwrapCompatibility(await bridge().probeRepo(repoUrl));
export const discardAppProbe = (preflightId: string) =>
  bridge().discardProbe(preflightId);
export const listPresetApps = () => bridge().listPresets();
export const probePresetApp = async (presetId: string) =>
  unwrapCompatibility(await bridge().probePreset(presetId));
export const discardPresetAppProbe = (preflightId: string) =>
  bridge().discardPresetProbe(preflightId);
/** 只接受已经 probePresetApp 冻结过的四元组；失败时归还 preflight，绝不静默留悬账。 */
export const installPresetApp = async (input: InstallPresetInput) => {
  const api = bridge();
  try {
    return unwrapCompatibility(await api.installPreset(input));
  } catch (cause) {
    await api.discardPresetProbe(input.preflightId).catch(() => undefined);
    throw cause;
  }
};
export const readAppConfig = (appId: string) => bridge().readConfig(appId);
export const writeAppConfig = (appId: string, config: AppConfigValue) =>
  bridge().writeConfig(appId, config);
export const readGhStatus = () => bridge().ghStatus();
export const previewAppShare = (input: SharePreviewInput) =>
  bridge().sharePreview(input).then(unwrapCompatibility);
export const publishAppShare = (input: SharePublishInput) =>
  bridge().sharePublish(input).then(unwrapCompatibility);
export const discardAppShare = (previewId: string) =>
  bridge().shareDiscard(previewId);
export const cancelAppInstall = (appId: string) =>
  bridge().cancelInstall(appId);
export const revealApp = (appId: string) => bridge().reveal(appId);
export const openApp = (appId: string) => bridge().open(appId);
export const appOriginWithoutStart = (appId: string) =>
  bridge().originWithoutStart(appId);
export const stopApp = (appId: string) => bridge().stop(appId);
export const grantApp = (input: SetAppGrantInput) => bridge().grant(input);
export const setAppGrantState = (input: SetAppGrantStateInput) =>
  bridge().setGrantState(input);
export const setDefaultAppGrant = (input: SetDefaultAppGrantInput) =>
  bridge().setDefaultGrant(input);
export const listAppGrantSources = (): Promise<AppGrantSourcesSnapshot> =>
  bridge().listGrantSources();
export const listAppGrantCandidates = (input: AppGrantCandidatesInput) =>
  bridge().listGrantCandidates(input);
export const listAvailableApps = (input: AvailableAppsInput) =>
  bridge().listAvailable(input);
export const readAppCapabilities = (appId: string) =>
  bridge().capabilities(appId);
export const acquireAppSurface = (input: AppSurfaceAcquireInput) =>
  bridge().acquireSurface(input);
export const releaseAppSurface = (surfaceLeaseId: string) =>
  bridge().releaseSurface(surfaceLeaseId);

export const readAppLog = (appId: string) => bridge().readLog(appId);
/* ============================================================
 * 到达渲染层的 status 恒携带投影
 *
 * main 只有一个 status 发源地——AppsService 的 store.watch 把每条记录过一遍
 * projectRecord 再广播。因此渲染层收到的每一条 status 都带着
 * studioSurfaceReady；事件类型本身仍是账本形状，因为 main 侧还有别的构造点。
 *
 * 收窄放在这一处，整条渲染链此后都拿投影说话，没有哪个组件再有机会自己推
 * 一遍授权。窄化只此一次，且与 main 的发源地同真——两处都改才谈得上漂移。
 * ============================================================ */
export type AppsRendererEvent =
  | Exclude<AppInstallEvent, { type: "status" }>
  | Readonly<{ appId: string; type: "status"; record: AppRecordProjection }>;

export const onAppsEvent = (callback: (event: AppsRendererEvent) => void) =>
  bridge().onEvent(callback as (event: AppInstallEvent) => void);

export const checkAppAgentTools = (appId: string) => bridge().checkAgentTools(appId);
