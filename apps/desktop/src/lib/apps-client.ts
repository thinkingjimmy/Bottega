/**
 * [INPUT]: Depends on shared/apps-ipc and preload exposed window.apps
 * [OUTPUT]: Provides typed renderer calls for installation, presets, save/rename/Pin/chat slots, README/configuration/sharing, fenced grant candidates and mutations, symmetric Studio authorize/decline/revoke, App-scoped Extensions, surfaces, logs, and removal
 * [POS]: Renderer Apps transport adapter; structured business rejections become typed errors while transport failures stay untouched
 */

import type {
  AddAppInput,
  AppConfigValue,
  AppGuiInfo,
  AppGuiInfoInput,
  AppsBridgeApi,
  AppInstallEvent,
  AppGrantSourcesSnapshot,
  AppGrantCandidatesInput,
  AppGrantTarget,
  AppSurfaceAcquireInput,
  DesignAutoOpenInput,
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
} from "../../shared/apps-ipc";

declare global {
  interface Window {
    apps?: AppsBridgeApi;
  }
}

export const hasAppsBridge = () => Boolean(window.apps);

export const listApps = () => {
  if (!window.apps) throw new Error("当前环境不支持 Apps 持久化");
  return window.apps.list();
};

export class DuplicateAppError extends Error {
  constructor(readonly appId: string) {
    super("App repository already exists");
  }
}

export const addApp = async (input: AddAppInput) => {
  if (!window.apps) throw new Error("当前环境不支持自动安装");
  const result = await window.apps.add(input);
  if (result.status === "rejected") {
    throw new DuplicateAppError(result.error.appId);
  }
  return result.record;
};

export const removeApp = (
  appId: string,
  mode?: RemoveAppMode,
  requestId?: string
) => window.apps?.remove(appId, mode, requestId);
export const retryApp = (appId: string) => window.apps?.retry(appId);
export const repairApp = (appId: string) => window.apps?.repair(appId);
export const setAppAgent = (input: SetAppAgentInput) => {
  if (!window.apps) throw new Error("当前环境不支持 App Agent 设置");
  return window.apps.setAgent(input);
};
export class SaveAsAppRejectedError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message);
  }
}

export const saveAsApp = async (input: SaveAsAppInput) => {
  if (!window.apps) throw new Error("当前环境不支持 Save as App");
  const result = await window.apps.saveAsApp(input);
  if (result.status === "rejected") {
    throw new SaveAsAppRejectedError(
      result.error.code,
      result.error.message
    );
  }
  return result.record;
};
export const renameApp = (input: RenameAppInput) => {
  if (!window.apps) throw new Error("当前环境不支持 App 改名");
  return window.apps.rename(input);
};
export const ensureAppChatSlot = (input: EnsureAppChatSlotInput) => {
  if (!window.apps) throw new Error("当前环境不支持 App chat 槽位");
  return window.apps.ensureChatSlot(input);
};
export const listAppUseHistory = (input: ListAppUseHistoryInput) => {
  if (!window.apps) throw new Error("当前环境不支持 App Use History");
  return window.apps.listUseHistory(input);
};
export const openAppUseChat = (input: OpenAppUseChatInput) => {
  if (!window.apps) throw new Error("当前环境不支持 App Use destination");
  return window.apps.openUseChat(input);
};
export const newAppUseChat = (appId: string, requestId: string) => {
  if (!window.apps) throw new Error("当前环境不支持 App Use New Chat");
  return window.apps.newUseChat(appId, requestId);
};
export const openAppEditor = (input: OpenAppEditorInput) => {
  if (!window.apps) throw new Error("当前环境不支持 App Editor destination");
  return window.apps.openEditor(input);
};
export const openAppEditorChat = (input: OpenAppEditorChatInput) => {
  if (!window.apps) throw new Error("当前环境不支持 App Editor chat destination");
  return window.apps.openEditorChat(input);
};
export const hideAppEditor = (appId: string) => {
  if (!window.apps) throw new Error("当前环境不支持隐藏 App Editor");
  return window.apps.hideEditor(appId);
};
export const authorizeAppStudioAccess = (appId: string) => {
  if (!window.apps) throw new Error("当前环境不支持 App Studio 授权");
  return window.apps.authorizeStudioAccess(appId);
};

/** 拒绝本次授权：丢弃待批的那一代，重新构建随之解锁。 */
export const declineAppStudioAccess = (appId: string) => {
  if (!window.apps) throw new Error("当前环境不支持 App Studio 拒绝");
  return window.apps.declineStudioAccess(appId);
};

export const revokeAppStudioAccess = (appId: string) => {
  if (!window.apps) throw new Error("当前环境不支持 App Studio 撤权");
  return window.apps.revokeStudioAccess(appId);
};

