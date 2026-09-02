/**
 * [INPUT]: Depends on Electron app packaging facts, the adapter selection matrix, embedded release-key candidate policy, a durable App compatibility preflight, a safe-quit port and the E2E receipt environment
 * [OUTPUT]: Provides createDesktopUpdateService: the one UpdateService this product ships, including fail-closed candidate compatibility and platform install policy
 * [POS]: main/update assembly; the composition root owns lifecycle order while this file owns what "the updater for this app" means
 */

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { App } from "electron";
import type { AppGuiCompatibilitySupport } from "../../../shared/app-gui/support";
import { createSelectedUpdateAdapter } from "./selection";
import { UpdateService } from "./service";
import { createGitHubCompatibilityLoader } from "./compatibility";

const E2E_FALLBACK_VERSION = "0.1.1";

export function createDesktopUpdateService(
  app: App,
  prepareSafeQuit: (reason: "update") => Promise<boolean>,
  env: NodeJS.ProcessEnv = process.env,
  applyCandidateCompatibility?: (
    matrix: AppGuiCompatibilitySupport
  ) => Promise<void>
) {
  const resourcesPath = app.isPackaged
    ? process.resourcesPath
    : join(app.getAppPath(), "../..");
  return new UpdateService({
    adapter: createSelectedUpdateAdapter({
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
    ...(app.isPackaged
      ? {
          candidateCompatibility: {
            load: createGitHubCompatibilityLoader(resourcesPath),
            apply: applyCandidateCompatibility ?? (async () => {
              throw new Error("GUI_COMPATIBILITY_PREFLIGHT_UNAVAILABLE");
            }),
          },
        }
      : {}),
    /* Windows 首版没有 Authenticode 签名，不开自动安装：只检查更新并
       导向 Release 页，由用户自己核对签名后安装。 */
    automaticInstall: process.platform !== "win32",
    prepareSafeQuit,
    forceExit: (code) => app.exit(code),
  });
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
