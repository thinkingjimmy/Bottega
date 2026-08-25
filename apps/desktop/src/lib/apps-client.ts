/**
 * [INPUT]: Depends on shared/apps-ipc and preload exposed window.apps
 * [OUTPUT]: Provides installation/preflight, preset lists, Save, rename/chat slots, README/configuration/sharing, tri-mode and default authorization, capability current checks, App-scoped Extension, revocation/new generation and lease/deleted renderer IPC packages
 * [POS]: The edge of the edge of the Apps of lib, which elevates the business terminal to typed error, keeps the transmission bias abnormal
 */

import type {
  AddAppInput,
  AppConfigValue,
  AppGuiInfo,
  AppsBridgeApi,
  AppInstallEvent,
  AppGrantSourcesSnapshot,
  AppGrantTarget,
  AppSurfaceAcquireInput,
  AvailableAppsInput,
  EnsureAppChatSlotInput,
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

export const addApp = (input: AddAppInput) => {
  if (!window.apps) throw new Error("当前环境不支持自动安装");
  return window.apps.add(input);
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
export const resolveAppExtensionConsent = (input: {
  appId: string;
  granted: boolean;
}) => {
  if (!window.apps) throw new Error("当前环境不支持扩展授权");
  return window.apps.resolveExtensionConsent(input);
};

export const resolveAppBaseGuiConsent = (input: {
  appId: string;
  grantedCapabilities: import("../../shared/apps-ipc").BaseGuiCapability[];
}) => {
  if (!window.apps) throw new Error("当前环境不支持 Base GUI 授权");
  return window.apps.resolveBaseGuiConsent(input);
};

export const promoteAppGeneration = (input: {
  appId: string;
  expectedConsentRevision: number;
}) => {
  if (!window.apps) throw new Error("当前环境不支持切换 App 版本");
  return window.apps.promoteGeneration(input);
};

export const revokeAppBaseGuiAccess = (appId: string) => {
  if (!window.apps) throw new Error("当前环境不支持 Base GUI 撤权");
  return window.apps.revokeBaseGuiAccess(appId);
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
export const readAppGuiInfo = (appId: string): Promise<AppGuiInfo> =>
  window.apps?.guiInfo(appId) ??
  Promise.resolve({ pages: [], origin: "", token: "", baseCapabilities: [] });
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
export const appRuntimeStatus = (appId: string) => {
  if (!window.apps) throw new Error("当前环境不支持 App runtime 状态");
  return window.apps.status(appId);
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

export const acquireAppManagementLease = (appId: string) => {
  if (!window.apps) throw new Error("当前环境不支持 App 管理会话");
  return window.apps.acquireManagementLease(appId);
};

export const releaseAppManagementLease = (managementLeaseId: string) =>
  window.apps?.releaseManagementLease(managementLeaseId) ?? Promise.resolve();
export const readAppLog = (appId: string) =>
  window.apps?.readLog(appId) ?? Promise.resolve("");
export const onAppsEvent = (callback: (event: AppInstallEvent) => void) =>
  window.apps?.onEvent(callback) ?? (() => {});