export const readAppExtensionStatus = (appId: string) => {
  if (!window.apps) throw new Error("当前环境不支持 App 扩展状态");
  return window.apps.extensionStatus(appId);
};
export const revokeAppExtensionGrant = (appId: string) => {
  if (!window.apps) throw new Error("当前环境不支持 App 扩展撤权");
  return window.apps.revokeExtensionGrant(appId);
};
export const rebuildAppExtensionGeneration = (appId: string) => {
  if (!window.apps) throw new Error("当前环境不支持 App 扩展换代");
  return window.apps.rebuildExtensionGeneration(appId);
};

export const retryAppSkill = (appId: string) => {
  if (!window.apps) throw new Error("当前环境不支持 App skill 重试");
  return window.apps.retrySkill(appId);
};
export const readAppReadme = (appId: string) =>
  window.apps?.readReadme(appId) ?? Promise.resolve(null);
/** 取 GUI 现状并轮换 token；无桥接环境如实返回空 GUI，由调用方渲染空态。 */
export const readAppGuiInfo = (input: AppGuiInfoInput): Promise<AppGuiInfo> =>
  window.apps?.guiInfo(input) ??
  Promise.resolve({
    pages: [],
    origin: "",
    token: "",
    baseCapabilities: [],
    hostActions: [],
  });
export const readyAppGuiSurface = (
  input: import("../../shared/apps-ipc").AppGuiReadyInput
) => {
  if (!window.apps) return Promise.resolve({ outcome: "aborted" as const });
  return window.apps.guiReady(input);
};
export const releaseAppGuiSurface = (input: AppGuiInfoInput) =>
  window.apps?.releaseGuiSurface(input) ?? Promise.resolve();
export const beginAppFileExport = (input: import("../../shared/apps-ipc").BeginFileExportInputV1) => {
  if (!window.apps) throw new Error("当前环境不支持 App 文件导出");
  return window.apps.fileExportBegin(input);
};
export const writeAppFileExport = (input: import("../../shared/apps-ipc").WriteFileExportChunkInputV1) => {
  if (!window.apps) throw new Error("当前环境不支持 App 文件导出");
  return window.apps.fileExportWrite(input);
};
export const finalizeAppFileExport = (input: import("../../shared/apps-ipc").CompleteFileExportInputV1) => {
  if (!window.apps) throw new Error("当前环境不支持 App 文件导出");
  return window.apps.fileExportFinalize(input);
};
export const cancelAppFileExport = (input: import("../../shared/apps-ipc").CompleteFileExportInputV1) => {
  if (!window.apps) throw new Error("当前环境不支持 App 文件导出");
  return window.apps.fileExportCancel(input);
};
export const setAppPinned = (appId: string, pinned: boolean) => {
  if (!window.apps) throw new Error("当前环境不支持 App pin");
  return window.apps.setPinned({ appId, pinned });
};
export const importDesignCanvas = (input: ImportDesignCanvasInput) => {
  if (!window.apps) throw new Error("当前环境不支持 Design canvas 导入");
  return window.apps.importDesignCanvas(input);
};
export const listDesignImportCandidates = (input: import("../../shared/apps-ipc").DesignSurfaceInput) => {
  if (!window.apps) return Promise.resolve([]);
  return window.apps.listDesignImportCandidates(input);
};
export const listDesignFiles = (input: import("../../shared/apps-ipc").DesignSurfaceInput) => {
  if (!window.apps) return Promise.resolve([]);
  return window.apps.listDesignFiles(input);
};
export const listDesignVersions = (input: ListDesignVersionsInput) => {
  if (!window.apps) return Promise.resolve([]);
  return window.apps.listDesignVersions(input);
};
export const restoreDesignVersion = (input: RestoreDesignVersionInput) => {
  if (!window.apps) throw new Error("当前环境不支持 Design 版本恢复");
  return window.apps.restoreDesignVersion(input);
};
export const setDesignAutoOpen = (input: DesignAutoOpenInput) => {
  if (!window.apps) return Promise.resolve(false);
  return window.apps.setDesignAutoOpen(input);
};
export const readDesignDataStatus = (appId: string) =>
  window.apps?.designDataStatus(appId) ?? Promise.resolve(null);
export const deleteDesignData = (input: DeleteDesignDataInput) => {
  if (!window.apps) throw new Error("当前环境不支持 Design 数据删除");
  return window.apps.deleteDesignData(input);
};
export const setDesignEnabled = (input: SetDesignEnabledInput) => {
  if (!window.apps) throw new Error("当前环境不支持 Design visibility");
  return window.apps.setDesignEnabled(input);
};
export const probeAppRepo = (repoUrl: string) => {
  if (!window.apps) throw new Error("当前环境不支持仓库预检");
  return window.apps.probeRepo(repoUrl);
};
export const discardAppProbe = (preflightId: string) =>
  window.apps?.discardProbe(preflightId) ?? Promise.resolve();
