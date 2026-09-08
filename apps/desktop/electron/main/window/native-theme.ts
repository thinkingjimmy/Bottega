/**
 * [INPUT]: Depends on Electron nativeTheme/BrowserWindow and the shared settings-ipc ThemePreference and themeResolved channel
 * [OUTPUT]: Provides themeSourceFor pure mapping, applyThemeSource, windowBackgroundColor, and the per-window bindWindowTheme background/renderer sync
 * [POS]: Main's theme-projection boundary; the product's auto|light|dark preference maps to Electron's themeSource, and renderer only ever reads the resolved theme
 */

import { nativeTheme, type BrowserWindow } from "electron";
import {
  SETTINGS_CHANNEL,
  type ThemePreference,
} from "../../../shared/settings-ipc";

/* ============================================================
 * auto 不是产品要解析的第三种值，是「不覆盖平台」——Electron 的
 * themeSource 恰好把这件事命名为 system。设过之后 Chromium 会让所有
 * renderer 的 prefers-color-scheme 反映它，于是 renderer 侧的 auto
 * 分支彻底消失：它只需要读有效主题，不需要知道用户选了什么。
 * ============================================================ */
export const themeSourceFor = (theme: ThemePreference) =>
  theme === "auto" ? "system" : theme;

export function applyThemeSource(theme: ThemePreference) {
  nativeTheme.themeSource = themeSourceFor(theme);
}

/* 窗口底色只在首帧前与缩放露白时可见，但那正是「选了深色却闪一下白」
   的全部来源。main 读不到跨包 CSS token，只能在此对齐 globals.css 的
   --background：light oklch(1 0 0)、dark oklch(0.145 0 0)。 */
export const windowBackgroundColor = () =>
  nativeTheme.shouldUseDarkColors ? "#0a0a0a" : "#ffffff";

/* 一条监听同时覆盖「用户切主题」与「系统外观变化」两路：两者都以
   nativeTheme updated 到达，底色与 renderer 因此都不需要第二个分支。
   renderer 收到的是解析好的布尔——themeSource 实测改不动它的
   prefers-color-scheme，让它自己感知就会永远停在系统那一档。 */
export function bindWindowTheme(window: BrowserWindow) {
  const syncTheme = () => {
    window.setBackgroundColor(windowBackgroundColor());
    window.webContents.send(
      SETTINGS_CHANNEL.themeResolved,
      nativeTheme.shouldUseDarkColors
    );
  };
  nativeTheme.on("updated", syncTheme);
  window.once("closed", () => nativeTheme.off("updated", syncTheme));
}
