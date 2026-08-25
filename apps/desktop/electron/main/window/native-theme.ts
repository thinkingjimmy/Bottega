/**
 * [INPUT]: Depends on the native theme of the electron and ThemePreference of the shared/settings-ipc
 * [OUTPUT]: Provides themeSourceFor pure mapping, applyThemeSource and windowBackgroundColor
 * [POS]: The main theme is projected boundariesThe product's auto|light|The theme source, renderer, and the result read only
 */

import { nativeTheme } from "electron";
import type { ThemePreference } from "../../../shared/settings-ipc";

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
