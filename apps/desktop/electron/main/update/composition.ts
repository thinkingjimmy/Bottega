/**
 * [INPUT]: Depends on Electron app packaging facts and ASAR release-profile metadata, build-time cloud update isolation, formal release trust, the adapter selection matrix, a durable App compatibility preflight, a safe-quit port
 * [OUTPUT]: Provides createDesktopUpdateService: the one UpdateService this product ships, gating candidate compatibility on provisioned trust and owning platform and personal manual-update policy
 * [POS]: main/update assembly; the composition root owns lifecycle order while this file owns what "the updater for this app" means
 */

import type { AppCompatibilityFailure } from "../../../shared/app-host/contract";
import type { SafeQuitResult } from "../startup/shutdown/safe-quit";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { App } from "electron";
import type { AppGuiCompatibilitySupport } from "../../../shared/app-gui/support";
import type { UpdateAdapter } from "./adapter";
import { createSelectedUpdateAdapter } from "./selection";
import { UpdateService } from "./service";
import {
  createGitHubCompatibilityLoader,
  readFormalReleaseTrust,
} from "./compatibility";

declare const __BOTTEGA_CLOUD_UPDATES_ENABLED__: boolean;


export type DesktopUpdateServiceOptions = Readonly<{
  resolveAppRequirement?(requestId: string): Promise<AppCompatibilityFailure>;
  prepareSafeQuit(reason: "update", interactive?: boolean): Promise<SafeQuitResult>;
  
  applyCandidateCompatibility?: (
    matrix: AppGuiCompatibilitySupport
  ) => Promise<void>;
  
  adapter?: UpdateAdapter;
}>;

export function createDesktopUpdateService(
  app: App,
  options: DesktopUpdateServiceOptions
) {
  const metadataPath = join(app.getAppPath(), "package.json");
  const manualOnly = app.isPackaged && existsSync(metadataPath) &&
    JSON.parse(readFileSync(metadataPath, "utf8")).bottegaReleaseProfile === "personal";
  const resourcesPath = app.isPackaged
    ? process.resourcesPath
    : join(app.getAppPath(), "../..");
  return new UpdateService({
    adapter: manualOnly ? null :
      options.adapter ??
      (typeof __BOTTEGA_CLOUD_UPDATES_ENABLED__ !== "undefined" && !__BOTTEGA_CLOUD_UPDATES_ENABLED__ ? null : createSelectedUpdateAdapter({ isPackaged: app.isPackaged })),
    currentVersion: app.getVersion(),
    resolveAppRequirement: options.resolveAppRequirement,
    electronVersion: process.versions.electron,
    platform: process.platform,
    /* 打包后 LICENSE 在 asar 之外的 resources；开发态回到仓库根，根
       LICENSE 是唯一来源，About 读的就是它。 */
    resourcesPath,
    /* 闸门在装配期由信任决定，不在点击时刻由一次读盘决定：未配发正式
       发布公钥的包根本没有候选矩阵可验，带着它只会让每一次下载都死在
       同一处错误码上。 */
    candidateCompatibility: manualOnly ? undefined : candidateCompatibility(app, resourcesPath, options),
    /* Windows 首版没有 Authenticode 签名，不开自动安装：只检查更新并
       导向 Release 页，由用户自己核对签名后安装。 */
    automaticInstall: !manualOnly && process.platform !== "win32",
    manualOnly,
    prepareSafeQuit: options.prepareSafeQuit,
    forceExit: (code) => app.exit(code),
  });
}

function candidateCompatibility(
  app: App,
  resourcesPath: string,
  options: DesktopUpdateServiceOptions
) {
  if (!app.isPackaged) return undefined;
  if (readFormalReleaseTrust(resourcesPath) === "unprovisioned") {
    console.warn(
      "[update] formal release trust unprovisioned; candidate compatibility preflight disabled — updates verify only latest.yml sha512 over HTTPS"
    );
    return undefined;
  }
  return {
    load: createGitHubCompatibilityLoader(resourcesPath),
    apply:
      options.applyCandidateCompatibility ??
      (async () => {
        throw new Error("GUI_COMPATIBILITY_PREFLIGHT_UNAVAILABLE");
      }),
  };
}


