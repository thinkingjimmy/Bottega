/**
 * [INPUT]: Depends on preload Exposure window.extensions bridge and shared extension DTO
 * [OUTPUT]: Provides has ExtensionsBridge with a thin pack of eleven commands (with component symmetry activation and independent data deletion)
 * [POS]: The only input to the renderer's extension domain; The view layer does not directly touch the window.extensions
 */

import type {
  ExtensionPreflightView,
  ExtensionsBridgeApi,
  ExtensionsSnapshot,
  Sha256Digest,
} from "../../shared/extensions-ipc";

declare global {
  interface Window {
    extensions?: ExtensionsBridgeApi;
  }
}

export const hasExtensionsBridge = () => Boolean(window.extensions);

function bridge() {
  if (!window.extensions) throw new Error("当前环境不支持扩展管理");
  return window.extensions;
}

export const listExtensions = () => bridge().list();

export const preflightExtension = (input: {
  repoUrl: string;
  requestedRef?: string;
  subdirectory?: string;
}): Promise<ExtensionPreflightView> => bridge().preflight(input);

export const confirmExtension = (input: {
  preflightId: string;
  expectedContentDigest: Sha256Digest;
  expectedResolvedCommit: string;
  /** 只有点名的 App 才起新的 pending 代；其余继续用旧代 */
  migrateAppIds?: readonly string[];
}) => bridge().confirm(input);

export const discardExtensionPreflight = (preflightId: string) =>
  bridge().discard(preflightId);

export const enableExtensionComponent = (componentIdentity: string) =>
  bridge().enableComponent(componentIdentity);

export const disableExtensionComponent = (componentIdentity: string) =>
  bridge().disableComponent(componentIdentity);

export const beginDisableExtension = (installIdentity: string) =>
  bridge().beginDisable(installIdentity);

/* 卸载是三步一条线：关闸 → 用户解决 durable 引用（或放弃）→ 引用归零后回收。
   数据删除永远另算一条命令。 */
export const beginUninstallExtension = (installIdentity: string) =>
  bridge().beginUninstall(installIdentity);

export const resolveUninstallExtension = (input: {
  installIdentity: string;
  migrateAppIds?: readonly string[];
}) => bridge().resolveUninstall(input);

export const cancelUninstallExtension = (installIdentity: string) =>
  bridge().cancelUninstall(installIdentity);

export const purgeExtensionInstallData = (installIdentity: string) =>
  bridge().purgeInstallData(installIdentity);

export const onExtensionsChanged = (
  listener: (snapshot: ExtensionsSnapshot) => void
) => window.extensions?.onChanged(listener) ?? (() => {});