/** 无桥接环境如实返回空清单：预设随产品分发，浏览器降级下本就不存在。 */
export const listPresetApps = () =>
  window.apps?.listPresets() ?? Promise.resolve([]);
export const probePresetApp = (presetId: string) => {
  if (!window.apps) throw new Error("当前环境不支持安装预设 App");
  return window.apps.probePreset(presetId);
};
export const discardPresetAppProbe = (preflightId: string) =>
  window.apps?.discardPresetProbe(preflightId) ?? Promise.resolve();
/** 只接受已经 probePresetApp 冻结过的四元组；失败时归还 preflight，绝不静默留悬账。 */
export const installPresetApp = async (input: InstallPresetInput) => {
  if (!window.apps) throw new Error("当前环境不支持安装预设 App");
  try {
    return await window.apps.installPreset(input);
  } catch (cause) {
    await window.apps
      .discardPresetProbe(input.preflightId)
      .catch(() => undefined);
    throw cause;
  }
};
export const readAppConfig = (appId: string) => {
  if (!window.apps) throw new Error("当前环境不支持 App 配置");
  return window.apps.readConfig(appId);
};
export const writeAppConfig = (appId: string, config: AppConfigValue) => {
  if (!window.apps) throw new Error("当前环境不支持 App 配置");
  return window.apps.writeConfig(appId, config);
};
export const readGhStatus = () => {
  if (!window.apps) throw new Error("当前环境不支持 GitHub 分享");
  return window.apps.ghStatus();
};
export const previewAppShare = (input: SharePreviewInput) => {
  if (!window.apps) throw new Error("当前环境不支持 GitHub 分享");
  return window.apps.sharePreview(input);
};
export const publishAppShare = (input: SharePublishInput) => {
  if (!window.apps) throw new Error("当前环境不支持 GitHub 分享");
  return window.apps.sharePublish(input);
};
export const discardAppShare = (previewId: string) =>
  window.apps?.shareDiscard(previewId) ?? Promise.resolve();
export const cancelAppInstall = (appId: string) =>
  window.apps?.cancelInstall(appId);
export const revealApp = (appId: string) => window.apps?.reveal(appId);
export const openApp = (appId: string) => {
  if (!window.apps) throw new Error("当前环境不支持运行 App");
  return window.apps.open(appId);
};
export const appOriginWithoutStart = (appId: string) => {
  if (!window.apps) return Promise.resolve(null);
  return window.apps.originWithoutStart(appId);
};
export const stopApp = (appId: string) => {
  if (!window.apps) throw new Error("当前环境不支持停止 App");
  return window.apps.stop(appId);
};
export const grantApp = (input: SetAppGrantInput) => {
  if (!window.apps) throw new Error("当前环境不支持 App 授权");
  return window.apps.grant(input);
};
export const revokeAppGrant = (target: AppGrantTarget, appId: string) => {
  if (!window.apps) throw new Error("当前环境不支持撤销 App 授权");
  return window.apps.revokeGrant(target, appId);
};
export const setAppGrantState = (input: SetAppGrantStateInput) => {
  if (!window.apps) throw new Error("当前环境不支持 App 授权状态");
  return window.apps.setGrantState(input);
};
export const setDefaultAppGrant = (input: SetDefaultAppGrantInput) => {
  if (!window.apps) throw new Error("当前环境不支持 App 默认授权");
  return window.apps.setDefaultGrant(input);
};
export const listAppGrantSources = (): Promise<AppGrantSourcesSnapshot> => {
  if (!window.apps) return Promise.resolve({ chats: [], projects: [], globals: [] });
  return window.apps.listGrantSources();
};
export const listAppGrantCandidates = (input: AppGrantCandidatesInput) => {
  if (!window.apps) return Promise.resolve([]);
  return window.apps.listGrantCandidates(input);
};
export const listAvailableApps = (input: AvailableAppsInput) => {
  if (!window.apps) return Promise.resolve([]);
  return window.apps.listAvailable(input);
};
export const readAppCapabilities = (appId: string) => {
  if (!window.apps) throw new Error("当前环境不支持 App 能力现检");
  return window.apps.capabilities(appId);
};
export const acquireAppSurface = (input: AppSurfaceAcquireInput) => {
  if (!window.apps) throw new Error("当前环境不支持 App surface");
  return window.apps.acquireSurface(input);
};
export const releaseAppSurface = (surfaceLeaseId: string) =>
  window.apps?.releaseSurface(surfaceLeaseId) ?? Promise.resolve();

export const readAppLog = (appId: string) =>
  window.apps?.readLog(appId) ?? Promise.resolve("");
export const onAppsEvent = (callback: (event: AppInstallEvent) => void) =>
  window.apps?.onEvent(callback) ?? (() => {});
