/**
 * [INPUT]: Depends on Electron app packaging facts, build-time formal release trust, the adapter selection matrix, a durable App compatibility preflight, a safe-quit port and the E2E receipt environment
 * [OUTPUT]: Provides createDesktopUpdateService: the one UpdateService this product ships, gating candidate compatibility on provisioned trust and owning platform install policy
 * [POS]: main/update assembly; the composition root owns lifecycle order while this file owns what "the updater for this app" means
 */

import { writeFileSync } from "node:fs";
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

const E2E_FALLBACK_VERSION = "0.1.1";

export type DesktopUpdateServiceOptions = Readonly<{
  prepareSafeQuit(reason: "update"): Promise<boolean>;
  env?: NodeJS.ProcessEnv;
  applyCandidateCompatibility?: (
    matrix: AppGuiCompatibilitySupport
  ) => Promise<void>;
  /* 唯一的测试缝。打包态选中的永远是真 updater，而 electron-updater 只
     活在 Electron 进程里——装配自己的判断（信任决定闸门）就再没有地方
     可被观察。给一个现成 adapter，让测试观察装配，而不是观察 Electron。 */
  adapter?: UpdateAdapter;
}>;

export function createDesktopUpdateService(
  app: App,
  options: DesktopUpdateServiceOptions
) {
  const env = options.env ?? process.env;
  const resourcesPath = app.isPackaged
    ? process.resourcesPath
    : join(app.getAppPath(), "../..");
  return new UpdateService({
    adapter:
      options.adapter ??
      createSelectedUpdateAdapter({
        isPackaged: app.isPackaged,
        /* 打包产物永远走真 updater：注入开关只在未打包时被看一眼。 */
        e2eEnabled: !app.isPackaged && env.BOTTEGA_UPDATE_E2E === "1",
        fakeVersion: env.BOTTEGA_UPDATE_E2E_VERSION,
        onFakeInstall: () => publishE2eInstallReceipt(env),
      }),
    currentVersion: app.getVersion(),
    electronVersion: process.versions.electron,
    platform: process.platform,
    /* 打包后 LICENSE 在 asar 之外的 resources；开发态回到仓库根，根
       LICENSE 是唯一来源，About 读的就是它。 */
    resourcesPath,
    /* 闸门在装配期由信任决定，不在点击时刻由一次读盘决定：未配发正式
       发布公钥的包根本没有候选矩阵可验，带着它只会让每一次下载都死在
       同一处错误码上。 */
    candidateCompatibility: candidateCompatibility(app, resourcesPath, options),
    /* Windows 首版没有 Authenticode 签名，不开自动安装：只检查更新并
       导向 Release 页，由用户自己核对签名后安装。 */
    automaticInstall: process.platform !== "win32",
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

/**
 * 安装交接是不可返回的，E2E 里没有第二次机会去问「装了没有」。落一份
 * 磁盘 receipt，让断言观察的是主进程真的走到了那一步，而不是界面文案。
 */
function publishE2eInstallReceipt(env: NodeJS.ProcessEnv) {
  const target = globalThis as typeof globalThis & {
    __bottegaUpdateE2eInstalled?: boolean;
  };
  target.__bottegaUpdateE2eInstalled = true;
  const receipt = env.BOTTEGA_UPDATE_E2E_RECEIPT;
  if (!receipt) return;
  const installed = {
    installed: true,
    version: env.BOTTEGA_UPDATE_E2E_VERSION ?? E2E_FALLBACK_VERSION,
  };
  writeFileSync(receipt, `${JSON.stringify(installed)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
}
