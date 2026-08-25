/**
 * [INPUT]: Depends on the packaging mode of the Electron app, the application directory with macOS Dock, and the resources/icon.png distributed with the packaging
 * [OUTPUT]: Provides unified application icon path analysis, installed with the development mode macOS Dock icon** decoration level**** (without taking any icon only warn, never preventing initialization)
 * [POS]: The boundaries of the branded assets of the window module; Packaging and development share the same Bottega square main character
 */

import { join } from "node:path";
import { app } from "electron";

export function resolveAppIconPath() {
  return app.isPackaged
    ? join(process.resourcesPath, "icon.png")
    : join(app.getAppPath(), "resources", "icon.png");
}

/* ============================================================
 * Dock 图标是装饰，不是能力——可它曾经握着整个应用的生杀大权。
 *
 * 开发态的 appPath 不等于仓库根：e2e runner 让真实 Electron 去加载
 * 临时 fixture 里的 wrapper，appPath 于是指向那个临时目录，那里没有
 * resources/icon.png。setIcon 当场抛 `Failed to load image from path`。
 * 而这一行跑在 whenReady 的第一句，抛出即整条初始化夭折：窗口永不
 * 诞生，firstWindow 超时，连 app.close() 都没人应答——一张图片的缺席
 * 冒充成了应用的死亡。
 *
 * 判据不是「文件在不在」（那是一次 TOCTOU，且只挡得住众多失败里的
 * 一种），而是「装饰品对存在没有否决权」。把失败整个折进一行 warn，
 * 缺图标的代价就回落到它本该有的唯一代价：Dock 上是默认图标。
 * ============================================================ */
export function applyDevelopmentDockIcon() {
  if (process.platform !== "darwin" || app.isPackaged) return;
  try {
    app.dock?.setIcon(resolveAppIconPath());
  } catch (cause) {
    console.warn("[app-icon] dev dock icon unavailable", cause);
  }
}
